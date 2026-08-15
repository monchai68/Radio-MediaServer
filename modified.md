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
