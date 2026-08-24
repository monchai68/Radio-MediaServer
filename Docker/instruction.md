# ติดตั้งและทดสอบบน Raspberry Pi 3B แบบ Headless

เอกสารนี้เป็นขั้นตอนสำหรับ Raspberry Pi 3B ที่เพิ่งติดตั้ง Raspberry Pi OS แบบ headless เพื่อทดสอบ Docker deployment ของโปรเจกต์นี้

ชุดนี้รองรับ Internet Radio, DLNA, MPD, การเก็บข้อมูลสถานีใน volume และ Bluetooth speaker. Wi-Fi settings และ Power Off จากหน้าเว็บยังไม่รวมในการทดสอบนี้

## สรุปลำดับการติดตั้ง

ทำตามลำดับนี้เพื่อให้ระบุปัญหาได้ง่าย: ติดตั้ง Docker/MPD บน host > ยืนยัน `mpc status` > ส่ง source > build/start container > ทดสอบ Radio และ volume > ติดตั้ง BlueZ/BlueALSA > ตั้ง MPD Bluetooth output > rebuild container > pair/connect speaker และทดสอบเสียง

MPD, BlueZ และ BlueALSA ทำงานบน Pi host. Container ทำหน้าที่เป็น Flask web app, `mpc` client และ `bluetoothctl` client เท่านั้น

## สิ่งที่ต้องเตรียม

- Raspberry Pi 3B พร้อม microSD, network และไฟเลี้ยงที่เสถียร
- คอมพิวเตอร์ Windows ที่มี source project นี้อยู่ที่ `D:\code\Flask\PiZero2W`
- Raspberry Pi Imager สำหรับเขียน Raspberry Pi OS
- LAN เดียวกันระหว่าง Windows, Pi และ DLNA Media Server (ถ้าจะทดสอบ DLNA)

Pi 3B ใช้ได้ทั้ง Raspberry Pi OS 32-bit และ 64-bit. Dockerfile จะ build image ตาม architecture ของ Pi โดยอัตโนมัติเมื่อ build บน Pi. Raspberry Pi OS 64-bit แนะนำสำหรับการใช้งานใหม่

## 1. เขียน Raspberry Pi OS และเปิด SSH

1. เปิด Raspberry Pi Imager แล้วเลือก `Raspberry Pi OS Lite (64-bit)` หรือรุ่น 32-bit หากจำเป็น
2. กดปุ่มตั้งค่า (รูปเฟือง) ก่อนเขียน SD card แล้วตั้งค่า:
   - hostname เช่น `piradio3b`
   - username และ password ที่รัดกุม
   - Wi-Fi SSID/password หากจะต่อ Wi-Fi
   - locale/time zone
   - เปิด `Enable SSH` และเลือก password authentication หรือ public key
3. เขียน SD card, ใส่ใน Pi แล้วเปิดเครื่อง
4. หา IP ของ Pi จากหน้า router หรือใช้ hostname ที่ตั้งไว้ แล้วเชื่อมต่อจาก PowerShell:

   ```powershell
   ssh <pi-user>@piradio3b.local
   ```

ใช้ IP แทน `piradio3b.local` ได้ เช่น `ssh monchai68@192.168.1.50`

## 2. อัปเดตระบบและติดตั้ง Docker/MPD

