# Modified: DLNA Media Server Mode

วันที่ทดสอบ: 2026-08-15

## สรุป

เพิ่มโหมด Media Server สำหรับค้นหาและเล่นเพลงจาก DLNA/UPnP Media Server ร่วมกับโหมด Internet Radio เดิม โดยใช้ Flask, `upnpclient` และ MPD/MPC ที่มีอยู่แล้วบน Raspberry Pi OS Headless

## การเปลี่ยนแปลงในโค้ด

### Backend: `app.py`

- เพิ่ม playback mode สองค่า:
  - `radio`
  - `media_server`
- บันทึก mode ล่าสุดไว้ใน `stations.json` และรองรับข้อมูลเก่าที่ไม่มี field นี้ โดย default เป็น `radio`
- เพิ่ม API:
  - `GET /api/mode`
  - `PUT /api/mode`
  - `GET /api/dlna/servers`
  - `GET /api/dlna/browse`
  - `POST /api/dlna/play`
- ปรับ `/api/status` ให้ส่ง `mode` และ `current_url`
- เพิ่ม DLNA discovery ผ่าน SSDP
- เพิ่ม cache รายการ server 20 วินาที
- รองรับการค้นหา `ContentDirectory` ใน embedded UPnP device
- แก้ discovery ให้ไม่ค้างเมื่อมีอุปกรณ์บางตัวตอบช้าหรือ descriptor ใช้เวลานาน โดยแยก SSDP scan และโหลด device descriptor ด้วย timeout
- เพิ่ม pagination สำหรับ DLNA browse:
  - ค่าเริ่มต้นครั้งละ 50 รายการ
  - จำกัดสูงสุด 100 รายการต่อ request
  - รองรับ `starting_index` และ `requested_count`
  - ส่ง `number_returned` และ `total_matches` กลับใน response
- แก้ปัญหา MiniDLNA ที่ตอบข้อมูลเพลงจำนวนมากพร้อมกันจน XML parser ล้มด้วย error `PCDATA invalid Char value`
- ปรับการส่ง URL ให้ `mpc add` รับ URL เป็น argument แยก ไม่แยกด้วย whitespace

### Frontend

ไฟล์ที่อัปเดต:

- `templates/index.html`
  - เพิ่มปุ่มสลับ `Radio` / `Media Server`
  - เพิ่มหน้ารายการ server, breadcrumb และรายการ folder/track
- `static/app.js`
  - เพิ่ม state ของ mode และ DLNA navigation
  - รองรับ server -> folder -> track
  - รองรับเล่นเพลงผ่าน `/api/dlna/play`
  - ปรับ status polling ให้รองรับทั้ง Radio และ Media Server
  - ป้องกันการใช้ station management ใน media mode
- `static/style.css`
  - เพิ่ม style สำหรับ mode switch, DLNA folder, track และ breadcrumb
- เพิ่ม cache-busting version ใน `templates/index.html` เพื่อป้องกัน browser ใช้ JavaScript/CSS รุ่นเก่า

### Dependencies

เพิ่ม `requirements.txt`:

```text
Flask>=3.0
upnpclient>=1.0.3
```

บน Raspberry Pi ติดตั้งใน virtual environment:

