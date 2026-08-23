# Pi Zero 2 W Internet Radio and DLNA Player

เว็บแอป Flask สำหรับ Raspberry Pi Zero 2 W ที่ควบคุม MPD เพื่อเล่น Internet Radio และเพลงจาก DLNA/UPnP Media Server ผ่านเบราว์เซอร์บนเครือข่ายเดียวกัน

## ความสามารถ

- เล่น หยุด พัก และปรับเสียง Internet Radio
- จัดการหมวดหมู่ สถานี และรายการโปรดจากหน้าเว็บ
- ค้นหา DLNA/UPnP Media Server, เปิดโฟลเดอร์ และเล่นเพลงผ่าน MPD
- จัดการ Bluetooth: เปิด/ปิด, สแกน, pair, connect และ disconnect ลำโพง
- สลับ MPD audio output ระหว่างแจ็คหูฟัง/USB กับ Bluetooth โดยอัตโนมัติ
- สแกนและเชื่อมต่อ Wi-Fi จากหน้าเว็บผ่าน NetworkManager
- เปิด hotspot สำรองสำหรับการตั้งค่า Wi-Fi ครั้งแรก
- จำ audio output และ playback mode ล่าสุดไว้หลังรีสตาร์ต

## สถาปัตยกรรม

แอปนี้เป็น web controller ไม่ได้เล่นเสียงเองโดยตรง:

```text
Browser -> Flask web app -> mpc -> MPD -> ALSA / BlueALSA -> speaker
                         |
                         +-> upnpclient -> DLNA/UPnP server on LAN

Flask web app -> bluetoothctl -> BlueZ
Flask web app -> sudo nmcli -> NetworkManager
```

ดังนั้น Raspberry Pi ต้องรัน MPD, BlueZ และ NetworkManager บนระบบปฏิบัติการก่อนจึงจะใช้งานฟีเจอร์ที่เกี่ยวข้องได้

## ข้อกำหนด

### Runtime บน Raspberry Pi

- Raspberry Pi OS ที่เชื่อมต่อเครือข่ายได้
- Python 3 และ `venv`
- MPD และ client `mpc`
- BlueZ (`bluetoothctl`) สำหรับ Bluetooth
- `bluez-alsa-utils` หากต้องการส่งเสียงไป Bluetooth speaker ผ่าน ALSA
- NetworkManager (`nmcli`) สำหรับ Wi-Fi setup และ fallback hotspot

Pi Zero 2 W รองรับ Wi-Fi เฉพาะคลื่น 2.4 GHz; เครือข่าย 5 GHz จะไม่ปรากฏในรายการสแกน

### ติดตั้งแพ็กเกจระบบ

ชื่อแพ็กเกจอาจต่างกันตาม Raspberry Pi OS รุ่นที่ใช้ แต่ตัวอย่างนี้ใช้ระบบที่มี APT:

```bash
sudo apt update
sudo apt install -y python3 python3-venv mpd mpc bluez bluez-alsa-utils network-manager
sudo systemctl enable --now mpd bluetooth NetworkManager
```

หาก Bluetooth ถูก block ให้ปลดก่อน:

```bash
sudo rfkill unblock bluetooth
sudo systemctl restart bluetooth
```

## ติดตั้งและรันแอป

```bash
git clone <repository-url> ~/radio-server
cd ~/radio-server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python app.py
```

จากอุปกรณ์ใน LAN เปิด `http://<pi-ip>:5000`

สำหรับการใช้งานต่อเนื่อง ควรรันแอปด้วย systemd และ production WSGI server แทน Flask development server

## การตั้งค่าเสียง MPD

โค้ดอ้างอิงชื่อ MPD output ต่อไปนี้แบบตรงตัว:

- `USB Headphone`
- `Bluetooth Speaker`

กำหนด output เหล่านี้ใน `/etc/mpd.conf` ให้ตรงกับอุปกรณ์ของเครื่อง ตัวอย่างส่วน Bluetooth ใช้ BlueALSA:

```conf
audio_output {
    type "alsa"
    name "Bluetooth Speaker"
    device "bluealsa"
}
```

หลังแก้ไข ให้รีสตาร์ต MPD และตรวจสอบชื่อ output:

```bash
sudo systemctl restart mpd
mpc outputs
```

การเชื่อมต่อ Bluetooth จากแอปใช้ `NoInputNoOutput` agent จึงเหมาะกับลำโพงที่ pair แบบ Just Works เท่านั้น

## สิทธิ์สำหรับ Wi-Fi และ Power Off

