# Dockerize Internet Radio & DLNA Media Player (PiZero2W)

> สร้างเมื่อ: 2026-08-23
> โปรเจกต์ต้นทาง: `D:\code\Flask\PiZero2W`
> เป้าหมาย: แปลง Flask web app (Internet Radio + DLNA Media Player) ให้รันเป็น Docker container เพื่อติดตั้งซ้ำใน Raspberry Pi เครื่องอื่นได้ง่าย

---

## สรุปสิ่งที่พบจากการอ่านโค้ด

โปรเจกต์นี้ไม่ใช่ Flask app ธรรมดา แต่พึ่งพาบริการ/ฮาร์ดแวร์ของระบบปฏิบัติการ (Raspberry Pi OS) หลายจุด:

| ฟีเจอร์ | กลไกที่ใช้ | ผูกกับระบบยังไง |
|---|---|---|
| เล่นวิทยุ/ไฟล์เพลง | `mpc` (CLI) → คุยกับ **MPD** daemon | MPD ต้องรันบนโฮสต์ (คุมฮาร์ดแวร์เสียงจริง) |
| ค้นหา/เล่นจาก DLNA | `upnpclient` (SSDP multicast) | ต้องอยู่ใน network เดียวกับ LAN จริง (multicast ข้าม NAT ของ Docker ไม่ได้ถ้าไม่ตั้งค่า) |
| Bluetooth (สแกน/เชื่อมต่อลำโพง) | `bluetoothctl` (BlueZ ผ่าน D-Bus) | ต้องมี BlueZ + D-Bus ของโฮสต์ |
| Wi-Fi (สแกน/เชื่อมต่อ/hotspot) | `sudo nmcli` (NetworkManager) | ต้องมี NetworkManager ของโฮสต์ + sudoers `NOPASSWD` |
| ปิดเครื่อง | `sudo /sbin/poweroff` | ต้องมีสิทธิ์คุมระบบจริง |
| สลับ audio output (USB/Bluetooth) | `mpc enable/disable` อิง config ใน `/etc/mpd.conf` | ชื่อ output ต้องตรงกับที่ตั้งไว้บนโฮสต์ |
| Wi-Fi fallback hotspot ตอนบูต | `scripts/wifi-fallback.sh` + `wifi-fallback.service` | เป็น systemd service แยก **ไม่ได้รันผ่าน Flask** |

**ข้อสรุปเชิงสถาปัตยกรรม:** แนวทางที่เหมาะสมที่สุดคือ **containerize เฉพาะตัว Flask app** แล้วให้มันคุยออกไปหา MPD / BlueZ / NetworkManager ที่ยังรันอยู่บนโฮสต์ (ผ่าน network + D-Bus socket mount) ไม่ใช่พยายามยัด MPD/Bluetooth/NetworkManager ทั้งชุดเข้าไปในคอนเทนเนอร์ด้วย เพราะสิ่งเหล่านี้ผูกกับฮาร์ดแวร์และ service ที่ควรมีอินสแตนซ์เดียวต่อเครื่องอยู่แล้ว ส่วน `wifi-fallback.service` ยังคงต้องติดตั้งบนโฮสต์แยกต่างหาก (อยู่นอกขอบเขต Docker)

---

## ขั้นตอนทั้งหมด (Roadmap)

### Phase 1 — เตรียมโค้ดให้พร้อมสำหรับ Docker
1. แยกไฟล์ config ที่เปลี่ยนบ่อย (เช่น `stations.json`, `audio_state.json`) ออกมาเป็น path ที่ mount เป็น volume ได้ ไม่ฝังอยู่ใน image
2. เพิ่ม production WSGI server แทน Flask dev server — เลือก `waitress` (มีอยู่ใน `.venv` แล้ว) หรือ `gunicorn`
3. ทำ `requirements.txt` ให้ครบ (เพิ่ม `waitress` หรือ `gunicorn` เข้าไปด้วย)
4. เพิ่ม environment variable สำหรับค่าที่ควร config ได้ตอนรัน เช่น `MPD_HOST`, `MPD_PORT`, พอร์ตเว็บ
5. ลบ/ไม่ commit โฟลเดอร์ `.venv`, `__pycache__`, `Backup/` เข้า build context (เตรียม `.dockerignore`)