```bash
cd ~/radio-server
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## ผลการทดสอบบน Raspberry Pi

เครื่องทดสอบ:

```text
Raspberry Pi IP: 192.168.1.114
OS: Raspberry Pi OS headless
Python: 3.13 ใน .venv
MPD: 0.24.0
```

### SSDP discovery

ค้นพบ DLNA/UPnP server ได้ 4 รายการ:

- `M-Syno`
- `MinimServer[M-Syno]`
- `F6107A: Media Server:`
- `Mon-Ugreen`

โดย `Mon-Ugreen` อยู่ที่:

```text
http://192.168.1.200:8200/rootDesc.xml
```

และมี service:

```text
urn:schemas-upnp-org:service:ContentDirectory:1
```

### Browse

ทดสอบสำเร็จตามลำดับ:

```text
Root -> Music -> All Music
```

ผลลัพธ์:

```text
items returned: 50
total matches: 11828
```

พบ track ตัวอย่าง:

```text
title: oldie country songs
url: http://192.168.1.200:8200/MediaItems/158.mp3
```

### Flask process

รันด้วย virtual environment และเปิดใช้งานที่:

```text
http://192.168.1.114:5000
```

คำสั่งรัน:

```bash
cd ~/radio-server
source .venv/bin/activate
python app.py
```

หรือ:

```bash
~/radio-server/.venv/bin/python ~/radio-server/app.py
```

## สถานะปัจจุบัน

- โหมด Radio เดิมยังใช้ MPD/MPC ได้
- โหมด Media Server ค้นหา DLNA server ได้
- Browse folder และรายการเพลงได้
- รองรับรายการเพลงจำนวนมากด้วย pagination ฝั่ง API
- เลือก track แล้วส่ง URL ให้ MPD เล่นได้
- โค้ดใน workspace VS Code และโค้ดที่ deploy บน Raspberry Pi มีการแก้ discovery/pagination รุ่นเดียวกัน

## ข้อควรทราบ

- ตอนนี้ API แบ่งผลลัพธ์เป็นหน้าๆ ละ 50 รายการ แต่ UI ยังแสดงชุดแรกของแต่ละ folder เป็นหลัก
- หากต้องการดูรายการถัดไปจำนวนมาก ควรเพิ่มปุ่ม `Next page` / `Previous page` ใน UI โดยเรียก `starting_index` ของ API
- สำหรับการใช้งานจริงควรเปลี่ยนจาก Flask development server ไปใช้ systemd + Gunicorn หรือ Waitress ตามสภาพแวดล้อมของ Raspberry Pi

---

# Modified: Bluetooth Settings (Connect ลำโพงบลูทูธ)

วันที่ทดสอบ: 2026-08-17

## สรุป

เพิ่มปุ่ม Settings (ไอคอนฟันเฟือง มุมขวาบน) เปิด popup รายการตั้งค่า เริ่มทำ **Bluetooth** ก่อน (Wi-Fi ทำเป็นลำดับถัดไป ตอนนี้เป็น placeholder) โดยหน้า Bluetooth รองรับเปิด/ปิดบลูทูธ, สแกนหาอุปกรณ์ใกล้เคียง, และ connect/disconnect ลำโพงบลูทูธ พร้อมสลับ audio output ของ MPD ให้อัตโนมัติ

## การเปลี่ยนแปลงในโค้ด

### Backend: `app.py`

- ควบคุม Bluetooth ผ่าน `bluetoothctl` โดยสั่งงานแบบ non-interactive (เขียนคำสั่งเข้า stdin แทนการพิมพ์ทีละบรรทัด)
- เพิ่มฟังก์ชันหลัก: `run_bluetoothctl`, `get_bluetooth_status`, `set_bluetooth_power`, `list_bluetooth_devices`, `scan_bluetooth_devices`, `bluetooth_connect_device`, `bluetooth_disconnect_device`
- เพิ่ม API:
  - `GET /api/bluetooth/status`
  - `PUT /api/bluetooth/power`
  - `GET /api/bluetooth/devices`
  - `POST /api/bluetooth/scan` (สแกนประมาณ 8 วินาที)
  - `POST /api/bluetooth/connect`
  - `POST /api/bluetooth/disconnect`
- เพิ่มการสลับ MPD audio output อัตโนมัติ (`switch_mpd_output`, `mpc_output_id_by_name`) โดยอ้างอิงชื่อ output ที่ตั้งไว้ใน `mpd.conf`:
  - `USB Headphone` (แจ็คหูฟัง)
  - `Bluetooth Speaker` (ลำโพงบลูทูธ)
  - Connect สำเร็จ → enable `Bluetooth Speaker`, disable `USB Headphone`
  - Disconnect หรือปิด Bluetooth → สลับกลับไป enable `USB Headphone`, disable `Bluetooth Speaker`
- ฝั่ง local (Windows, ไม่มี `bluetoothctl`) ทุกฟังก์ชัน fallback คืนค่า `available: false` แทนที่จะ error 500

### Frontend

- `templates/index.html`: เพิ่มปุ่ม Settings (⚙️) ใน header, เพิ่ม modal `#settingsModal` (รายการ Bluetooth / Wi-Fi) และ modal `#bluetoothModal` (toggle เปิด-ปิด, ปุ่ม Scan, รายการอุปกรณ์)
- `static/app.js`: เพิ่มฟังก์ชัน `openSettingsModal`, `openBluetoothModal`, `loadBluetoothStatus`, `loadBluetoothDevices`, `scanBluetoothDevices`, `toggleBluetoothPower`, `connectBluetoothDevice`, `disconnectBluetoothDevice` พร้อมแสดงสถานะปุ่ม "Connecting..." / "Disconnecting..." และ `alert` เมื่อเกิด error
- `static/style.css`: เพิ่ม style สำหรับ header/ปุ่ม settings, settings list, toggle switch, รายการอุปกรณ์บลูทูธ
- เพิ่ม cache-busting version (`?v=20260817b`) ให้ `style.css` และ `app.js`

## ปัญหาที่เจอระหว่างพัฒนา และวิธีแก้

1. **"Bluetooth is unavailable on this device"**
   - สาเหตุ: ทดสอบบน Windows (local) ซึ่งไม่มีคำสั่ง `bluetoothctl`
   - วิธีแก้: ต้อง deploy ไปรันบน Raspberry Pi จริง และติดตั้ง `bluez` (`sudo apt install bluez`) พร้อมเปิด service (`sudo systemctl enable --now bluetooth`)

2. **`PowerState: off-blocked` เปิด Bluetooth ไม่ติด**
   - สาเหตุ: ถูก `rfkill` soft-block ไว้ (ค่า default ของระบบ)
   - วิธีแก้: `sudo rfkill unblock bluetooth` แล้ว `sudo systemctl restart bluetooth`