รันคำสั่งต่อไปนี้ผ่าน SSH บน Pi:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y docker.io docker-compose mpd mpc
sudo systemctl enable --now docker mpd
sudo usermod -aG docker $USER
```

ออกจาก SSH แล้วเชื่อมใหม่หนึ่งครั้ง เพื่อให้ group `docker` มีผล:

```bash
exit
ssh <pi-user>@piradio3b.local
docker --version
docker compose version
mpc status
```

Pi ที่ทดสอบในเอกสารนี้ใช้ Docker Compose V2 และใช้คำสั่ง `docker compose` (ไม่มีขีดกลาง) ตลอดคู่มือ. หาก `docker compose version` ใช้ไม่ได้ แต่ `docker-compose --version` ใช้ได้ ให้เปลี่ยนทุกคำสั่ง `docker compose` ในเอกสารนี้เป็น `docker-compose` แทน

## 3. ตรวจ MPD บน host ก่อนใช้ Docker

container จะเชื่อม MPD ที่รันอยู่บน host ด้วย `MPD_HOST=127.0.0.1` และ port `6600` ดังนั้นต้องให้คำสั่งนี้ทำงานบน Pi ก่อน:

```bash
mpc status
```

หากเชื่อมต่อไม่ได้ ให้ตรวจ service และ port:

```bash
sudo systemctl status mpd --no-pager
sudo ss -ltnp | grep 6600
```

ผลลัพธ์ลักษณะนี้ถือว่า MPD ใช้งานได้ แม้ยังไม่มีเพลงใน queue:

```text
volume: n/a   repeat: off   random: off   single: off   consume: off
```

`volume: n/a` หมายถึง output ยังไม่มี mixer จึงปรับเสียงจากหน้าเว็บหรือ `mpc volume` ไม่ได้. สำหรับ ALSA output ให้แก้ block `audio_output` ที่ใช้งานใน `/etc/mpd.conf` ให้มี `mixer_type "software"` แล้ว restart:

```conf
audio_output {
   type            "alsa"
   name            "My ALSA Device"
   device          "default"
   mixer_type      "software"
}
```

```bash
sudo systemctl restart mpd
mpc volume 30
mpc status
```

หลังแก้สำเร็จ ต้องเห็น `volume: 30%` หรือค่าเปอร์เซ็นต์อื่น แทน `volume: n/a`. หาก restart ไม่ผ่าน ให้ตรวจ syntax และ audio device ก่อนแก้ต่อ:

```bash
sudo systemctl status mpd.service --no-pager -l
sudo journalctl -u mpd.service -n 80 --no-pager
```

## 4. ส่ง source project จาก Windows ไป Pi

บน Windows PowerShell ให้สร้างปลายทางบน Pi ก่อน แล้วเปิดที่ project root เพื่อส่ง source ไปที่ home directory ของ Pi. คำสั่งนี้ไม่ส่ง `.venv`, `.git`, cache, backup หรือ runtime data:

```powershell
ssh <pi-user>@piradio3b.local "mkdir -p ~/radio-server"
Set-Location D:\code\Flask\PiZero2W
scp -r app.py stations.json requirements.txt templates static Docker <pi-user>@piradio3b.local:~/radio-server
```

ถ้าใช้ IP ให้แทนปลายทางตัวอย่างเป็น `<pi-user>@192.168.1.50:~/radio-server`

ต้องมีปลายทาง `<pi-user>@...:~/radio-server` ต่อท้ายเสมอ. หากสั่ง `scp` โดยไม่มีปลายทาง โปรแกรมจะมองชื่อไฟล์สุดท้ายเป็นปลายทางและอาจแสดง error เช่น `.dockerignore: Not a directory`. โปรเจกต์นี้ไม่จำเป็นต้องส่ง `.dockerignore` เพื่อ deploy นี้

ตรวจไฟล์บน Pi:

```bash
ssh <pi-user>@piradio3b.local
cd ~/radio-server/Docker
ls -la
```

ต้องเห็นอย่างน้อย `Dockerfile`, `compose.yaml`, `entrypoint.sh`, `requirements.txt` และ `wsgi.py`

## 5. Build และ start container

ยังอยู่บน Pi ให้สั่ง:

```bash
cd ~/radio-server/Docker
docker compose build
docker compose up -d
docker compose ps
```

การ build ครั้งแรกบน Pi 3B อาจใช้เวลาหลายนาที โดยเฉพาะการดาวน์โหลด Python image และติดตั้ง Python packages. อย่าตัดไฟระหว่าง build

ตรวจ log:

```bash
docker compose logs --tail=100 piradio
```

สถานะปกติควรเห็น container `piradio` เป็น `running` และไม่มี Python traceback

## 6. Smoke Test

### ตรวจ Flask API บน Pi

เพราะ Compose ใช้ `network_mode: host` web app จะฟังที่ port `5000` ของ Pi โดยตรง:

```bash
curl -fsS http://127.0.0.1:5000/api/status
curl -fsS http://127.0.0.1:5000/api/data
```

ผลลัพธ์ `/api/status` ควรเป็น JSON และมี `"available": true`. หากเป็น `false` ให้ตรวจ MPD ตามหัวข้อ 3 และสั่งทดสอบจากใน container:

```bash
docker compose exec piradio mpc status
```

### เปิดหน้าเว็บจากเครื่องใน LAN

ดู IP ของ Pi:

```bash
hostname -I
```

จาก browser บน Windows หรือมือถือ เปิด:

```text
http://<pi-ip>:5000
```

ทดสอบตามลำดับ:

1. เลือก Internet Radio หนึ่งสถานี แล้วกด Play
2. ตรวจสถานะจากหน้าเว็บและ `mpc status` บน Pi
3. สลับ Media Server และกด Refresh Servers เพื่อตรวจ DLNA discovery
4. เลือกเพลง DLNA แล้วตรวจว่า MPD queue มีรายการด้วย `mpc playlist`

DLNA discovery ต้องมี media server อยู่ LAN/subnet เดียวกัน และบาง router หรือ Wi-Fi isolation อาจบล็อก SSDP multicast

## 7. ตรวจข้อมูล persistent

ครั้งแรกที่ container start จะสร้าง `Docker/data/stations.json` โดยคัดลอกค่าเริ่มต้นที่ build อยู่ใน image. การแก้สถานีและ playback mode จากเว็บหลังจากนั้นจะเขียนไฟล์นี้:

```bash
cd ~/radio-server/Docker
ls -la data
cat data/stations.json
```

source `~/radio-server/stations.json` จะไม่ถูกแก้โดย container. สำรอง data ก่อน update หรือ rebuild สำคัญ:

```bash
tar -czf ~/piradio-data-backup-$(date +%F).tar.gz ~/radio-server/Docker/data
```

## 8. เปิดใช้ Bluetooth speaker

การ connect Bluetooth สำเร็จยืนยันเพียงการเชื่อมต่อระหว่าง Pi และ speaker; เพื่อให้มีเสียง ต้องมี BlueALSA ที่สร้าง ALSA route และต้องตั้ง MPD output ให้ชี้ไปที่ speaker นั้นด้วย

Bluetooth daemon และ audio backend ต้องรันบน host; container ใช้ `bluetoothctl` เพื่อสั่งงานผ่าน system D-Bus ของ host เท่านั้น. ติดตั้ง BlueZ และ BlueALSA บน Pi:

```bash
sudo apt update
sudo apt install -y bluez bluez-alsa-utils
sudo systemctl enable --now bluetooth bluealsa
sudo rfkill unblock bluetooth
bluetoothctl show
```

หาก `bluetoothctl show` แสดง `Powered: no` ให้เปิด controller:

```bash
bluetoothctl power on
```

หาก `bluealsa` ไม่มี service หรือไม่พบ ALSA device `bluealsa` ให้ตรวจ package ที่ Raspberry Pi OS รุ่นนั้นมี แล้วติดตั้ง bluez-alsa backend:

```bash
apt search bluez-alsa
aplay -L | grep bluealsa
```

เปิด speaker ให้อยู่ใน pairing mode แล้วหา MAC address. เมื่อเชื่อมจากหน้าเว็บสำเร็จ ให้ใช้ผลลัพธ์นี้ยืนยัน MAC ที่ connected:

```bash
bluetoothctl devices Connected
```

จากนั้นตั้ง MPD output สำหรับ speaker หนึ่งตัว. แทน `<speaker-mac>` ด้วย MAC address ของ speaker เช่น `AA:BB:CC:DD:EE:FF`:

```bash
sudo nano /etc/mpd.conf
```

เพิ่มหรือแก้ block นี้ โดยชื่อ `Bluetooth Speaker` ต้องตรงตามนี้:

```conf
audio_output {
   type            "alsa"
   name            "Bluetooth Speaker"
   device          "bluealsa:DEV=<speaker-mac>,PROFILE=a2dp"
   mixer_type      "software"
}
```

Restart MPD และตรวจว่า output ถูกพบ:

```bash
sudo systemctl restart mpd
mpc outputs
mpc status
```

ต้องเห็น output ชื่อ `Bluetooth Speaker` จาก `mpc outputs`. ชื่อนี้จำเป็น เพราะแอปเปิด output ตามชื่อนี้เมื่อเชื่อม speaker. หาก output อื่นกำลัง active ให้จดหมายเลขจาก `mpc outputs` แล้วปิด output เดิมและเปิด Bluetooth output:

```bash
mpc disable <existing-output-id>
mpc enable <bluetooth-output-id>
```

ส่ง Docker files ที่แก้ไขแล้วจาก Windows ตามหัวข้อ 4 แล้ว rebuild container เพื่อเพิ่ม `bluetoothctl` และ mount system D-Bus socket:

```bash
cd ~/radio-server/Docker
grep bluez Dockerfile
grep system_bus_socket compose.yaml
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
docker compose exec piradio bluetoothctl show
curl -fsS http://127.0.0.1:5000/api/bluetooth/status
```

`grep bluez Dockerfile` ต้องแสดง `bluez mpc` และ `grep system_bus_socket compose.yaml` ต้องแสดง D-Bus mount. การ build แบบ `--no-cache` และ `--force-recreate` สำคัญเมื่อ container เดิมขึ้น error `bluetoothctl: executable file not found in $PATH`; error นี้หมายถึง container ยังใช้ image เก่า

ผลของ API ต้องมี `"available":true`. เปิดหน้าเว็บที่ `http://<pi-ip>:5000`, เข้า Settings > Bluetooth, เปิด Bluetooth, กด Scan for Devices และเลือก Connect ที่ speaker. เมื่อเชื่อมสำเร็จ เว็บจะเปิด MPD output ชื่อ `Bluetooth Speaker` อัตโนมัติ

