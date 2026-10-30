# SmartBus runbook

Everything needed to start, test and demonstrate the system, plus the exact
steps that still require the physical board.

---

## 1. Prerequisites

| Component | Version used here | Check |
|---|---|---|
| Node.js | 24.x | `node -v` |
| Python | 3.13 | `python --version` |
| MySQL | 8.0 | service `MySQL80` running |
| PlatformIO | 6.2 (bundled with VS Code, or `pip install platformio`) | `pio --version` |
| Browser | any modern one | for the dashboard |

Python packages: `pip install -r face-service/requirements.txt`
(`opencv-contrib-python`, `numpy`).

---

## 2. First-time setup

```powershell
cd SmartBus

# backend dependencies
cd backend
npm install
cd ..

# frontend dependencies
cd frontend
npm install
cd ..

# face models (38 MB, downloaded once)
python face-service/download_models.py
```

### 2.1 Database

The live database was upgraded with **additive** migrations; existing rows were
not touched.

```powershell
node database/migrate.js            # applies 001 and 002, records them
node database/inspect.js            # row counts per table
```

A fresh install can instead use `database/schema.sql` (it drops and recreates
the tables, so never point it at a database that holds data).

### 2.2 Secrets

| File | Contents | Committed? |
|---|---|---|
| `backend/.env` | DB credentials, `JWT_SECRET`, `FACE_SERVICE_URL`, `FACE_SERVICE_SECRET`, `FACE_TOKEN_TTL_SECONDS` | no |
| `face-service/.env` | the same `FACE_SERVICE_SECRET`, port, threshold | no |
| `esp32/SmartBus-ESP32/include/wifi_config.h` | Wi-Fi SSID/password | no |
| `esp32/SmartBus-ESP32/include/device_secrets.h` | device id + device key | no |

`FACE_SERVICE_SECRET` is shared between the backend and the face service and
must be at least 32 characters. Both services refuse to start without it.

Generate a value with:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## 3. Starting the system

Three processes, three terminals:

```powershell
# 1. face verification service (loopback only)
python face-service/app.py

# 2. backend API + Socket.IO
cd backend
node src/server.js

# 3. dashboard
cd frontend
npm run dev
```

Startup output of the backend tells you whether the face service was found:

```
SmartBus Backend running on http://localhost:5000
  database      : root@127.0.0.1:3306/smartbus
  face service  : http://127.0.0.1:8001 (available)
  access policy : face token TTL 90s, single use
```

If the face service is down the backend still starts, but **every access
attempt is denied** with `FACE_UNAVAILABLE`. That is intentional.

### 3.1 Registering a bus unit

```powershell
$token = "<administrator JWT from the login endpoint>"

Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/devices `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType 'application/json' `
  -Body '{"device_uid":"SMARTBUS-BUS01-01","bus_id":1,"label":"Bus 1 reader"}'
```

The response contains `device_key` **once**. Put `device_uid` and `device_key`
into `include/device_secrets.h` (copy `device_secrets.example.h`):

```c
#define DEVICE_UID "SMARTBUS-BUS01-01"
#define DEVICE_KEY "<64 hex characters>"
```

Rotate with `POST /api/devices/<id>/rotate-key` if the key is ever exposed.

### 3.2 Flashing

```powershell
cd esp32/SmartBus-ESP32
pio run -t upload                 # full firmware
pio device monitor                # 115200 baud

pio run -d bench_test -t upload   # hardware check first
```

Set `BACKEND_HOST` in `include/device_config.h` to the LAN address of the
machine running the backend (the board cannot resolve `localhost`).

---

## 4. Running the tests

```powershell
# backend: 52 integration + 25 unit tests
cd backend
node --test

# a single file
node --test test/integration/access.test.js

# face service: 19 tests against the real models
cd ..
python face-service/tests/test_face_service.py

# firmware builds
cd esp32/SmartBus-ESP32
pio run
pio run -d bench_test
pio run -d camera_test ; pio run -d oled_test ; pio run -d gps_test ; pio run -d hardware_test

# dashboard
cd frontend
npm run build
npm run lint
```