3. **กด Connect แล้วไม่มีอะไรเกิดขึ้น (เงียบ ไม่มี error)**
   - สาเหตุ: pairing บางครั้งรอ agent confirm prompt จนครบ timeout (20 วิ) แล้ว backend คืน error แต่ frontend เดิมไม่ได้แสดง error ให้เห็น
   - วิธีแก้: เพิ่ม `agent NoInputNoOutput` + `default-agent` ก่อน pair (auto-accept แบบ Just Works), และแก้ frontend ให้ขึ้น `alert()` พร้อมข้อความ error จริงเมื่อ connect/disconnect ล้มเหลว, เพิ่มสถานะปุ่ม "Connecting..." ระหว่างรอ

4. **กด Connect สำเร็จชั่วครู่แล้วเด้งกลับเป็นสถานะเดิม (ไม่ connected)**
   - สาเหตุ (ยืนยันด้วยการทดสอบ `bluetoothctl` ด้วยมือ): เดิมโค้ดส่งคำสั่ง `pair` → `trust` → `connect` → `quit` เข้า stdin รวดเดียวแบบไม่มีหน่วงเวลา ทำให้คำสั่ง `connect`ไปชนกับจังหวะที่ BlueZ ตัดการเชื่อมต่ออัตโนมัติหลัง pairing เสร็จ (พฤติกรรมปกติของ BlueZ คือ pair สำเร็จแล้วจะ disconnect เองก่อน ต้องสั่ง connect แยกอีกครั้งถึงจะติดค้าง)
   - วิธีแก้: เปลี่ยนมาใช้ `subprocess.Popen` เขียนคำสั่งทีละคำสั่งพร้อมหน่วงเวลา (`time.sleep`) ระหว่าง `pair` (รอ 3 วิ) → `trust` (รอ 1 วิ) → `connect` (รอ 3 วิ) ก่อนส่ง `quit` เลียนแบบจังหวะการพิมพ์คำสั่งด้วยมือที่ทดสอบแล้วใช้งานได้จริงบนลำโพง `WZ-BT5.0`

5. **Connect ติดแล้วแต่เสียงไม่ออกลำโพงบลูทูธ**
   - สาเหตุ: การ pair/connect บลูทูธ ไม่ได้ทำให้ MPD เปลี่ยนเส้นทางเสียงให้อัตโนมัติ ต้องตั้งค่า MPD audio output เพิ่มเอง
   - วิธีแก้บน Pi:
     - ติดตั้ง `bluez-alsa-utils` เพื่อให้มี ALSA PCM device ชื่อ `bluealsa` (เช็คด้วย `aplay -L | grep -i bluealsa`)
     - เพิ่ม `audio_output` สองตัวใน `/etc/mpd.conf`: `USB Headphone` (เดิม) และ `Bluetooth Speaker` (ใหม่, `device "bluealsa"`)
     - `sudo systemctl restart mpd` แล้วทดสอบสลับด้วย `mpc outputs` / `mpc enable` / `mpc disable`
   - หลังยืนยันว่าใช้งานได้ด้วยมือ จึงเพิ่มโค้ดให้แอปสลับ output ให้อัตโนมัติตอน connect/disconnect ผ่านฟังก์ชัน `switch_mpd_output` (อ้างอิงชื่อ output ตรงกับที่ตั้งไว้ใน `mpd.conf`)

## ผลการทดสอบบน Raspberry Pi Zero 2 W

- Controller: `B8:27:EB:80:D1:A2`
- ลำโพงที่ทดสอบ: `WZ-BT5.0` (MAC `7C:1F:2E:C4:29:5B`)
- Pairing และ Connect สำเร็จ ค้างสถานะ `Connected: yes` และมี Transport/Endpoint (`sep1`) ถูกสร้างสำหรับ A2DP
- MPD outputs: `Output 1 (USB Headphone)`, `Output 2 (Bluetooth Speaker)` — สลับเปิด/ปิดด้วย `mpc enable` / `mpc disable` แล้วเสียงออกลำโพงบลูทูธได้จริง

## สถานะปัจจุบัน

- เปิด/ปิด Bluetooth, สแกน, connect/disconnect อุปกรณ์ผ่านหน้าเว็บได้แล้ว
- Audio output สลับไปลำโพงบลูทูธอัตโนมัติเมื่อ connect สำเร็จ และสลับกลับแจ็คหูฟังเมื่อ disconnect/ปิด Bluetooth
- Wi-Fi settings ยังเป็น placeholder "Coming soon" รอทำต่อ

## ข้อควรทราบ

- ชื่อ MPD output (`USB Headphone`, `Bluetooth Speaker`) ถูก hardcode ไว้ในโค้ด (`app.py`) ต้องตั้งชื่อใน `mpd.conf` ให้ตรงกันทุกตัวอักษรถึงจะสลับได้ถูกต้อง
- ฟีเจอร์นี้ทดสอบได้เฉพาะบน Raspberry Pi จริงเท่านั้น (ฝั่ง Windows local ไม่มี `bluetoothctl`/`mpc` จะ fallback เป็น unavailable เสมอ)
- การจับคู่แบบ auto-accept (`NoInputNoOutput`) เหมาะกับลำโพงที่ใช้ Just Works pairing เท่านั้น หากมีอุปกรณ์ที่ต้องกรอก PIN/passkey อาจต้องปรับ agent เป็นแบบอื่นเพิ่มเติม