### Phase 2 — ตัดสินใจสถาปัตยกรรม Container ↔ Host
6. กำหนดให้ **MPD, BlueZ (bluetoothctl), NetworkManager (nmcli)** ยังคงรันบนโฮสต์ Raspberry Pi OS ตามเดิม (ติดตั้งครั้งเดียวตอน provision เครื่องใหม่ ไม่ใช่หน้าที่ของ Docker image)
7. วางแผนให้ container คุยกับ MPD ผ่านเครือข่าย: ตั้ง `MPD_HOST=127.0.0.1` และรัน container แบบ `--network host` (ง่ายสุดบน Pi เครื่องเดียว, ยังรองรับ SSDP multicast ของ DLNA ด้วย)
8. วางแผน mount `/var/run/dbus` (และอาจต้อง `/run/dbus`) เข้า container เพื่อให้ `bluetoothctl` และ `nmcli` ที่รันข้างในคอนเทนเนอร์คุยกับ daemon จริงบนโฮสต์ได้
9. วางแผนเรื่องสิทธิ์ `sudo` ภายใน container สำหรับคำสั่ง `nmcli`/`poweroff` — พิจารณาว่าจะ (ก) รัน container เป็น root + คง sudoers/binary เดิม หรือ (ข) ปรับโค้ดให้ไม่ต้องพึ่ง `sudo` โดยให้สิทธิ์ผ่าน capability/policykit แทน
10. บันทึกข้อจำกัดที่ยอมรับได้ เช่น "poweroff จาก container จะปิดตัวเครื่องจริงของโฮสต์" (พฤติกรรมที่ต้องการอยู่แล้ว แต่ต้อง test ให้แน่ใจว่า mount/permission ถูกต้อง)

### Phase 3 — เขียน Dockerfile
11. เลือก base image ที่รองรับสถาปัตยกรรม ARM ของ Pi Zero 2 W (arm64/aarch64 หรือ armv7 ขึ้นกับ OS ที่ลง) เช่น `python:3.13-slim`
12. เขียน Dockerfile: COPY โค้ด, `pip install -r requirements.txt --break-system-packages` หรือใช้ venv ใน image, ติดตั้งเฉพาะ client tools ที่จำเป็น (`mpc`, `bluez` สำหรับ `bluetoothctl` client, `network-manager` สำหรับ `nmcli` client) — **ไม่ต้องรัน mpd/bluetoothd/NetworkManager daemon ในคอนเทนเนอร์**
13. ตั้ง `ENTRYPOINT`/`CMD` ให้รันผ่าน waitress/gunicorn แทน `python app.py` ตรงๆ
14. เปิด `EXPOSE 5000` (หรือพอร์ตที่กำหนด)
15. Build ทดสอบครั้งแรกบนเครื่อง dev (x86) ด้วย `docker build` เพื่อเช็ค syntax/dependency ก่อน ค่อยไป build ข้าม arch

### Phase 4 — Docker Compose สำหรับใช้งานจริงบน Pi
16. เขียน `docker-compose.yml` กำหนด: `network_mode: host`, volume mount สำหรับ `stations.json`/`audio_state.json`, mount `/var/run/dbus`, `restart: unless-stopped`
17. ทดสอบ `docker compose up` บน Raspberry Pi Zero 2 W จริง ตรวจสอบ:
    - เล่นวิทยุผ่าน MPD ได้ปกติ
    - ค้นหา DLNA server เจอ (SSDP multicast ทำงานผ่าน host network)
    - เปิด/ปิด Bluetooth, สแกน, connect ลำโพงได้
    - สแกน/เชื่อมต่อ Wi-Fi ได้ (`sudo nmcli` จาก container)
    - กด poweroff แล้วเครื่องปิดจริง

### Phase 5 — Multi-arch build เพื่อให้ติดตั้งซ้ำง่าย
18. ตั้งค่า `docker buildx` เพื่อ build image ข้าม architecture (arm64/armhf) จากเครื่อง dev โดยไม่ต้อง build บน Pi ตรงๆ
19. Push image ขึ้น registry (Docker Hub หรือ GitHub Container Registry) ให้ Pi เครื่องอื่นๆ `docker pull` ไปใช้ได้เลย
20. เขียนสคริปต์/เอกสารสั้นๆ สำหรับ "ติดตั้งเครื่องใหม่": ขั้นตอน provision โฮสต์ (ติดตั้ง MPD + ตั้ง `/etc/mpd.conf` audio outputs, ติดตั้ง BlueZ + bluez-alsa-utils, ตั้ง sudoers NOPASSWD สำหรับ `nmcli`/`poweroff`, ติดตั้ง `wifi-fallback.service`) ตามด้วยขั้นตอน `docker pull && docker compose up -d`