ทดสอบบน Pi:

```bash
bluetoothctl devices Connected
aplay -L | grep -i bluealsa
mpc outputs
mpc status
```

ก่อนทดสอบเสียง ต้องเห็นทั้ง speaker ใน `bluetoothctl devices Connected`, device `bluealsa:` จาก `aplay -L` และ `Bluetooth Speaker` จาก `mpc outputs`. จากนั้นเลือกสถานีในหน้าเว็บและกด Play. `mpc status` ต้องแสดง `state: playing` และ speaker ต้องมีเสียง

Mount system D-Bus ทำให้ process ใน container ควบคุม Bluetooth ของ Pi ได้. หน้าเว็บนี้ไม่มี authentication จึงควรใช้เฉพาะ LAN ที่เชื่อถือได้ และห้าม port-forward port 5000 ออก Internet

## คำสั่งใช้งานประจำ

```bash
cd ~/radio-server/Docker
docker compose ps
docker compose logs -f piradio
docker compose restart piradio
docker compose down
docker compose up -d
docker compose up -d --build
```

`restart: unless-stopped` ทำให้ container เริ่มใหม่หลัง Pi boot เมื่อ Docker service ทำงาน

## อัปเดต source ภายหลัง

1. ส่งไฟล์ที่เปลี่ยนจาก Windows ด้วย `scp` ตามหัวข้อ 4
2. บน Pi รัน:

   ```bash
   cd ~/radio-server/Docker
   docker compose up -d --build
   docker compose logs --tail=100 piradio
   ```