---

# Modified: Wi-Fi Settings (สแกน/เชื่อมต่อ Wi-Fi + Hotspot ตั้งค่าครั้งแรก)

วันที่ทดสอบ: 2026-08-17

## สรุป

เปิดใช้งานเมนู **Wi-Fi** ใน Settings (จากที่เดิมเป็น placeholder "Coming soon") ให้สแกนหาเครือข่ายใกล้เคียง เลือกเชื่อมต่อพร้อมใส่รหัสผ่านได้จากหน้าเว็บ และเตรียมระบบ Hotspot สำรอง (`PiRadio-Setup`) สำหรับตอนติดตั้งเครื่องครั้งแรกที่ยังไม่มี Wi-Fi ให้เชื่อมต่อ โดยใช้ `nmcli` (NetworkManager) ควบคุมทั้งหมด เนื่องจาก Pi เครื่องนี้ใช้ NetworkManager อยู่แล้ว (ยืนยันด้วย `nmcli --version` = 1.52.1)

## การเปลี่ยนแปลงในโค้ด

### Backend: `app.py`

- เพิ่มฟังก์ชันหลัก: `run_nmcli` (สั่งงานผ่าน `sudo nmcli` เหมือน pattern ของ `/api/poweroff`), `get_wifi_status`, `scan_wifi_networks`, `connect_wifi_network`, `forget_wifi_network`, `stop_wifi_hotspot`
- เพิ่ม API:
  - `GET /api/wifi/status` — สถานะปัจจุบัน (connected/SSID/IP/hotspot กำลังทำงานไหม)
  - `GET /api/wifi/scan` — สแกน SSID พร้อมความแรงสัญญาณ, ล็อก/ไม่ล็อก, saved ไหม
  - `POST /api/wifi/connect` `{ssid, password}` — เชื่อมต่อเครือข่าย (ปิด hotspot setup ให้อัตโนมัติก่อนเสมอ)
  - `POST /api/wifi/forget` `{ssid}` — ลบ connection ที่บันทึกไว้
- เตรียม Hotspot fallback connection ชื่อ `PiRadio-Setup` (รหัสผ่านเริ่มต้น `piradio1234`, บังคับ band `bg`/2.4GHz ให้ตรงกับฮาร์ดแวร์ Pi Zero 2 W) ผ่านสคริปต์แยกต่างหาก ไม่ได้ผูกกับ Flask โดยตรง

### Scripts ใหม่ (สำหรับติดตั้งบน Pi ด้วย `sudo`)

- `scripts/wifi-fallback.sh` — รอ 25 วินาทีหลังบูต ถ้ายังไม่มี Wi-Fi client เชื่อมต่อ จะสร้าง/เปิด hotspot `PiRadio-Setup` ให้มือถือ/คอมมาต่อแล้วเข้าเว็บที่ IP ของ hotspot (ปกติ `10.42.0.1:5000`) เพื่อเลือก Wi-Fi จริงผ่านหน้า Settings
- `scripts/wifi-fallback.service` — systemd unit สำหรับรันสคริปต์ตอนบูตอัตโนมัติ (ตามที่เลือกไว้ตอนออกแบบ)

### Frontend

- `templates/index.html`: เปิดใช้งานปุ่ม Wi-Fi ใน `#settingsModal`, เพิ่ม modal `#wifiModal` (สถานะ, ปุ่ม Scan, รายการเครือข่าย, ฟอร์มกรอกรหัสผ่านก่อน Connect)
- `static/app.js`: เพิ่มฟังก์ชัน `openWifiModal`, `loadWifiStatus`, `scanWifiNetworks`, `renderWifiNetworks`, `selectWifiNetwork`, `submitWifiConnect`, `cancelWifiConnect` พร้อม error handling (`.catch()`) ให้ขึ้นข้อความ error แทนที่จะค้างเงียบๆ
- `static/style.css`: เพิ่ม style สำหรับฟอร์มกรอกรหัสผ่าน Wi-Fi (`.wifi-connect-form`)
- เพิ่ม cache-busting version (`?v=20260817d`) ให้ `style.css` และ `app.js`

## ปัญหาที่เจอระหว่างพัฒนา และวิธีแก้

1. **FileZilla copy ไฟล์ script ไปที่ `/usr/local/bin/` แล้ว Permission denied**
   - สาเหตุ: SFTP เชื่อมต่อด้วย user ธรรมดา ไม่มีสิทธิ์เขียนโฟลเดอร์ระบบโดยตรง
   - วิธีแก้: upload ไฟล์ไปไว้ที่ home directory ก่อน แล้วใช้ `sudo cp` ย้ายเข้า `/usr/local/bin/` และ `/etc/systemd/system/` ผ่าน SSH terminal อีกที