แอปเรียก `sudo nmcli` และ `sudo /sbin/poweroff` เพื่อให้คำสั่งจากหน้าเว็บมีผลกับเครื่องจริง จึงต้องอนุญาตเฉพาะคำสั่งเหล่านี้ให้ user ที่รันแอป โดยแก้ผ่าน `visudo`:

```sudoers
<app-user> ALL=(root) NOPASSWD: /usr/bin/nmcli, /sbin/poweroff
```

แทน `<app-user>` ด้วยชื่อ user ที่ใช้รัน service เช่น `monchai68` และยืนยันตำแหน่งจริงของคำสั่งด้วย `command -v nmcli` และ `command -v poweroff`

**สำคัญ:** แอปไม่มีระบบยืนยันตัวตน และมี endpoint สำหรับเปลี่ยน Wi-Fi/Bluetooth รวมถึงปิดเครื่อง ห้ามเปิด port `5000` สู่ Internet โดยตรง ควรใช้งานบน trusted LAN เท่านั้น หรือวาง reverse proxy ที่มี authentication ไว้ด้านหน้า

## Wi-Fi Fallback Hotspot

เมื่อ Pi บูตแล้วเชื่อมต่อ Wi-Fi ไม่ได้ภายใน 25 วินาที สคริปต์จะเปิด hotspot ชื่อ `PiRadio-Setup` เพื่อให้เข้าเว็บไปเลือก Wi-Fi จริง

ก่อนเปิดใช้จริง ให้เปลี่ยน `HOTSPOT_PASSWORD` ใน [scripts/wifi-fallback.sh](scripts/wifi-fallback.sh) จากค่าเริ่มต้น จากนั้นติดตั้ง systemd service:

```bash
sudo install -m 755 scripts/wifi-fallback.sh /usr/local/bin/wifi-fallback.sh
sudo install -m 644 scripts/wifi-fallback.service /etc/systemd/system/wifi-fallback.service
sudo systemctl daemon-reload
sudo systemctl enable --now wifi-fallback.service
```

service นี้ต้องรันบน host OS และไม่ใช่ส่วนหนึ่งของ Flask process

## ข้อมูลที่บันทึก

- `stations.json`: หมวดหมู่ สถานี รายการโปรด และ playback mode ล่าสุด
- `audio_state.json`: สถานะ audio output ล่าสุด; จะถูกสร้างหลังมีการสลับ output

สำรองสองไฟล์นี้ก่อนอัปเกรดเครื่องหรือย้ายไป Pi เครื่องใหม่

## API หลัก

| กลุ่ม | Endpoint |
| --- | --- |
| สถานี/หมวดหมู่ | `GET /api/data`, `GET/POST /api/categories`, `GET/POST /api/stations` |
| Playback | `GET /api/play/<id>`, `GET /api/pause`, `GET /api/resume`, `GET /api/stop`, `GET /api/status`, `GET /api/volume/<0-100>` |
| Mode และ DLNA | `GET/PUT /api/mode`, `GET /api/dlna/servers`, `GET /api/dlna/browse`, `POST /api/dlna/play` |
| Bluetooth | `GET /api/bluetooth/status`, `GET /api/bluetooth/devices`, `POST /api/bluetooth/scan`, `POST /api/bluetooth/connect` |
| Wi-Fi | `GET /api/wifi/status`, `GET /api/wifi/scan`, `POST /api/wifi/connect`, `POST /api/wifi/forget` |

การเปลี่ยนแปลง data ใช้ JSON request body; ดู validation และ response รายละเอียดได้จาก [app.py](app.py)

## Docker

มีแผน Docker อยู่ใน [PiZero2W-Dockerize-Plan.md](PiZero2W-Dockerize-Plan.md) แต่ยังไม่มี Dockerfile หรือ Compose file ใน repository นี้

แนวทางที่ตั้งใจคือ containerize เฉพาะ Flask app ขณะที่ MPD, BlueZ, NetworkManager และ Wi-Fi fallback service ยังคงอยู่บน host OS เพราะต้องควบคุมฮาร์ดแวร์และ system daemon โดยตรง ก่อนนำแผนไปทำจริง ควรพิจารณาข้อแก้ไขในส่วน "Docker Plan Review" ของเอกสารแผน

## โครงสร้างโปรเจกต์

```text
app.py                         Flask API และ integration กับ MPD/BlueZ/NetworkManager/DLNA
stations.json                  ข้อมูลสถานี หมวดหมู่ และ playback mode
templates/index.html           หน้าเว็บหลัก
static/app.js                  UI state และการเรียก API
static/style.css               รูปแบบหน้าเว็บ
scripts/wifi-fallback.sh       สร้าง hotspot เมื่อไม่มี Wi-Fi
scripts/wifi-fallback.service  systemd unit ของ fallback hotspot
```