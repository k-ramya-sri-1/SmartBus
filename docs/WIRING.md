# SmartBus wiring reference

Board: **ESP32-S3-WROOM-1 N16R8 CAM** (16 MB flash, 8 MB *octal* PSRAM, OV2640 camera)
Logic level: **3.3 V**

This is the authoritative pin map. It is also encoded in
`esp32/SmartBus-ESP32/include/board_pins.h`, where a compile-time check fails
the build if two peripherals ever share a pin or if a PSRAM pin is used.

---

## 1. What changed, and why

The earlier bench tests each worked in isolation, but three assignments could
not work together. Those are the conflicts that had to be resolved before the
board could run the full flow.

| Signal | Old pin | New pin | Why it had to move |
|---|---|---|---|
| GPS RX (NEO-6M TX) | GPIO 17 | **GPIO 38** | GPIO 17/18 are the camera data lines Y8/Y7. With the camera attached, UART1 was driving a data line, which is why GPS serial data never appeared. |
| GPS TX (NEO-6M RX) | GPIO 18 | not connected | Only needed to reconfigure the module over serial. The firmware only reads NMEA at the 9600 baud default. |
| White LED | GPIO 36 | **GPIO 47** | GPIO 33–37 are consumed by the octal PSRAM inside an N16R8 module. They cannot drive external hardware. |
| SOS button | GPIO 35 | **GPIO 39** | Same PSRAM conflict. |
| Buzzer | *undefined* | **GPIO 3** | Previously unassigned. |

`hardware_test` and `gps_test` are left exactly as they were: they are
known-good diagnostics for a single module. **Do not flash them onto the fully
wired bus unit** — they use the pins listed above as "old". Use
`bench_test/` instead, which uses the new map.

---

## 2. Final pin map

### OV2640 camera (verified working: `camera_test`, `camera_capture.jpg`)

| Camera signal | ESP32-S3 pin |
|---|---|
| XCLK | GPIO 15 |
| SIOD (SCCB SDA) | GPIO 4 |
| SIOC (SCCB SCL) | GPIO 5 |
| D0 / Y2 | GPIO 11 |
| D1 / Y3 | GPIO 9 |
| D2 / Y4 | GPIO 8 |
| D3 / Y5 | GPIO 10 |
| D4 / Y6 | GPIO 12 |
| D5 / Y7 | GPIO 18 |
| D6 / Y8 | GPIO 17 |
| D7 / Y9 | GPIO 16 |
| VSYNC | GPIO 6 |
| HREF | GPIO 7 |
| PCLK | GPIO 13 |
| PWDN | not connected |
| RESET | not connected |

Power the camera from **3.3 V**. The frame buffer lives in PSRAM
(`CAMERA_FB_IN_PSRAM`), so the PSRAM must initialise (`qio_opi` / `opi`).

### RC522 RFID reader (self-test passed)

| RC522 | ESP32-S3 pin |
|---|---|
| SDA / SS | GPIO 1 |
| SCK | GPIO 2 |
| MOSI | GPIO 14 |
| MISO | GPIO 21 |
| RST | GPIO 42 |
| 3.3V | 3.3 V **only** |
| GND | GND |

> The RC522 is a 3.3 V part. Feeding it 5 V destroys it.

### SSD1306 0.96" OLED (verified working: `oled_test`)

| OLED | ESP32-S3 pin |
|---|---|
| SDA | GPIO 41 |
| SCL | GPIO 40 |
| VCC | 3.3 V |
| GND | GND |

I²C address 0x3C.

### NEO-6M GPS

| NEO-6M | ESP32-S3 pin |
|---|---|
| TX | GPIO 38 |
| RX | *not connected* |
| VCC | 3.3 V (most breakout boards accept 3.3–5 V) |
| GND | GND |