2. **`sudo cp .../PiZero2W/scripts/wifi-fallback.sh ...` → No such file or directory**
   - สาเหตุ: ไฟล์ไม่ได้ถูกอัปโหลดไปที่ path ที่คาดไว้จริง (คำสั่ง `cp` ก่อนหน้าเผลอรันในเทอร์มินัล Windows ซึ่งไม่มีผลกับ Pi เลย)
   - วิธีแก้: ใช้ `find / -name "wifi-fallback*" 2>/dev/null` หา path จริงที่ FileZilla วางไฟล์ไว้ ก่อนค่อย `sudo cp` ให้ตรง

3. **หน้า Wi-Fi ค้างที่ "Checking status..." และไม่มีรายชื่อ Wi-Fi ขึ้นเลย**
   - สาเหตุแรก: โค้ด JS เดิม (`loadWifiStatus`, `scanWifiNetworks`) ไม่มี `.catch()` ถ้า fetch หรือ parse JSON ล้มเหลว หน้าจะค้างเงียบๆ ไม่แจ้ง error อะไรเลย
   - วิธีแก้: เพิ่ม `.catch()` ให้ทั้งสองฟังก์ชัน แสดงข้อความ error ที่ชัดเจนแทน

4. **"Scan failed: request error" แม้จะแก้ error handling แล้ว**
   - สาเหตุที่แท้จริง (ใหญ่สุดของรอบนี้): ไฟล์ที่ scp ไปอัปเดตทั้งหมดถูกส่งไปที่ `/home/monchai68/PiZero2W/` แต่ **แอปที่รันจริงบนเครื่องถูกคุมด้วย `radio.service` (systemd) และอยู่คนละโฟลเดอร์คือ `/home/monchai68/radio-server/`** ทำให้โค้ดใหม่ไม่มีผลกับแอปที่ให้บริการอยู่จริงเลยสักรอบ (แอปเก่าไม่มี route `/api/wifi/scan` จึงล้มเหลว)
   - วิธีตรวจสอบ: หา process ที่ถือ port 5000 ด้วย `sudo ss -tulpn | grep 5000` ได้ PID แล้วเช็คด้วย `systemctl list-units --type=service | grep -i -E "radio|flask|app"` เจอว่าเป็น `radio.service`
   - วิธีแก้: scp ไฟล์ทั้งหมดไปที่ `/home/monchai68/radio-server/` ให้ตรง path จริง แล้ว `sudo systemctl restart radio.service` เพื่อให้โค้ดใหม่มีผล

5. **Wi-Fi สแกนเจอเฉพาะคลื่น 2.4GHz ไม่เห็นเครือข่าย 5GHz เลย**
   - สาเหตุ: ไม่ใช่บั๊ก แต่เป็นข้อจำกัดฮาร์ดแวร์ — ชิป Wi-Fi ของ Raspberry Pi Zero 2 W (Cypress/Broadcom CYW43438) รองรับเฉพาะ 2.4GHz (802.11 b/g/n) เท่านั้น ไม่มี 5GHz มาให้ในตัวเครื่อง
   - ข้อสรุป: ต้องเลือกเชื่อมต่อ SSID ฝั่ง 2.4GHz ของ router เท่านั้น ซึ่งสอดคล้องกับที่ตั้ง hotspot fallback ไว้เป็น `band bg` อยู่แล้ว ไม่ต้องแก้โค้ดเพิ่ม

## ผลการทดสอบบน Raspberry Pi Zero 2 W

- Network manager: `nmcli` เวอร์ชัน 1.52.1 (ใช้ NetworkManager)
- แอปจริงรันด้วย systemd service ชื่อ `radio.service` ที่โฟลเดอร์ `/home/monchai68/radio-server/` (ไม่ใช่ `~/PiZero2W` ตามที่เข้าใจตอนแรก)
- `sudo nmcli device wifi rescan` รันผ่านได้ทันทีไม่ถามรหัสผ่าน ยืนยันว่า sudoers ตั้ง `NOPASSWD: /usr/bin/nmcli` ถูกต้องแล้ว
- หลัง restart `radio.service` ด้วยโค้ดที่ path ถูกต้อง: สแกนเจอรายชื่อ Wi-Fi 2.4GHz ได้สำเร็จ

## สถานะปัจจุบัน

- สแกนหาและเชื่อมต่อ Wi-Fi ผ่านหน้าเว็บได้แล้ว (เฉพาะคลื่น 2.4GHz ตามข้อจำกัดฮาร์ดแวร์)
- Hotspot fallback (`scripts/wifi-fallback.sh` + `.service`) เตรียมพร้อมสำหรับติดตั้งบน Pi แต่ยังไม่ได้ enable ใช้งานจริงบนเครื่อง (รอผู้ใช้ทดสอบและ enable ตามขั้นตอนที่ให้ไว้)
- ยืนยันแล้วว่า path การ deploy จริงบนเครื่องคือ `/home/monchai68/radio-server/` ควบคุมด้วย `radio.service`

## ข้อควรทราบ

