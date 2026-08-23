# Docker Deployment (Phase 1)

ชุดนี้แยกจาก source project หลัก และ containerize Flask web app, `mpc`, Internet Radio, DLNA และ Bluetooth control. MPD และ BlueZ ยังรันบน Raspberry Pi host จึงต้องใช้ `network_mode: host`.

## ขอบเขตของ Phase 1

- ใช้งานได้: Flask UI, Radio, DLNA, MPD/MPC, Bluetooth control, การเก็บ `stations.json` และ `audio_state.json`
- ยังไม่เปิดใช้: Wi-Fi setup และ Power Off จากใน container

Bluetooth control ใช้ `bluetoothctl` ใน container และ bind-mount host system D-Bus socket. BlueZ, Bluetooth audio backend และ MPD output ต้องตั้งค่าบน host ตาม [instruction.md](instruction.md). Wi-Fi และ Power Off จะรายงาน unavailable เพราะ image ยังไม่ติดตั้ง `nmcli` หรือ `sudo` และไม่มี host authorization ที่จำเป็น

## เริ่มใช้งานบน Raspberry Pi

1. ตรวจว่า MPD บน host ทำงานและรับ connection ที่ `127.0.0.1:6600`:

   ```bash
   mpc status
   ```

2. ย้ายมาที่โฟลเดอร์นี้และ build/start:

   ```bash
   cd ~/radio-server/Docker
   docker compose up -d --build
   ```

3. ตรวจ log และ MPD access:

   ```bash
   docker compose logs -f
   docker compose exec piradio mpc status
   ```

4. เปิด `http://<pi-ip>:5000` จากอุปกรณ์ใน LAN

Bluetooth ต้อง rebuild image หลัง pull/copy source และตั้ง host BlueZ/MPD ก่อน:

```bash
docker compose up -d --build
docker compose exec piradio bluetoothctl show
```

container ไม่ได้ใช้ `privileged`; สิทธิ์ Bluetooth ที่เพิ่มขึ้นมาจาก system D-Bus socket เพียงจุดเดียว จึงต้องจำกัดหน้าเว็บไว้ใน LAN ที่เชื่อถือได้

ข้อมูล runtime จะอยู่ใน `Docker/data/` และถูกสร้างจากค่าเริ่มต้นใน image ครั้งแรก จึงไม่แก้ [../stations.json](../stations.json) ของ source project.

## คำสั่งจัดการ

```bash
docker compose ps
docker compose restart
docker compose down
docker compose up -d --build
```

หาก host ยังมี `radio.service` ตัวเดิมที่เปิด port 5000 อยู่ ต้องหยุด service นั้นก่อน start container:

```bash
sudo systemctl disable --now radio.service
```

ก่อนทำขั้นตอนนี้ ให้สำรอง `stations.json` และ `audio_state.json` ของ deployment เดิมไว้ก่อน

## ทดสอบบน Windows

Docker Desktop ไม่รองรับ `network_mode: host` แบบเดียวกับ Linux host จึง build image เพื่อตรวจ Dockerfile ได้ แต่ไม่สามารถยืนยันการเชื่อม MPD, SSDP/DLNA multicast หรือ hardware integration ได้ครบ. ให้ทำ smoke test จริงบน Raspberry Pi

## ขั้นต่อไป

Phase ถัดไปจะเพิ่ม Wi-Fi โดยออกแบบ host authorization อย่างจำกัดสิทธิ์ ก่อนเพิ่ม Power Off ผ่าน host-side helper