อย่าลบ `Docker/data/` หากต้องการคงสถานี, รายการโปรด, playback mode และ audio state เดิม

**สำคัญ**: Pi 3B ที่ deploy ด้วย Docker Compose ชุดนี้ **ไม่มี** systemd unit ชื่อ `radio.service` (unit นั้นมีเฉพาะ deployment แบบเก่าบน Pi Zero 2W ที่รัน Flask ตรง ๆ ด้วย `python`/`gunicorn`) ห้ามใช้ `sudo systemctl restart radio.service` เพื่อ deploy โค้ดใหม่บนเครื่องนี้ ให้ใช้ `docker compose up -d --build` เท่านั้น ดูหัวข้อ "Port 5000 ถูกใช้งานอยู่" ด้านล่างหากเจอ error `Unit radio.service not found`

## ปัญหาที่พบบ่อย

### `Failed to restart radio.service: Unit radio.service not found`

เป็นเรื่องปกติบน Pi 3B ชุดนี้ เพราะ deploy ด้วย Docker Compose ไม่ได้ตั้ง systemd unit `radio.service` ไว้ (unit นี้มีเฉพาะ Pi เครื่องเก่าที่ยังไม่ dockerize) ให้ redeploy ด้วยคำสั่งนี้แทน:

```bash
cd ~/radio-server/Docker
docker compose up -d --build
docker compose logs --tail=100 piradio
```