- **สำคัญมาก**: การ deploy ไฟล์ทุกครั้งต่อจากนี้ต้อง scp ไปที่ `/home/monchai68/radio-server/` แล้ว `sudo systemctl restart radio.service` เท่านั้น ห้าม copy ไปที่ `/home/monchai68/PiZero2W/` อีก เพราะไม่มีผลกับแอปที่รันจริง
- ต้องตั้ง sudoers `NOPASSWD: /usr/bin/nmcli` ให้ user ที่รัน `radio.service` ก่อน ไม่งั้น scan/connect Wi-Fi จาก UI จะล้มเหลว (ตั้งไว้เรียบร้อยแล้วในการทดสอบนี้)
- Hotspot fallback ใช้รหัสผ่าน default `piradio1234` — ควรเปลี่ยนก่อนใช้งานจริงเพื่อความปลอดภัย (แก้ในไฟล์ `scripts/wifi-fallback.sh`)
- Pi Zero 2 W รองรับ Wi-Fi 2.4GHz เท่านั้น ไม่ต้องพยายามหาเครือข่าย 5GHz

---

# Modified: Resume DLNA Directory and Track Metadata

วันที่ปรับปรุง: 2026-09-01

## สรุป

เมื่อเครื่องเริ่มทำงานและหน้าเว็บอยู่ในโหมด `media_server` ระบบจะเปิดรายการเพลงของ directory ที่เล่นล่าสุดให้โดยอัตโนมัติ โดยไม่ต้องค้นหาโฟลเดอร์ใหม่ ผู้ใช้ต้องกดเล่นเพลงจาก Media Server อย่างน้อยหนึ่งครั้งก่อน เพื่อให้ระบบมีข้อมูล directory และเพลงล่าสุดสำหรับ restore

เพิ่ม fallback สำหรับชื่อเพลงและศิลปินด้วย เพื่อให้ Docker แสดง metadata ได้แม้ MPD ยังไม่คืน tag จาก URL ของ DLNA ตอนเริ่มระบบ

## การเปลี่ยนแปลงในโค้ด

### Backend: `app.py`

- เพิ่ม API `GET /api/dlna/directory` สำหรับคืนค่า directory ล่าสุด
- เมื่อ `POST /api/dlna/play` เล่นสำเร็จ จะบันทึก `last_dlna_directory` ลง `stations.json` โดยมีข้อมูล:
  - `server_id`
  - `container_id`
  - `breadcrumb`
  - `track.id`
  - `track.url`
  - `track.title`
  - `track.artist`
- รองรับ `stations.json` รุ่นเก่าที่ยังไม่มี `last_dlna_directory` หรือ `track` โดยไม่ทำให้แอปล้ม
- บันทึกข้อมูลหลังคำสั่ง MPD/MPC สำเร็จเท่านั้น จึงไม่ทับค่า directory เดิมเมื่อเล่นเพลงไม่สำเร็จ

### Frontend: `static/app.js`

- เมื่อเปิดหน้าเว็บในโหมด `media_server` จะค้นหา DLNA server และเรียก `GET /api/dlna/directory`
- หากพบ server เดิม จะ restore breadcrumb และ browse directory ล่าสุดเพื่อแสดง folder/รายการเพลงทันที
- กรณี DLNA server ตอบช้าระหว่าง boot จะ retry discovery/restore ทุก 5 วินาที สูงสุด 6 ครั้ง
- ใช้ `track.title` และ `track.artist` ที่บันทึกไว้เป็น fallback เมื่อ `/api/status` ไม่ได้รับ metadata จาก MPD โดยเฉพาะกรณี MPD ใน Docker ยังไม่อ่าน tag ของ DLNA URL

## การ Deploy

ต้องอัปเดต 2 ไฟล์พร้อมกัน:

- `app.py`
- `static/app.js`

ไม่ต้อง copy `stations.json` จากเครื่องพัฒนา เพราะไฟล์บน Pi มีข้อมูลสถานีของเครื่องนั้นอยู่แล้ว หลัง deploy ให้กดเล่นเพลงหนึ่งเพลงใน Media Server เพื่อให้ server สร้างหรืออัปเดต `last_dlna_directory` ของเครื่องนั้น

### Pi Zero 2 W (systemd)

Copy ไฟล์ไปที่ `/home/monchai68/radio-server/` แล้ว restart:

```bash
sudo systemctl restart radio.service
```

### Pi 3B (Docker)

Copy source เข้า `~/radio-server/` ตามโครงสร้างเดิม แล้ว rebuild container:

```bash
cd ~/radio-server/Docker
docker compose up -d --build
```

ข้อมูล runtime ของ Docker อยู่ใน `Docker/data/stations.json` ผ่าน volume `/data`; ห้ามแทนที่ไฟล์นี้ด้วย `stations.json` จากเครื่องพัฒนา

## การตรวจสอบ

- `python -m py_compile app.py` ผ่าน
- ทดสอบ Flask test client: `GET /api/dlna/directory` ตอบ HTTP 200 และคืนค่า title/artist ที่บันทึกใน state ได้
- VS Code diagnostics ของ `app.py` และ `static/app.js` ไม่มี error

## ข้อควรทราบ