### Phase 6 — CI/CD (ถ้าต้องการ)
21. ตั้ง GitHub Actions workflow: build multi-arch image อัตโนมัติทุกครั้งที่ push tag ใหม่ แล้ว push ขึ้น registry
22. เพิ่ม versioning ให้ image tag (เช่น `piradio:1.0.0`, `piradio:latest`) เพื่อ rollback ง่ายถ้ามีปัญหา

### Phase 7 — เอกสารและ Hardening
23. เขียนเอกสาร (ใน Obsidian นี้ต่อได้) สรุป: environment variables ทั้งหมด, พอร์ตที่ใช้, volume ที่ต้อง mount, ข้อจำกัดที่ทราบอยู่แล้ว (เช่น Wi-Fi 2.4GHz เท่านั้น, ต้องตั้งชื่อ MPD output ให้ตรง)
24. เพิ่ม healthcheck ใน Dockerfile/compose (เช่น curl `/api/status`)
25. พิจารณา logging: ให้ container log ออก stdout/stderr เพื่อดูผ่าน `docker logs` ได้ปกติ

---

## ความเสี่ยง/จุดที่ต้องตัดสินใจก่อนเริ่มเขียน Dockerfile จริง

- **Bluetooth/Wi-Fi ผ่าน container**: การ mount D-Bus socket เข้า container ใช้งานได้จริงแต่ต้อง test ละเอียด (permission ของ socket, user ที่รันใน container ต้องมีสิทธิ์อ่าน/เขียน)
- **`sudo` ใน container**: ต้องตัดสินใจว่าจะให้ container รันเป็น root เลย (ง่ายกว่า แต่ปลอดภัยน้อยกว่า) หรือ setup sudoers ซับซ้อนขึ้นใน image
- **SSDP/DLNA discovery**: ทำงานได้ดีที่สุดกับ `--network host` เพราะ multicast discovery ข้าม Docker bridge network ยาก
- **`wifi-fallback.service`**: ตัวนี้ทำงานตอน "ยังไม่มี Wi-Fi ให้ Docker daemon โหลด image ด้วยซ้ำ" จึงควรคงเป็น systemd service บนโฮสต์ต่อไป ไม่ต้อง containerize

---

## Docker Plan Review (สิ่งที่ควรแก้ก่อนเริ่มทำ)

แนวคิดหลักของแผนถูกต้อง: containerize เฉพาะ Flask app และคง service ที่คุมฮาร์ดแวร์ไว้บน Raspberry Pi OS. อย่างไรก็ตาม ควรปรับรายละเอียดด้านล่างก่อนลงมือ เพื่อไม่ให้ image รันได้เฉพาะกรณีง่าย ๆ แต่ฟีเจอร์สำคัญใช้ไม่ได้จริง

### 1. จัดการ lifecycle เมื่อเปลี่ยนไปใช้ WSGI

ปัจจุบัน `restore_last_audio_output()` ถูกเริ่มใน `if __name__ == "__main__"` ของ `app.py` เท่านั้น. เมื่อเปลี่ยนเป็นคำสั่งลักษณะ `waitress-serve app:app` block นี้จะไม่ทำงาน ทำให้การ reconnect Bluetooth/เลือก audio output หลัง start หายไป

- ย้าย startup task ไปเป็นฟังก์ชันที่ WSGI entry point เรียกได้โดยตรง และป้องกันการรันซ้ำ
- ใช้ WSGI worker เพียงหนึ่งตัว เพราะ app มี state ใน memory และมี background startup task
- เพิ่ม `waitress` ใน `requirements.txt`; อย่าอ้างว่าอยู่เฉพาะใน `.venv` ของเครื่องพัฒนา

### 2. ทำ data path ให้เป็น directory เดียวที่ mount ได้

ตอนนี้ `stations.json` และ `audio_state.json` ถูกกำหนดจาก `BASE_DIR` โดยตรง. ก่อนสร้าง Compose ควรเพิ่ม environment variable เช่น `PIRADIO_DATA_DIR=/data` แล้วให้ทั้งสองไฟล์อยู่ใต้ directory นี้