The integration suite creates **its own database** (`smartbus_test`, dropped and
rebuilt from `schema.sql`) and **its own face-service instance** on a private
port with a temporary template directory. It never touches `smartbus` or the
real face templates. The only prerequisite is that MySQL is running and
`backend/.env` is valid.

---

## 5. Demonstration script

1. **Enroll a face** — dashboard → *Face Enrollment* → pick the student → upload
   1–3 front-facing photos → *Enroll face*. Expect
   `Enrolled N templates with sface-v1`.
2. **Granted** — tap the student's own card, look at the camera. OLED shows
   `ACCESS GRANTED`, white LED blinks, one short beep. *Boarding Records* shows
   `GRANTED` with the face score.
3. **Wrong person** — tap the same card, have a different person in front of the
   camera. OLED `ACCESS DENIED / WRONG PERSON`, red LED, three beeps. The record
   is `DENIED / FACE_MISMATCH` and `face_verified = 0`.
4. **Unknown card** — tap any unregistered card. `INVALID CARD`. The record has
   no student but keeps `attempted_rfid_uid`.
5. **Wrong bus** — tap a valid card on a unit registered to another bus.
   `WRONG BUS`.
6. **SOS** — press the button. OLED `SOS sent #<id>`, the *Emergency Center*
   shows the event. Indoors it will say `No GPS fix`; that is correct and the
   coordinates are stored as NULL, not as `0,0`.
7. **Fest Mode** — *Settings* → `PUT /api/settings/operating-mode`
   `{"mode":"FEST"}` → the student may now board another bus that serves the same
   route if it has capacity; the record says `boarding_type = FEST`.
8. **Rescue** — in *Emergency Center*, press *Run rescue allocation*: affected
   students are distributed across route-compatible buses with spare capacity,
   and temporary authorizations are created for them.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FACE SVC DOWN` on the OLED | face service not running, or the two `FACE_SERVICE_SECRET` values differ | start `python face-service/app.py`; compare the two `.env` files |
| Every scan → `NETWORK ERROR` | board cannot reach `BACKEND_HOST` | set the LAN IP in `device_config.h`; same Wi-Fi network |
| `DEVICE BLOCKED` on the dashboard, OLED shows nothing granted | device key wrong or device revoked | register the device again, copy the new key, rebuild |
| Camera init fails | PSRAM not enabled, or the ribbon is loose | confirm `board_build.psram_type = opi`; reseat the FPC |
| GPS never reports a fix | antenna indoors / TX not on GPIO 38 | go outdoors; confirm NEO-6M TX → GPIO 38 |
| `FACE NOT ENROLLED` | student has no templates | enroll the face in the dashboard |
| Login fails with "Invalid email or password" | user table is per-database | create the admin user with `node backend/scripts/createAdmin.js` |

---

## 7. API contract used by the firmware

All three calls require `X-Device-Id` and `X-Device-Key`.

| Step | Request | Response |
|---|---|---|
| 1. Identify the card | `GET /api/rfid/:uid` | `student`, `card`, `assignment`, `access_possible`, `face_ready` |
| 2. Verify the face | `POST /api/face/verify`, body = raw JPEG, header `X-Rfid-Uid` | `decision`, `face_proof` (single-use, 90 s), `verification_id`, `score` |
| 3. Decide and log | `POST /api/authorization/check` `{rfid_uid, route_id, face_proof, face_verification_id, client_event_id, gps{…}}` | `authorized`, `access_result`, `denial_reason`, `display_reason`, `boarding_record_id` |
| SOS | `POST /api/emergency` `{event_type, latitude?, longitude?}` | `emergency.location_status` = `GPS_FIX` or `UNAVAILABLE` |
| Position | `POST /api/gps/location` `{latitude, longitude, age_seconds, satellites, hdop}` | stored with `fix_status` |

Notes:

* `face_proof` is the only acceptable evidence of a face check. A request with
  `face_verified: true` is refused; that contract was removed.
* `client_event_id` makes retries idempotent: a repeated id returns the original
  decision instead of writing a second record.
* `bus_id` comes from the device registration, not from the request body.