- ถ้าเปิดเว็บก่อน DLNA server พร้อม ระบบจะ retry รวมประมาณ 30 วินาที; หลังจากนั้นสามารถกด refresh server จากหน้า Media Server ได้ตามปกติ
- ถ้าเปลี่ยนไปเล่นเพลงจาก server หรือ directory อื่น ระบบจะบันทึกตำแหน่งใหม่เมื่อเริ่มเล่นเพลงนั้นสำเร็จ
- Metadata fallback จะแสดงข้อมูลของเพลงที่เลือกเล่นล่าสุด ไม่ได้ใช้ทดแทน metadata แบบ real-time ของทุกเพลงใน MPD queue

---

# Modified (แผนที่ออกแบบไว้ ยังไม่ได้ implement): Power Off บน Docker (Pi 3B) แยกจาก Pi Zero 2 W

วันที่ออกแบบ: 2026-09-02

## สรุป

ปุ่ม Power Off บนหน้าเว็บใช้ไม่ได้เมื่อรันผ่าน Docker (Pi 3B) เพราะ container ไม่มี `sudo` และไม่มีสิทธิ์สั่งปิดเครื่องจริงของ host (ดู [troubleshooting.md](troubleshooting.md) ข้อ 5) ในขณะที่ Pi Zero 2 W (bare-metal, `radio.service`) ใช้งานปุ่มนี้ได้ปกติอยู่แล้ว เนื่องจาก `app.py` เป็นไฟล์เดียวที่ deploy ทั้งสองที่ จึงต้องออกแบบให้แก้เฉพาะฝั่ง Docker โดยไม่กระทบพฤติกรรมเดิมของ Pi Zero 2 W เลย

## หลักการ

- **Privilege separation**: container ไม่ควรมีสิทธิ์ปิดเครื่อง host โดยตรง (ห้ามใช้ `privileged: true` เพราะให้สิทธิ์เกินจำเป็น) ต้องมี helper ที่รันนอก container (บน host, เป็น root) เป็นผู้สั่ง `poweroff` จริง แล้ว container คุยกับ helper ผ่านช่องทางที่จำกัดสิทธิ์แคบที่สุด (Unix domain socket)
- **Feature detection แทน OS detection**: โค้ดใน `app.py` ต้อง "แยกจาก Pi Zero 2 W" โดยเช็คว่ามี resource ที่ตั้งค่าเฉพาะ Docker หรือไม่ (env var ชี้ path ของ socket) ไม่ใช่เช็ค hostname/OS ตรงๆ — ถ้าไม่พบ resource นี้ (เช่นบน Pi Zero 2 W ที่ไม่เคยตั้ง env var นี้เลย) โค้ดจะ fallback ไปใช้ `sudo /sbin/poweroff` แบบเดิมทุกบรรทัด ไม่มีการเปลี่ยนพฤติกรรมเดิมแม้แต่น้อย

## วิธีการ (ออกแบบไว้)

1. **Host helper** (ติดตั้งบน Pi 3B host เท่านั้น ไม่ bake เข้า Docker image):
   - สคริปต์ Python เปิด Unix socket ที่ `/run/piradio/poweroff.sock` รอรับข้อความ `"poweroff"` แล้วเรียก `/sbin/poweroff` จริง
   - คุมด้วย systemd unit แยก (`RuntimeDirectory=piradio`, `User=root`, `Restart=always`) ให้สร้าง `/run/piradio` ใหม่ทุกครั้งที่บูต
2. **Docker compose**: เพิ่ม env var `PIRADIO_POWEROFF_SOCKET=/run/piradio/poweroff.sock` และ bind mount `/run/piradio:/run/piradio` เข้า container (แก้เฉพาะ `Docker/compose.yaml`)
3. **`app.py`**: `/api/poweroff` เช็ค `os.environ.get("PIRADIO_POWEROFF_SOCKET")` ก่อน — ถ้ามีค่า ให้เชื่อมต่อ Unix socket แล้วส่งคำสั่งไปหา helper; ถ้าไม่มีค่า (กรณี Pi Zero 2 W) ให้ใช้ `subprocess.Popen(["sudo", "/sbin/poweroff"])` เหมือนเดิมทุกประการ

## ความปลอดภัย

- Socket permission `0600` เจ้าของ root:root — container รันเป็น root (ไม่มี `USER` ใน `Docker/Dockerfile`) จึงเชื่อมต่อได้ ฝั่งอื่นเชื่อมต่อไม่ได้
- Helper รับได้เฉพาะข้อความคงที่ `"poweroff"` เท่านั้น ไม่ interpolate เป็น shell command ใดๆ ป้องกัน command injection
- ไม่เปิด TCP หรือ expose สู่ network ใดๆ จำกัดอยู่แค่ local Unix socket ที่ bind-mount ระหว่าง host กับ container เดียวกันเท่านั้น

## ทางเลือกที่พิจารณาแล้วแต่ไม่เลือก

- **D-Bus** (reuse `/run/dbus/system_bus_socket` ที่ mount ไว้แล้วสำหรับ Bluetooth): ไม่ต้องเพิ่ม volume ใหม่ แต่ต้องเขียน D-Bus service + policy file บนhost เพิ่ม ซับซ้อนกว่า
- **`privileged: true`**: ง่ายสุดแต่ให้สิทธิ์เกินจำเป็นมาก (เข้าถึง host devices ทั้งหมด) — ขัดกับที่ `PiZero2W-Dockerize-Plan.md` ระบุไว้ชัดว่าไม่ควรทำ
- **ไฟล์ trigger + systemd path unit (watch ไฟล์)**: ไม่ต้องเขียน daemon เอง แต่มี polling latency และจัดการ race condition/cleanup ไฟล์ยุ่งกว่า

