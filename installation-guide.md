# ติดตั้ง Radio/Media Server บน Raspberry Pi แบบไม่ใช้ Docker (Flask + Nginx)

เอกสารนี้เป็นขั้นตอนติดตั้งโปรเจกต์นี้บน Raspberry Pi แบบรันตรงบนระบบปฏิบัติการ (bare-metal) โดยใช้ Flask app รันผ่าน [Waitress](https://docs.pylonsproject.org/projects/waitress/en/stable/) (production WSGI server) ควบคุมด้วย systemd และวาง Nginx เป็น reverse proxy ด้านหน้า ครอบคลุมตั้งแต่เตรียมเครื่องเปล่าจนใช้งานได้จริง พร้อมปัญหาที่พบบ่อยและวิธีแก้ในแต่ละขั้นตอน

สถาปัตยกรรมที่ได้หลังติดตั้งเสร็จ:

```text
Browser --> Nginx (port 80) --> Waitress (127.0.0.1:5000) --> Flask app (app.py)
                                                                  |
                                                                  +--> mpc --> MPD --> ALSA / BlueALSA --> speaker
                                                                  +--> upnpclient --> DLNA/UPnP server บน LAN
                                                                  +--> bluetoothctl --> BlueZ
                                                                  +--> sudo nmcli --> NetworkManager
```

MPD, BlueZ และ NetworkManager ต้องรันบน Pi host โดยตรง (ไม่ได้ containerize) แอป Flask เป็นเพียง web controller ที่สั่งงานผ่านโปรแกรมเหล่านี้

> ต้องการ deploy ด้วย Docker แทน ดู [Docker/instruction.md](Docker/instruction.md)

## สรุปลำดับการติดตั้ง

ติดตั้ง OS/เปิด SSH > ติดตั้ง dependencies (MPD, BlueZ, NetworkManager, Nginx, Python) > ตรวจ MPD > ส่งโค้ดไป Pi > สร้าง virtualenv > ตั้งค่า sudoers > ทดสอบรันด้วยมือ > สร้าง systemd service > ตั้งค่า Nginx reverse proxy > Smoke test > ตั้งค่า Bluetooth output > ตั้งค่า Wi-Fi fallback (ถ้าต้องการ) > ตรวจข้อมูล persistent

## สิ่งที่ต้องเตรียม

- Raspberry Pi (Zero 2 W, 3B หรือรุ่นอื่นที่รองรับ) พร้อม microSD, เครือข่าย และไฟเลี้ยงที่เสถียร
- คอมพิวเตอร์ Windows ที่มี source project นี้อยู่ที่ `D:\code\Flask\PiZero2W`
- Raspberry Pi Imager สำหรับเขียน Raspberry Pi OS
- LAN เดียวกันระหว่าง Windows, Pi และ DLNA Media Server (ถ้าจะทดสอบ DLNA)
- ลำโพงหรือหูฟัง USB/3.5mm สำหรับทดสอบเสียง และ/หรือลำโพง Bluetooth

## 1. เขียน Raspberry Pi OS และเปิด SSH

1. เปิด Raspberry Pi Imager แล้วเลือก `Raspberry Pi OS Lite (64-bit)` (หรือ 32-bit ถ้าเป็น Pi Zero 2 W และต้องการความเข้ากันได้สูงสุด)
2. กดปุ่มตั้งค่า (รูปเฟือง) ก่อนเขียน SD card แล้วตั้งค่า:
   - hostname เช่น `piradio`
   - username และ password ที่รัดกุม
   - Wi-Fi SSID/password หากจะต่อ Wi-Fi ตั้งแต่บูตแรก
   - locale/time zone
   - เปิด `Enable SSH` และเลือก password authentication หรือ public key
3. เขียน SD card, ใส่ใน Pi แล้วเปิดเครื่อง
4. เชื่อมต่อจาก PowerShell:

   ```powershell
   ssh <pi-user>@piradio.local
   ```

   ใช้ IP แทน `piradio.local` ได้หากหา hostname ไม่เจอ เช่น `ssh pi@192.168.1.50`

**ปัญหาที่พบบ่อย**: `ssh: connect to host piradio.local port 22: Connection refused/timed out`
วิธีแก้: ตรวจว่า SD card เขียนสำเร็จและตั้งค่า `Enable SSH` ไว้จริง, ตรวจว่า Pi กับเครื่องที่ SSH เข้าอยู่ LAN เดียวกัน, ลองใช้ IP จากหน้า router แทน hostname

## 2. อัปเดตระบบและติดตั้ง dependencies

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y python3 python3-venv python3-pip git \
    mpd mpc bluez bluez-alsa-utils network-manager nginx
sudo systemctl enable --now mpd bluetooth NetworkManager nginx
```

ออกจาก SSH แล้วเชื่อมใหม่หนึ่งครั้งหากเพิ่งเพิ่ม user เข้ากลุ่มใด ๆ:

```bash
exit
ssh <pi-user>@piradio.local
```

**ปัญหาที่พบบ่อย**: `E: Unable to locate package bluez-alsa-utils`
วิธีแก้: บาง OS release ใช้ชื่อแพ็กเกจต่างกัน (เช่น `bluealsa` บน distro บางตัว) ให้ตรวจด้วย `apt-cache search bluealsa` แล้วติดตั้งชื่อที่ค้นเจอแทน

**ปัญหาที่พบบ่อย**: Bluetooth ใช้งานไม่ได้เพราะถูก rfkill บล็อก
วิธีแก้:

```bash
sudo rfkill unblock bluetooth
sudo systemctl restart bluetooth
```

## 3. ตรวจ MPD ก่อนใช้งาน

```bash
mpc status
mpc outputs
```

โค้ดของแอปอ้างอิงชื่อ MPD output ตรงตัวสองชื่อ: `USB Headphone` และ `Bluetooth Speaker` ต้องแก้ `/etc/mpd.conf` ให้มี audio_output สองบล็อกนี้ ตัวอย่าง:

```conf
audio_output {
    type "alsa"
    name "USB Headphone"
    device "hw:0,0"          # เปลี่ยนตาม `aplay -l` ของเครื่องจริง
}

audio_output {
    type "alsa"
    name "Bluetooth Speaker"
    device "bluealsa"
}
```

หาการ์ดเสียงจริงด้วย `aplay -l` แล้วแทนที่ `device` ให้ตรงกับเครื่อง จากนั้น:

```bash
sudo systemctl restart mpd
mpc outputs
```

ต้องเห็น output ทั้งสองชื่อ (`USB Headphone`, `Bluetooth Speaker`) ในผลลัพธ์ `mpc outputs`

**ปัญหาที่พบบ่อย**: `mpc status` ขึ้น `MPD error: Connection refused`
วิธีแก้: ตรวจ `sudo systemctl status mpd --no-pager` และดู log ด้วย `journalctl -u mpd -n 50 --no-pager`; มักเกิดจาก `/etc/mpd.conf` ผิด syntax หรือ path `music_directory`/`db_file`/`pid_file` ไม่มีสิทธิ์เขียน

**ปัญหาที่พบบ่อย**: `mpc outputs` ไม่มีชื่อ output ตามที่ตั้งไว้
วิธีแก้: ตรวจว่าแก้ไฟล์ `mpd.conf` ถูกต้องจริง (ไม่มี syntax error), รัน `sudo systemctl restart mpd` ใหม่ และดูว่า mpd โหลด config ไฟล์ที่แก้จริงหรือไม่ (`mpd --version` แสดง config path เริ่มต้น หรือระบุ path ตรง ๆ ด้วย `mpd /etc/mpd.conf --no-daemon` เพื่อดู error แบบ verbose)

## 4. ส่งโค้ดจาก Windows ไป Pi

เลือกวิธีใดวิธีหนึ่ง:

**วิธี A — scp จาก PowerShell (Windows):**

```powershel
```

**วิธี B — git clone บน Pi** (ถ้า push repo ขึ้น git server/GitHub แล้ว):

```bash
git clone <repository-url> ~/radio-server
```

**สำคัญ**: เลือก path deploy เดียวและใช้ให้ตรงกันทุกครั้งที่อัปเดตโค้ด (ตัวอย่างนี้ใช้ `/home/<pi-user>/radio-server/`) ห้าม scp ไปคนละ path กับที่ systemd service อ้างถึง ไม่งั้นแก้โค้ดแล้วจะไม่มีผลกับแอปที่รันจริง

**ปัญหาที่พบบ่อย**: แก้โค้ดแล้ว restart service แต่พฤติกรรมเดิม
วิธีแก้: ตรวจ path จริงที่ service ใช้งานด้วย `systemctl cat radio.service | grep WorkingDirectory` เทียบกับ path ที่ scp ไป ให้ตรงกันเสมอ

## 5. สร้าง virtualenv และติดตั้ง dependencies

```bash
cd ~/radio-server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install waitress
```

`waitress` ไม่ได้อยู่ใน `requirements.txt` หลักของโปรเจกต์ (ใช้เฉพาะฝั่ง Docker) จึงต้องติดตั้งเพิ่มสำหรับ production ที่นี่

**ปัญหาที่พบบ่อย**: `ModuleNotFoundError: No module named 'flask'` ตอนรัน `python app.py`
วิธีแก้: ลืม activate venv ก่อนรัน ให้ `source .venv/bin/activate` ก่อนทุกครั้ง หรือเรียก `.venv/bin/python app.py` ตรง ๆ

## 6. ทดสอบรันด้วยมือก่อนตั้งเป็น service

```bash
cd ~/radio-server
source .venv/bin/activate
python app.py
```

เปิดจากเครื่องอื่นใน LAN ที่ `http://<pi-ip>:5000` ต้องเห็นหน้าเว็บและกดเล่นสถานีได้ กด `Ctrl+C` เพื่อหยุดหลังทดสอบเสร็จ

**ปัญหาที่พบบ่อย**: `Address already in use` ตอนรัน `python app.py`
วิธีแก้: มี process อื่นถือ port 5000 อยู่ ตรวจด้วย `sudo ss -ltnp | grep 5000` แล้ว `kill` หรือ `sudo systemctl stop radio.service` ถ้าเคยตั้ง service ไว้ก่อนแล้ว

**ปัญหาที่พบบ่อย**: เปิดหน้าเว็บได้แต่กด Play แล้วไม่มีเสียง/ `/api/status` เป็น `unavailable`
วิธีแก้: ตรวจว่า `mpc` ติดตั้งและเรียกได้จาก user ที่รันแอป ด้วย `which mpc` และ `mpc status`; ดูหัวข้อ 3

## 7. ตั้งค่า sudoers สำหรับ Wi-Fi และ Power Off

แอปเรียก `sudo nmcli` และ `sudo /sbin/poweroff` เพื่อให้คำสั่งจากหน้าเว็บมีผลกับเครื่องจริง ต้องอนุญาตเฉพาะคำสั่งนี้แบบไม่ถามรหัสผ่านให้ user ที่รันแอป:

```bash
command -v nmcli
command -v poweroff
sudo visudo -f /etc/sudoers.d/radio-server
```

เพิ่มบรรทัดนี้ในไฟล์ (แทน `<pi-user>` และ path ด้วยค่าจริงจากคำสั่ง `command -v` ด้านบน):

```sudoers
<pi-user> ALL=(root) NOPASSWD: /usr/bin/nmcli, /sbin/poweroff
```

บันทึกแล้วตรวจ syntax อัตโนมัติจาก `visudo` (จะแจ้ง error ถ้าพิมพ์ผิด)

**ปัญหาที่พบบ่อย**: กด "ปิดเครื่อง" หรือเชื่อมต่อ Wi-Fi จากหน้าเว็บแล้วไม่มีผล/ค้าง
วิธีแก้: ตรวจว่า sudoers ไฟล์ระบุ path ตรงกับ `command -v nmcli`/`command -v poweroff` จริง (บาง OS อยู่ที่ `/usr/sbin/poweroff`) และ user ที่รัน systemd service ตรงกับ user ใน sudoers rule ทดสอบตรง ๆ ด้วย `sudo -u <pi-user> sudo nmcli general status`

## 8. สร้างไฟล์ WSGI entrypoint สำหรับ production

`python app.py` รัน Flask development server ซึ่งไม่เหมาะกับการใช้งานจริง (single-threaded, ไม่มี reconnection handling ที่ดี) ให้สร้างไฟล์ `wsgi.py` แยกไว้ที่ root โปรเจกต์บน Pi เพื่อรันผ่าน Waitress พร้อมสตาร์ต thread คืนค่า audio output/สถานีล่าสุดตอนบูต (แบบเดียวกับที่ [Docker/wsgi.py](Docker/wsgi.py) ใช้):

```bash
cat <<'EOF' > ~/radio-server/wsgi.py
import os
import threading

from waitress import serve

from app import app, restore_last_audio_output

threading.Thread(target=restore_last_audio_output, daemon=True).start()

serve(app, host="127.0.0.1", port=int(os.environ.get("PIRADIO_PORT", "5000")), threads=4)
EOF
```

ผูก Waitress กับ `127.0.0.1` เท่านั้น (ไม่ใช่ `0.0.0.0`) เพราะ Nginx จะเป็นตัวรับ request จากภายนอกแทน ป้องกันไม่ให้เข้าถึง port 5000 ตรง ๆ ข้ามหน้า proxy

ทดสอบก่อนตั้งเป็น service:

```bash
cd ~/radio-server
source .venv/bin/activate
python wsgi.py
```

ต้องเห็น log ของ Waitress ว่า serve อยู่ที่ `127.0.0.1:5000` แล้ว `curl http://127.0.0.1:5000/api/status` จากเครื่อง Pi เอง ต้องได้ JSON ตอบกลับ กด `Ctrl+C` เพื่อหยุด

**ปัญหาที่พบบ่อย**: `ImportError: cannot import name 'restore_last_audio_output' from 'app'`
วิธีแก้: ยืนยันว่า `wsgi.py` อยู่ระดับเดียวกับ `app.py` (root ของ `~/radio-server`) ไม่ใช่ในโฟลเดอร์ย่อย

## 9. ตั้งเป็น systemd service

```bash
sudo tee /etc/systemd/system/radio.service > /dev/null <<EOF
[Unit]
Description=Pi Radio/Media Server (Flask + Waitress)
After=network-online.target mpd.service bluetooth.service NetworkManager.service
Wants=network-online.target

[Service]
Type=simple
User=<pi-user>
WorkingDirectory=/home/<pi-user>/radio-server
ExecStart=/home/<pi-user>/radio-server/.venv/bin/python /home/<pi-user>/radio-server/wsgi.py
Restart=on-failure
RestartSec=3
Environment=PIRADIO_PORT=5000

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now radio.service
sudo systemctl status radio.service --no-pager
```

แทน `<pi-user>` ด้วย user จริงทุกที่ในไฟล์นี้ (มี 2 จุด: `User=` และใน path)

**ปัญหาที่พบบ่อย**: `radio.service` ขึ้น `failed` ทันทีหลัง start
วิธีแก้: ดู log แบบละเอียด:

```bash
journalctl -u radio.service -n 80 --no-pager
```

สาเหตุที่พบบ่อยคือ path ผิด (`ExecStart` ชี้ python/venv ผิด path), ไฟล์ `wsgi.py` ไม่มี, หรือ user ใน `User=` ไม่มีสิทธิ์อ่านโฟลเดอร์โปรเจกต์

**ปัญหาที่พบบ่อย**: service รันอยู่แต่ `curl http://127.0.0.1:5000/api/status` ไม่ตอบ
วิธีแก้: ตรวจว่า `wsgi.py` bind `127.0.0.1` (ไม่ใช่ `0.0.0.0` ถ้าต้องการเข้าถึงจาก Pi เองเท่านั้นผ่าน localhost ก็ใช้ได้ปกติ), ตรวจ `sudo ss -ltnp | grep 5000` ว่ามี process python ฟังอยู่จริง

## 10. ตั้งค่า Nginx เป็น reverse proxy

สร้างไฟล์ site config:

```bash
sudo tee /etc/nginx/sites-available/radio-server > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # /api/status และ dlna scan อาจใช้เวลานานกว่าปกติ
        proxy_read_timeout 30s;
        proxy_connect_timeout 10s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/radio-server /etc/nginx/sites-enabled/radio-server
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

**ปัญหาที่พบบ่อย**: `nginx -t` แจ้ง syntax error
วิธีแก้: ตรวจวงเล็บปีกกาและเครื่องหมาย `;` ปิดท้ายทุกบรรทัดใน config ให้ครบตามตัวอย่างด้านบน

**ปัญหาที่พบบ่อย**: เข้า `http://<pi-ip>/` แล้วได้ `502 Bad Gateway`
วิธีแก้: แปลว่า Nginx ทำงานอยู่แต่ `radio.service` (Waitress) ไม่ตอบสนองที่ 127.0.0.1:5000 ตรวจ:

```bash
sudo systemctl status radio.service --no-pager
curl http://127.0.0.1:5000/api/status
journalctl -u radio.service -n 50 --no-pager
```

**ปัญหาที่พบบ่อย**: หน้าเว็บโหลดได้แต่ CSS/JS ไม่ขึ้น (หน้าเปล่า ๆ ไม่มีสไตล์)
วิธีแก้: มักไม่ใช่ปัญหา Nginx เพราะ config นี้ proxy ทุก path ผ่าน Flask ตรง ๆ (Flask serve static เอง) ให้ตรวจ browser console (F12) ว่า request `/static/...` ได้ 404 หรือไม่ และตรวจว่า path `static/` อยู่ครบใน `~/radio-server/static/`

**ปัญหาที่พบบ่อย**: `Failed to restart nginx.service` หลังแก้ config
วิธีแก้: รัน `sudo nginx -t` ก่อนเสมอเพื่อดู syntax error พร้อมเลขบรรทัดที่ผิด แก้ให้ผ่านก่อนค่อย restart

## 11. Smoke Test

จากเครื่องอื่นใน LAN เดียวกัน เปิด `http://<pi-ip>/` (port 80 ผ่าน Nginx ไม่ต้องระบุ `:5000` อีกต่อไป)

ตรวจตามลำดับ:

1. หน้าเว็บโหลดขึ้น มีรายการสถานีวิทยุ
2. กดเล่นสถานีใดสถานีหนึ่ง แล้วมีเสียงออกจากลำโพงที่ต่อไว้
3. ปรับระดับเสียงจากหน้าเว็บแล้วเสียงเปลี่ยนจริง
4. กด "หยุด" แล้วเสียงหยุด
5. เปิด Settings > Bluetooth ต้องเห็นสถานะ Bluetooth (ไม่ใช่ unavailable ถ้าติดตั้ง BlueZ ครบ)

**ปัญหาที่พบบ่อย**: หน้าเว็บช้าผิดปกติตอนโหลดครั้งแรก
วิธีแก้: มักเกิดจาก DLNA server discovery หรือ mpd ยังไม่พร้อมช่วง Pi เพิ่งบูต รอสัก 10-20 วินาทีแล้วรีเฟรชอีกครั้ง

## 12. เปิดใช้ Bluetooth speaker

```bash
bluetoothctl power on
bluetoothctl agent NoInputNoOutput
bluetoothctl default-agent
```

Pair/connect ลำโพงผ่านหน้าเว็บ (Settings > Bluetooth > Scan > เลือกลำโพง > Connect) หรือทดสอบตรงด้วย `bluetoothctl` ก่อน:

```bash
bluetoothctl scan on
bluetoothctl pair <MAC>
bluetoothctl trust <MAC>
bluetoothctl connect <MAC>
```

หลัง connect สำเร็จ ตรวจว่า MPD มองเห็น output:

```bash
aplay -L | grep -i bluealsa
mpc outputs
```

ถ้าต้องการ enable/disable output ด้วยมือ:

```bash
mpc outputs
mpc enable <output-id>
mpc disable <output-id>
```

**ปัญหาที่พบบ่อย**: pair สำเร็จแต่ connect หลุดทันที/ไม่มีเสียง
วิธีแก้: ปัญหานี้เกิดจาก BlueZ ตัดการเชื่อมต่ออัตโนมัติทันทีหลัง pairing เสร็จ ถ้าส่งคำสั่ง `pair`/`trust`/`connect` ติดกันเร็วเกินไป ให้เว้นช่วง 1-3 วินาทีระหว่างแต่ละคำสั่งเมื่อทดสอบผ่าน `bluetoothctl` ตรง ๆ (แอปจัดการเรื่องนี้ให้อัตโนมัติแล้วเมื่อ connect ผ่านหน้าเว็บ)

**ปัญหาที่พบบ่อย**: `mpc outputs` ไม่มี `Bluetooth Speaker`
วิธีแก้: ตรวจว่าเพิ่ม audio_output block ใน `/etc/mpd.conf` ตามหัวข้อ 3 แล้ว restart mpd แล้วหรือยัง

**ปัญหาที่พบบ่อย**: เว็บขึ้น Bluetooth unavailable
วิธีแก้: ตรวจว่า `bluetoothctl` เรียกได้จาก shell (`which bluetoothctl`), `sudo systemctl status bluetooth --no-pager`, และ `rfkill list bluetooth` ว่าไม่ได้ถูก block

## 13. (ตัวเลือก) ตั้งค่า Wi-Fi Fallback Hotspot

ถ้าต้องการให้ Pi เปิด hotspot สำรองเวลาเชื่อม Wi-Fi จริงไม่ได้ ให้เปลี่ยนรหัสผ่านเริ่มต้นก่อนแล้วติดตั้ง service:

1. แก้ `HOTSPOT_PASSWORD` ใน `~/radio-server/scripts/wifi-fallback.sh` ให้เป็นรหัสผ่านจริง (ห้ามใช้ค่า default ที่ commit ไว้ในโค้ด)
2. ติดตั้ง script และ service:

   ```bash
   sudo install -m 755 scripts/wifi-fallback.sh /usr/local/bin/wifi-fallback.sh
   sudo install -m 644 scripts/wifi-fallback.service /etc/systemd/system/wifi-fallback.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now wifi-fallback.service
   ```

**ปัญหาที่พบบ่อย**: hotspot ไม่ขึ้นเมื่อ Wi-Fi หลุด
วิธีแก้: `journalctl -u wifi-fallback.service -n 50 --no-pager`, ตรวจว่า NetworkManager เป็นตัวจัดการ Wi-Fi จริง (`nmcli general status`) ไม่ใช่ `dhcpcd`/`wpa_supplicant` ตรง ๆ ซึ่งจะชนกับ nmcli commands ที่แอปเรียกใช้

## 14. ตรวจข้อมูล persistent และสำรอง

ไฟล์ที่เก็บสถานะและต้องสำรองก่อนอัปเกรด/ย้ายเครื่อง:

- `~/radio-server/stations.json` — หมวดหมู่ สถานี รายการโปรด และ playback mode ล่าสุด
- `~/radio-server/audio_state.json` — audio output และสถานีวิทยุที่เล่นค้างไว้ล่าสุด (ใช้ตอนบูตเพื่อ resume อัตโนมัติ)

```bash
cp ~/radio-server/stations.json ~/radio-server/stations.json.bak
cp ~/radio-server/audio_state.json ~/radio-server/audio_state.json.bak
```

## 15. คำสั่งใช้งานประจำ

```bash
sudo systemctl status radio.service --no-pager
sudo systemctl restart radio.service
journalctl -u radio.service -f
sudo systemctl status nginx --no-pager
sudo systemctl restart nginx
```

## 16. อัปเดตโค้ดภายหลัง

1. ส่งไฟล์ที่เปลี่ยนจาก Windows ด้วย `scp` ไปที่ path เดิม (`/home/<pi-user>/radio-server/`) ตามหัวข้อ 4
2. ถ้ามีการเปลี่ยน `requirements.txt` ให้ติดตั้งเพิ่ม:

   ```bash
   cd ~/radio-server
   source .venv/bin/activate
   python -m pip install -r requirements.txt
   ```

3. รีสตาร์ต service:

   ```bash
   sudo systemctl restart radio.service
   journalctl -u radio.service -n 50 --no-pager
   ```

ไม่ต้อง restart Nginx เว้นแต่แก้ config ของ Nginx เอง (`/etc/nginx/sites-available/radio-server`)

**ปัญหาที่พบบ่อย**: อัปเดตโค้ดแล้วพฤติกรรมเว็บไม่เปลี่ยน
วิธีแก้: มักเกิดจาก scp ไปผิด path หรือลืม restart service ตรวจ path ด้วย `systemctl cat radio.service | grep WorkingDirectory` แล้วเทียบกับ path ที่ scp ไปจริง ตามหัวข้อ 4

## 17. ปัญหาที่พบบ่อยเพิ่มเติม (สรุปรวม)

### Port 80 หรือ 5000 ถูกใช้งานอยู่

```bash
sudo ss -ltnp | grep -E ':80|:5000'
```

หยุด service ที่ชนกันก่อน (เช่น Apache เดิม `sudo systemctl disable --now apache2`)

### `/api/status` ตอบ `available: false`

MPD ยังไม่พร้อมหรือ `mpc` เรียกจาก user ที่รัน service ไม่ได้ ตรวจ:

```bash
sudo -u <pi-user> mpc status
sudo systemctl status mpd --no-pager
```

### รีสตาร์ต/ปิดเครื่องแล้วไม่กลับมาเล่นสถานีวิทยุหรือ output เดิม

แอปจำ output (jack/bluetooth) และสถานีวิทยุล่าสุดไว้ใน `audio_state.json` แล้ว resume อัตโนมัติตอนบูตผ่าน `restore_last_audio_output()` ใน `app.py` (เรียกจาก thread ใน `wsgi.py`) ถ้าไม่ทำงาน:

```bash
cat ~/radio-server/audio_state.json
journalctl -u radio.service --since "10 min ago" --no-pager
mpc status
mpc outputs
```

1. ตรวจว่า `audio_state.json` มี `last_station_id` ตรงกับสถานีที่เล่นค้างไว้ก่อน poweroff จริง
2. ตรวจว่า `wsgi.py` เป็นคนสตาร์ต thread นี้จริง (ดูหัวข้อ 8) ไม่ใช่แค่รัน `python app.py` ผ่าน `ExecStart` ตรง ๆ โดยไม่มี wsgi wrapper
3. ถ้า MPD เองมี `state_file` ใน `/etc/mpd.conf` อาจ auto-resume คิวเพลงเดิมของตัวเองแข่งกับแอป ให้ปิด/ลบ `state_file` ใน `mpd.conf` แล้ว `sudo systemctl restart mpd` เพื่อให้แอปเป็นผู้ควบคุมการ resume แต่ผู้เดียว

### หน้าเว็บเข้าได้จากในเครื่อง Pi เอง (`curl 127.0.0.1`) แต่เข้าจากเครื่องอื่นไม่ได้

ตรวจ firewall (ถ้าเปิด `ufw`):

```bash
sudo ufw status
sudo ufw allow 80/tcp
```

### ต้องการเปิดใช้งานผ่าน HTTPS

แอปนี้ไม่มีระบบยืนยันตัวตนในตัว จึงไม่ควรเปิด port ออก Internet โดยตรงไม่ว่าจะมี HTTPS หรือไม่ หากจำเป็นต้องเข้าถึงจากนอก LAN ให้ใช้ VPN (เช่น WireGuard/Tailscale) เข้ามาก่อนถึงจะเข้าเว็บนี้ได้ แทนการเปิด port เข้า Internet ตรง ๆ

## 18. ข้อควรระวังด้านความปลอดภัย

- แอปไม่มีระบบยืนยันตัวตน (authentication) และมี endpoint ที่สั่งปิดเครื่อง เปลี่ยน Wi-Fi และควบคุม Bluetooth ได้ ห้ามเปิด port 80 ออก Internet โดยตรง ใช้เฉพาะบน trusted LAN เท่านั้น
- Waitress ต้องผูกกับ `127.0.0.1` เท่านั้น (ตามหัวข้อ 8) ไม่ใช่ `0.0.0.0` เพื่อบังคับให้ทุก request ต้องผ่าน Nginx ก่อน
- sudoers rule (หัวข้อ 7) ต้องจำกัดเฉพาะคำสั่ง `nmcli` และ `poweroff` เท่านั้น ห้ามให้ user ที่รันแอป มีสิทธิ์ `sudo` แบบเต็ม
- หากต้องเข้าถึงจากนอกบ้าน ให้ใช้ VPN เข้ามาก่อนเสมอ ไม่ใช่ port-forward ตรงมาที่ Pi