### Port 5000 ถูกใช้งานอยู่

หากเคยใช้ Flask ผ่าน `radio.service` อยู่แล้ว ให้หยุด service เก่าก่อน:

```bash
sudo systemctl disable --now radio.service
```

ตรวจ process ที่ใช้ port:

```bash
sudo ss -ltnp | grep 5000
```

### container ขึ้นแล้ว แต่ `/api/status` ส่ง `available: false`

MPD host ไม่พร้อม หรือ `mpc` ใน container เชื่อม host MPD ไม่ได้. ตรวจตามลำดับ:

```bash
mpc status
cd ~/radio-server/Docker
docker compose exec piradio mpc status
docker compose logs --tail=100 piradio
```

### ไม่มีเสียง

Docker/Flask อาจทำงานปกติแต่ MPD ยังไม่มี audio output ที่ใช้งานได้. ตรวจ output, playback และ service:

```bash
mpc outputs
mpc status
sudo systemctl status mpd --no-pager
```

แก้ `/etc/mpd.conf` ตามอุปกรณ์เสียงจริง แล้ว restart MPD:

```bash
sudo systemctl restart mpd
```

### Bluetooth connect ได้ แต่ speaker ไม่มีเสียง

ปัญหานี้มักเกิดเมื่อ pair/connect สำเร็จ แต่ยังไม่มี BlueALSA route, MPD output `Bluetooth Speaker` ไม่ถูกสร้าง หรือ MPD เปิด output ผิดตัว. ตรวจตามลำดับนี้:

```bash
bluetoothctl devices Connected
sudo systemctl status bluealsa --no-pager
aplay -L | grep -i bluealsa
mpc outputs
mpc status
```

แนวทางแก้:

1. หากไม่มี speaker ใน `devices Connected` ให้ reconnect จากหน้าเว็บหรือ `bluetoothctl`
2. หาก `bluealsa:` ไม่ปรากฏ ให้ติดตั้ง/เปิด `bluez-alsa-utils` และ `bluealsa` ตามหัวข้อ 8
3. หาก `mpc outputs` ไม่มี `Bluetooth Speaker` ให้เพิ่ม block MPD ตามหัวข้อ 8 โดยใช้ MAC ของ speaker ที่ connected อยู่ แล้ว `sudo systemctl restart mpd`
4. หากมี output แล้วแต่ไม่ active ให้ `mpc enable <bluetooth-output-id>` และ disable output อื่นที่ไม่ต้องการ
5. หาก `mpc status` ไม่แสดง `playing` ให้เลือกสถานีแล้วกด Play ใหม่จากหน้าเว็บ

### Bluetooth ในเว็บขึ้น unavailable

ตรวจ BlueZ บน host, D-Bus mount และ image ที่ build ใหม่ตามหัวข้อ 8:

```bash
sudo systemctl status bluetooth bluealsa --no-pager
cd ~/radio-server/Docker
docker compose exec piradio bluetoothctl show
curl -fsS http://127.0.0.1:5000/api/bluetooth/status
```

หากขึ้น `bluetoothctl: executable file not found in $PATH` ให้ทำ rebuild แบบเต็มตามหัวข้อ 8; container กำลังใช้ image เก่าที่ไม่มี package `bluez`

หาก `bluetoothctl show` บน host หรือใน container ไม่พบ controller ให้ตรวจว่าถูก block หรือไม่:

```bash
rfkill list bluetooth
sudo rfkill unblock bluetooth
```

### Wi-Fi ในเว็บขึ้น unavailable

เป็นพฤติกรรมที่คาดไว้ เพราะ Docker image ชุดนี้ยังไม่ติดตั้ง `nmcli` หรือ host authorization ที่จำเป็นสำหรับ feature นี้

### รีสตาร์ต/ปิดเครื่องแล้วไม่กลับมาเล่นสถานีวิทยุ หรือ output เดิม (เล่นเพลงจาก media server/DLNA ค้างมาแทน)

แอปจะจำ output (jack/bluetooth) และสถานีวิทยุล่าสุดไว้ใน `Docker/data/audio_state.json` แล้ว resume อัตโนมัติตอนบูตผ่าน `restore_last_audio_output()` ใน `app.py` ปัญหานี้เคยเกิดจาก MPD เองมีกลไก auto-resume คิวเพลงเดิมของตัวเอง (จาก `state_file` ใน `mpd.conf`) ซึ่งอาจ resume เพลงจาก DLNA/media server ค้างไว้ก่อนที่แอปจะเข้ามา override ทัน (เช่น MPD ยังไม่พร้อมตอนแอปพยายาม resume) โค้ดปัจจุบันแก้แล้วด้วยการรอ MPD พร้อมจริงก่อน (`wait_for_mpd()`) และ retry คำสั่ง resume สถานีสูงสุด 3 ครั้ง หากยังเจอปัญหานี้อยู่ ให้ตรวจตามลำดับ:

```bash
cat ~/radio-server/Docker/data/audio_state.json
cd ~/radio-server/Docker
docker compose logs --tail=200 piradio | grep -i -E "mpd|mpc|restore"
mpc status
mpc outputs
```

1. ตรวจว่า `audio_state.json` มี `last_station_id` ตรงกับสถานีที่เล่นค้างไว้ก่อน poweroff จริงหรือไม่ (ถ้าไม่มี/เป็น `null` แสดงว่า `/api/play/<id>` ยังไม่เคยถูกเรียกสำเร็จ หรือถูก `/api/stop` เคลียร์ไปก่อนปิดเครื่อง)
2. ถ้า `last_station_id` ถูกต้องแต่ยังไม่ resume ให้ตรวจว่า container/`app.py` เป็นเวอร์ชันล่าสุดที่มี `wait_for_mpd()` และ `mpc_cmd()` เช็ค returncode จริง (ไม่ใช่เวอร์ชันเก่าที่ `mpc_cmd()` return `True` เสมอ) ให้ redeploy ตามหัวข้อ "อัปเดต source ภายหลัง"
3. ถ้ายังไม่หาย ให้ปิด auto-resume ของ MPD เองใน `/etc/mpd.conf` (ลบ/คอมเมนต์บรรทัด `state_file`) แล้ว `sudo systemctl restart mpd` เพื่อไม่ให้ MPD แข่ง resume คิวเก่าของตัวเอง

## Rollback กลับไปใช้ service เดิม

หากต้องกลับไปใช้งานแบบเดิม:

```bash
cd ~/radio-server/Docker
docker compose down
sudo systemctl enable --now radio.service
```

ตรวจว่า `radio.service` ถูกตั้งให้รัน source path ที่ถูกต้องก่อน enable. หาก service เดิมไม่ได้อยู่บน Pi 3B เครื่องนี้ ให้ข้ามขั้นตอน rollback ได้