## สถานะปัจจุบัน

- Implement แล้วในโค้ด: `Docker/scripts/piradio-poweroff-helper.py`, `Docker/scripts/piradio-poweroff-helper.service` (ไฟล์ใหม่), `Docker/compose.yaml` และ `app.py` (`/api/poweroff`) แก้ไขเรียบร้อยแล้ว
- **ยังไม่ได้ติดตั้งจริงบนเครื่อง Pi 3B** ต้อง copy `piradio-poweroff-helper.py`/`.service` ไปที่ host แล้ว enable systemd service เอง (ดูขั้นตอนติดตั้งด้านล่าง) ก่อนที่ `docker compose up -d --build` รอบถัดไปปุ่ม Power Off ในหน้าเว็บถึงจะทำงานได้จริงบน Pi 3B
- Pi Zero 2 W ไม่ได้รับผลกระทบใดๆ เพราะไม่เคยตั้ง env var `PIRADIO_POWEROFF_SOCKET` เลย โค้ดจึง fallback ไปใช้ `sudo /sbin/poweroff` แบบเดิมเป๊ะ

## ขั้นตอนติดตั้งบน Pi 3B (host, นอก container)

1. จากเครื่อง Windows (ในโฟลเดอร์ `Docker/scripts`) scp ไฟล์ไปไว้ที่ **home directory** ของ `pi3@piradio3b` ก่อน (ห้าม scp ตรงไปที่ `/usr/local/bin` หรือ `/etc/systemd/system` เด็ดขาด เพราะ user `pi3` ผ่าน SFTP ไม่มีสิทธิ์เขียนโฟลเดอร์ระบบ จะได้ `Permission denied` เงียบๆ):
   ```powershell
   scp .\piradio-poweroff-helper.py pi3@piradio3b:~/
   scp .\piradio-poweroff-helper.service pi3@piradio3b:~/
   ```
2. SSH เข้าเครื่อง Pi 3B แล้วค่อยใช้ `sudo cp` ย้ายไฟล์จาก home directory เข้าตำแหน่งจริง (รันคำสั่งต่อไปนี้ **บน Pi ผ่าน SSH เท่านั้น** ไม่ใช่ใน terminal ของ Windows):
   ```bash
   ssh pi3@piradio3b
   sudo cp ~/piradio-poweroff-helper.py /usr/local/bin/piradio-poweroff-helper.py
   sudo chmod 755 /usr/local/bin/piradio-poweroff-helper.py
   sudo cp ~/piradio-poweroff-helper.service /etc/systemd/system/piradio-poweroff-helper.service
   ```
3. Reload systemd แล้ว enable + start service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now piradio-poweroff-helper.service
   sudo systemctl status piradio-poweroff-helper.service
   ```
   ต้องขึ้นสถานะ `active (running)` และคำสั่ง `ls -l /run/piradio/poweroff.sock` ต้องเห็นไฟล์ socket อยู่ (permission `srw-------` เจ้าของ root)
4. Deploy โค้ดที่แก้แล้ว (`app.py`, `Docker/compose.yaml`) เข้าไปที่ `~/radio-server/` แล้ว rebuild container ตามปกติ:
   ```bash
   cd ~/radio-server/Docker
   docker compose up -d --build
   ```
5. ทดสอบ:
   - เข้าเว็บ `http://<IP ของ Pi 3B>:5000` กดปุ่ม Power Off แดง แล้วเครื่องต้องปิดจริง
   - ถ้ากดแล้วไม่มีอะไรเกิดขึ้น ให้ตรวจ log ของ helper ด้วย `journalctl -u piradio-poweroff-helper.service -f` ระหว่างกดปุ่ม และตรวจว่า container เห็น socket ไหมด้วย `docker compose exec piradio ls -l /run/piradio/`

## ข้อควรทราบเพิ่มเติม

- Helper service ต้อง **enable ไว้ถาวร** (`systemctl enable`) ไม่ใช่แค่ `start` ครั้งเดียว เพราะ `/run` เป็น tmpfs จะหายไปทุกครั้งที่รีบูต ต้องให้ systemd สร้าง socket ใหม่ตอนบูตทุกครั้ง
- ถ้าย้าย/เปลี่ยนชื่อ container หรือรัน container ด้วย user ที่ไม่ใช่ root ในอนาคต ต้องทบทวน permission ของ socket (`0600` root:root) ใหม่ เพราะตอนนี้ใช้ได้เพราะ container รันเป็น root (ไม่มี `USER` ใน `Docker/Dockerfile`)
- ยังไม่ได้ทดสอบบนฮาร์ดแวร์ Pi 3B จริง (โค้ด compile ผ่านและ diagnostics ไม่มี error เท่านั้น) ต้องทดสอบตามขั้นตอนข้างบนก่อนถือว่าใช้งานได้จริง