- ใช้ named volume หรือ bind mount directory `/data` แทนการ mount ไฟล์ทีละไฟล์
- สร้าง/seed `stations.json` เมื่อ data volume ว่าง และกำหนด owner ที่เขียนไฟล์ได้
- ไม่ mount `stations.json` ที่ยังไม่มีบน host เพราะ Docker อาจสร้างเป็น directory และทำให้แอปเปิดไฟล์ไม่ได้
- เพิ่ม `audio_state.json` และ data volume ลงในขั้นตอน backup/restore ของเครื่องใหม่

### 3. MPD และ network mode

`mpc` รองรับ environment variable `MPD_HOST` และ `MPD_PORT` อยู่แล้ว จึงตั้งค่าใน Compose ได้โดยไม่ต้องแก้ทุกจุดที่เรียก `mpc`. แต่ต้องบันทึกและทดสอบให้ชัดเจนว่า MPD บน host รับ connection ที่ `127.0.0.1:6600`

- `network_mode: host` เหมาะกับ Linux/Pi และช่วยให้ SSDP multicast สำหรับ DLNA ทำงาน; ใช้ไม่ได้บน Docker Desktop แบบเดียวกัน
- เริ่มด้วย `MPD_HOST=127.0.0.1` และ `MPD_PORT=6600`
- ทดสอบ `mpc status` ภายใน container ก่อนทดสอบผ่าน UI

### 4. D-Bus, NetworkManager และ Bluetooth ต้องระบุขอบเขตสิทธิ์

ให้ mount socket ที่แน่นอนคือ `/run/dbus/system_bus_socket` (ไม่ควรเดาว่า `/var/run/dbus` ใช้ได้ทุกระบบ). `bluetoothctl` และ `nmcli` ที่อยู่ใน container จะต้องมี package client, system D-Bus socket และ authorization ของ host ที่ถูกต้อง

- อย่าพึ่ง `sudo` ใน image โดยปริยาย: Dockerfile ตามแผนยังไม่ได้ติดตั้ง `sudo` และ sudoers ใน host ไม่ได้ถูกใช้ใน container โดยอัตโนมัติ
- ต้องตัดสินใจให้ชัดระหว่าง (ก) ให้ container รันเป็น root และปรับ `run_nmcli()` ไม่ต้องเรียก `sudo`, หรือ (ข) ใช้ host-side privileged helper สำหรับคำสั่ง NetworkManager/Bluetooth
- แนวทาง helper บน host ปลอดภัยและตรวจสอบง่ายกว่า เพราะการให้ root container เข้าถึง system D-Bus เทียบเท่ากับให้สิทธิ์ควบคุมเครื่องในระดับสูง
- ทดสอบ BlueZ และ NetworkManager แยกกันด้วย `bluetoothctl show` และ `nmcli general status` ภายใน container ก่อนเชื่อม UI

### 5. Power off ต้องเป็น host-owned operation

`/sbin/poweroff` ที่รันใน container ไม่ควรถูกคาดหวังว่าจะปิด host ได้อย่างน่าเชื่อถือ; container ไม่มี systemd ของ host และ Docker จำกัด capability สำหรับ reboot/power-off. จึงไม่ควรถือว่า D-Bus mount อย่างเดียวแก้ปัญหานี้

- ใช้ host-side helper ที่จำกัดหน้าที่ให้สั่ง systemd power-off ได้ หรือให้ host service ที่มีสิทธิ์รับคำสั่งเฉพาะนี้
- ในช่วงแรกควรปิด/feature-flag endpoint `/api/poweroff` ใน Docker deployment จนกว่าจะทดสอบ helper บน Pi จริง
- หลีกเลี่ยง `privileged: true` เป็นวิธีลัด เพราะเพิ่มสิทธิ์เกินจำเป็นมาก

### 6. เลือก platform ตาม OS ที่ติดตั้งจริง

Pi Zero 2 W เป็น CPU ARMv8 ที่รันได้ทั้ง Raspberry Pi OS 64-bit และ 32-bit. `arm64/aarch64 หรือ armv7` ในแผนควรเปลี่ยนเป็น Docker platform ที่ระบุได้จริง:

- ตรวจเครื่องเป้าหมายด้วย `dpkg --print-architecture` และ `uname -m`
- Raspberry Pi OS 64-bit ใช้ `linux/arm64`
- Raspberry Pi OS 32-bit ใช้ `linux/arm/v7`
- ใช้ base image ที่มี manifest สำหรับ platform เป้าหมาย เช่น `python:3.13-slim-bookworm` แล้ว build/test ตาม platform นั้น