UART1, **9600 baud, 8N1** (the module's factory default). Only RX is used.
Indoors there is usually no fix; that is expected and must not block boarding.

### Indicators, buzzer, SOS

| Signal | ESP32-S3 pin | Notes |
|---|---|---|
| White LED ("access granted") | GPIO 47 | 220 Ω series resistor to the LED anode, cathode to GND |
| Red LED ("denied / warning") | GPIO 48 | 220 Ω series resistor |
| Buzzer | GPIO 3 | **through an NPN transistor**, see below |
| SOS button | GPIO 39 | other leg to GND; `INPUT_PULLUP`, active LOW |

#### Buzzer driver

The project uses a **3.3 V active buzzer** (per the report). A typical 2-pin
active buzzer draws 25–35 mA, which is more than a GPIO should source, and an
inductive buzzer kicks back a voltage spike when it switches off.

```
GPIO 3 ── 1 kΩ ── Base   (NPN, e.g. 2N2222 / S8050 / BC547)
                 Collector ── Buzzer (−)
                 Emitter   ── GND
3.3 V ──────────────────── Buzzer (+)
              ┌───|>|───┐   flyback diode (1N4148) across the buzzer,
              └─────────┘   cathode to 3.3 V
```

If you only have a **passive** buzzer, set `BUZZER_ACTIVE 0` in
`include/device_config.h`; the firmware then drives it with a 2 kHz LEDC tone.

If you have no buzzer yet, set `BUZZER_ENABLED 0` and everything else still
works — the OLED and LEDs carry the same information.

---

## 3. Pins that must stay free

| Pins | Owner |
|---|---|
| GPIO 33–37 | Octal PSRAM inside the N16R8 module — **not usable** |
| GPIO 26–32 | Module flash — not available on the module |
| GPIO 43, 44 | UART0: USB-serial console and flashing |
| GPIO 0, 45, 46 | Strapping pins (boot mode / voltage select) — avoided |
| GPIO 19, 20 | Native USB D−/D+ — deliberately left free |

GPIO 3 is also a strapping pin (JTAG source select). It is used for the buzzer
*output* only: at reset the pin is sampled through its internal pull-up, and the
transistor base presents a high impedance, so the strap reads its default.
Do not put a pull-down on this pin.

---

## 4. Power

| Rail | Load |
|---|---|
| 3.3 V | ESP32-S3 (≈250 mA peak with Wi-Fi), OV2640 (≈100 mA), RC522 (≈26 mA), OLED (≈20 mA), GPS (≈45 mA), buzzer (≈30 mA) |

That is roughly **450–500 mA** at peak, which is at the edge of what a USB port
plus the devkit regulator will deliver reliably. Symptoms of an under-powered
board are exactly the ones that look like software faults: camera init fails,
Wi-Fi drops during an upload, the board browns out when the buzzer fires.

Use a **5 V / 2 A** supply and, if the camera resets during captures, power the
3.3 V rail from a separate LDO with a common ground.

---

## 5. Physical validation order

Flash `bench_test/` first. It prints a checklist and shows live status on the
OLED. Do not skip a step because a previous one "worked before the rewiring".

| # | Check | Expected |
|---|---|---|
| 1 | `pio run -d esp32/SmartBus-ESP32/bench_test -t upload` | build + upload succeed |
| 2 | Serial monitor at 115200 | `PSRAM: found`, `OLED: OK`, `chip version 0x91/0x92` |
| 3 | OLED | banner + status lines |
| 4 | White LED then red LED | 3 blinks each |
| 5 | Buzzer | one short chirp |
| 6 | Camera | `captured N bytes (320x240)` |
| 7 | GPS (outdoors) | NMEA lines, then `[GPS] lat=… lon=…` |
| 8 | SOS button | `[SOS] button pressed` per press |
| 9 | Card | `[RFID] UID: …` |

Only when all nine pass should the full firmware be flashed.

---

## 6. Known limitation of the current prototype wiring

The RC522 uses SPI on GPIO 1/2/14/21/42 while the camera uses its own 8-bit
parallel bus. There is no electrical conflict, but the RC522 and the camera
share the 3.3 V rail and both are noisy loads; a 100 µF electrolytic across the
3.3 V rail near the camera connector avoids frame corruption during a card scan.
This has **not** been measured on the bench yet — it is a precaution, not a
finding.
