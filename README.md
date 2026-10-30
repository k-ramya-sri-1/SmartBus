# SmartBus Rescue and Access Management System

IoT-based college bus access management and emergency rescue system.

A student taps an RFID card, the bus unit captures a frame, and access is
granted **only** when the card, the face and the bus/route authorization all
agree — and only when that decision has been recorded.

---

## What the system actually enforces

Every boarding attempt goes through the same sequence, and nothing in it is
simulated:

1. **Card** — the RC522 reads a UID; the backend resolves the student.
2. **Face** — the OV2640 captures a frame; the backend's face service (OpenCV
   YuNet detector + SFace 128-D embedding) compares it with the enrolled
   templates and returns *which student it matched*.
3. **Binding** — the backend issues a signed, single-use, 90-second proof bound
   to that student, that card and that device. A face that matches somebody else
   is refused.
4. **Authorization** — permanent assignment, a temporary authorization (missed
   bus / rescue), or an active Fest Mode. Capacity and route compatibility are
   checked for the last two.
5. **Record** — one `boarding_records` row with the RFID result, the face result,
   the similarity score, the GPS status and the route deviation, then the OLED,
   LED and buzzer indication.

Access is **denied** when the card is unknown or inactive, the student is
inactive, the face does not match, the face service is down, the camera fails,
the network is down, the bus or route is wrong, or the attempt cannot be
recorded. There is no path that grants access on a client's word.

---

## Architecture

```
┌──────────────┐   RFID + JPEG    ┌──────────────┐   image + id    ┌─────────────────┐
│ ESP32-S3     │ ───────────────► │ Backend      │ ──────────────► │ face-service    │
│ bus unit     │ ◄─────────────── │ Node/Express │ ◄────────────── │ Python, OpenCV  │
│ OLED/LED/buz │  decision+reason │ MySQL 8      │  decision+score │ YuNet + SFace   │
└──────────────┘                  └──────┬───────┘                 └─────────────────┘
                                          │ Socket.IO (authenticated)
                                   ┌──────▼───────┐
                                   │ React dash   │
                                   └──────────────┘
```

| Layer | Technology | Location |
|---|---|---|
| Firmware | Arduino / PlatformIO, ESP32-S3 | `esp32/SmartBus-ESP32` |
| Backend | Node 24, Express 5, MySQL 8, Socket.IO | `backend/` |
| Face verification | Python 3.13, OpenCV (YuNet + SFace) | `face-service/` |
| Database | MySQL 8, additive migrations | `database/` |
| Dashboard | React 19, TypeScript, Vite, Leaflet | `frontend/` |

---

## Quick start

```powershell
# database
node database/migrate.js

# services (three terminals)
python face-service/app.py
cd backend; npm install; node src/server.js
cd frontend; npm install; npm run dev
```

Full instructions, including device registration and flashing:
**[docs/RUNBOOK.md](docs/RUNBOOK.md)**
Wiring and the resolved pin conflicts: **[docs/WIRING.md](docs/WIRING.md)**

---

## Repository layout

```
backend/                 API, authorization engine, device auth, tests
  src/services/          accessControl, authorization, faceToken, capacity, routeDeviation
  test/                  integration + unit tests (own database, own face service)
  test-support/          harness and fixtures used by the tests
face-service/            face detection + recognition, no raw images stored
  face_engine.py         YuNet detector + SFace embeddings
  app.py                 loopback HTTP API with a shared secret
database/                schema.sql, additive migrations, migration runner
esp32/SmartBus-ESP32/    main firmware (modular) + bench_test + the original diagnostics
frontend/                dashboard
docs/                    WIRING.md, RUNBOOK.md, project report
```

---

## Verified vs pending hardware

Everything below was executed on this machine. Nothing in the "pending" column
is claimed as working.

| Area | Status |
|---|---|
| Firmware builds (main + bench + 4 diagnostics) | ✅ compiled |
| Backend tests (52 integration + 25 unit) | ✅ passing |
| Face service tests (19, real models) | ✅ passing |
| Dashboard build + lint | ✅ clean |
| Database migrations on live data | ✅ applied, row counts unchanged |
| Camera capture on the board | ⚠️ previously verified by the owner; not re-run here |
| OLED, LED, SOS, RC522 self-test | ⚠️ previously verified; pins changed for LED/SOS — re-verify |
| GPS with the new pin (GPIO 38) | ❌ **pending** — must be wired and re-tested |
| Face verification with a real student | ❌ **pending** — enrollment exists, but no real photo has been used |
| End-to-end boarding on hardware | ❌ **pending** |
| Buzzer | ❌ **pending** — driver circuit required |

The remaining physical steps are listed in `docs/WIRING.md` §5 and
`docs/RUNBOOK.md`.

---

## Security notes

* The device authenticates with a per-unit key; only its SHA-256 digest is
  stored. The bus is taken from the device registration, never from the request.
* Face verification produces a single-use, signed, short-lived proof. Replay,
  reuse, cross-device presentation and the old `face_verified` boolean are all
  refused (tested).
* Staff endpoints require a JWT with a role; anonymous reads of student data are
  refused.
* Passwords and secrets live in `.env` files that are git-ignored; nothing is
  hard-coded in source.
* Face templates are 128-D embeddings. No face image is written to disk, kept in
  the database or written to a log.

---

## Project documentation

* `docs/SmartBus_IIoT_Project_Report.pdf` — the original course report
  (sections 4.10 and 4.14 define the capacity formula and Fest Mode that the
  backend now implements).
* `docs/WIRING.md` — pin map, conflicts resolved, power, validation order.
* `docs/RUNBOOK.md` — setup, run, test, demo, troubleshooting, API contract.