การ build บน x86 ช่วยตรวจ Dockerfile ได้ แต่ไม่ยืนยันว่า package และ integration กับ Pi ทำงานได้. ควรมี buildx build ของ platform เป้าหมายและ smoke test บน Pi เสมอ. ใน Dockerfile ให้ใช้ virtual environment หรือ pip ปกติของ official Python image; ไม่จำเป็นต้องใช้ `--break-system-packages`.

### 7. เพิ่มแผน migration และการเริ่มหลัง boot

เครื่องปัจจุบันมี `radio.service` ที่เปิด port 5000 อยู่แล้ว. ก่อนใช้ Compose ต้องหยุด/disable service เดิม หรือจะชน port และเกิดความสับสนว่ากำลังรันโค้ดชุดใด

- เพิ่มขั้นตอน migration: backup data, `sudo systemctl disable --now radio.service`, จากนั้น start container
- เปิด Docker daemon ให้ start หลังบูต และใช้ `restart: unless-stopped`
- โหลด image ลง Pi ล่วงหน้าก่อนพึ่งพา fallback hotspot เพราะตอนยังไม่มี Wi-Fi เครื่องไม่สามารถ pull image ใหม่ได้
- บันทึกวิธี rollback กลับไป `radio.service` พร้อม image tag เวอร์ชันก่อนหน้า

### 8. ปรับ healthcheck และความปลอดภัย

image แบบ `slim` ไม่มี `curl` ตามค่าเริ่มต้น ดังนั้น healthcheck ที่เรียก curl จะล้มเหลวหากไม่ได้ติดตั้งเพิ่ม. ใช้ Python standard library เรียก `/api/status` หรือเพิ่ม curl อย่างตั้งใจ

นอกจากนี้ แอปไม่มี authentication แต่มี API เปลี่ยน Wi-Fi, Bluetooth และปิดเครื่อง. กำหนดให้ port 5000 ใช้ใน trusted LAN เท่านั้น หรือวาง reverse proxy ที่มี authentication/TLS ไว้ด้านหน้า. ควรเปลี่ยนรหัสผ่าน `PiRadio-Setup` เริ่มต้นก่อนนำเครื่องใหม่ไปใช้งานจริงด้วย

### ลำดับเริ่มต้นที่แนะนำ

1. ทำ data directory, WSGI entry point และเพิ่ม `waitress` โดยยังรันบน host ให้ regression test ผ่านก่อน
2. สร้าง image ขั้นต่ำที่มี Flask + `mpc`, ใช้ host network และพิสูจน์ Radio/DLNA
3. เพิ่ม D-Bus mount และทดสอบ Bluetooth ก่อน แล้วจึงทดสอบ NetworkManager
4. ออกแบบและทดสอบ host-side power-off helper แยกต่างหาก
5. เพิ่ม Compose, migration/rollback guide, healthcheck และ multi-arch publish

---

## ไฟล์ที่เกี่ยวข้องในโปรเจกต์ต้นทาง

- `app.py` — Flask app หลัก (routes ทั้งหมด, mpc/bluetoothctl/nmcli integration)
- `requirements.txt` — Python dependencies (`Flask`, `upnpclient`)
- `stations.json` / `audio_state.json` — ข้อมูล runtime ที่ต้อง persist ผ่าน volume
- `templates/index.html`, `static/app.js`, `static/style.css` — frontend
- `scripts/wifi-fallback.sh`, `scripts/wifi-fallback.service` — ทำงานนอกขอบเขต Docker (ติดตั้งบนโฮสต์)
- `modified.md`, `plan.md` — บันทึกการพัฒนาฟีเจอร์เดิม (อ้างอิงพฤติกรรม/บั๊กที่เคยเจอ)

---

## Next Step

เมื่อพร้อม ให้กลับมาที่โน้ตนี้แล้วเริ่มจาก **Phase 1** ทีละข้อ — แนะนำให้เริ่มเขียน `Dockerfile` ตัวแรกแบบง่ายที่สุดก่อน (ยังไม่ต้อง Bluetooth/Wi-Fi) เพื่อให้ Flask + MPD (ผ่าน network host) ทำงานได้ก่อน แล้วค่อยเพิ่มความสามารถ Bluetooth/Wi-Fi ทีละอย่าง
