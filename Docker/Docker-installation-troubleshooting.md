# Docker Installation Troubleshooting

คู่มือนี้ใช้สำหรับ Pi ที่รัน Pi Radio ด้วย Docker Compose ที่ `~/radio-server/Docker`.

## ลำโพง Bluetooth เชื่อมต่อแล้ว แต่ไม่มีเสียง

### อาการ

หน้าเว็บแสดงว่า Bluetooth speaker เชื่อมต่อแล้ว แต่ไม่มีเสียงออกจากลำโพง และ `mpc status` แสดงข้อความนี้:

```text
ERROR: Failed to open audio output
```

สาเหตุคือ MPD บน host เปิด BlueALSA audio output ไม่ได้ มักเกิดจาก BlueALSA ไม่ทำงาน, MAC ใน MPD ไม่ตรงกับลำโพงที่เชื่อมต่อ, หรือยังไม่ได้เปิด output `Bluetooth Speaker`.

### 1. ตรวจการเชื่อมต่อและ BlueALSA

รันบน Pi host ไม่ใช่ใน container:

```bash
bluetoothctl devices Connected
sudo systemctl status bluealsa --no-pager
aplay -L | grep -i bluealsa
```

ต้องพบลำโพงใน `bluetoothctl devices Connected` และต้องมี ALSA device ลักษณะนี้ โดย `<MAC>` ต้องตรงกับลำโพง:

```text
bluealsa:DEV=<MAC>,PROFILE=a2dp
```

หากไม่พบ `bluealsa:` ให้ติดตั้งและเปิด service:

```bash
sudo apt update
sudo apt install -y bluez bluez-alsa-utils
sudo systemctl enable --now bluetooth bluealsa
sudo systemctl restart bluealsa
```

### 2. ตรวจ MAC ใน MPD output

ดู block Bluetooth Speaker ใน MPD config:

```bash
sudo grep -A5 -B1 'name.*Bluetooth Speaker' /etc/mpd.conf
```

ต้องมีชื่อ `Bluetooth Speaker` และบรรทัด `device` ต้องใช้ MAC เดียวกับผลจาก `bluetoothctl devices Connected`:

```conf
audio_output {
    type            "alsa"
    name            "Bluetooth Speaker"
    device          "bluealsa:DEV=<MAC>,PROFILE=a2dp"
    mixer_type      "software"
}
```

หาก MAC ยังเป็น `00:00:00:00:00:00` หรือเป็น MAC ของลำโพงตัวเก่า ให้แก้ `<MAC>` เป็นค่าที่ถูกต้อง แล้ว restart MPD:

```bash
sudo nano /etc/mpd.conf
sudo systemctl restart mpd
sudo systemctl status mpd --no-pager
```

### 3. เปิด Bluetooth output ใน MPD

```bash
mpc outputs
```

หาเลข output ของ `Bluetooth Speaker` แล้วเปิด output นั้น ปิด output อื่นที่ไม่ต้องการ ตัวอย่างนี้ใช้เลขจากผลลัพธ์จริงเท่านั้น:

```bash
mpc disable <existing-output-id>
mpc enable <bluetooth-output-id>
mpc play
mpc status
```

เมื่อแก้สำเร็จ `mpc status` ต้องไม่มี `ERROR: Failed to open audio output` และเมื่อเลือกสถานีแล้วกด Play ต้องแสดง `[playing]`.

### 4. ใช้หน้าเว็บให้ตั้ง MAC อัตโนมัติ

แอป Docker ต้องใช้ host helper เพื่ออัปเดต MAC ใน `/etc/mpd.conf` อัตโนมัติหลังจากกด Connect. ตรวจ service และ socket:

```bash
sudo systemctl status piradio-poweroff-helper.service --no-pager
ls -l /run/piradio/mpd-config.sock
cd ~/radio-server/Docker
docker compose exec piradio ls -l /run/piradio/
```

หาก helper หรือ socket ไม่มี ให้ติดตั้ง/อัปเดต helper แล้ว rebuild container:

```bash
cd ~/radio-server/Docker/scripts
sudo install -m 755 piradio-poweroff-helper.py /usr/local/bin/piradio-poweroff-helper.py
sudo install -m 644 piradio-poweroff-helper.service /etc/systemd/system/piradio-poweroff-helper.service
sudo systemctl daemon-reload
sudo systemctl enable --now piradio-poweroff-helper.service
sudo systemctl restart piradio-poweroff-helper.service

cd ~/radio-server/Docker
docker compose up -d --build
```

หลังจากนั้น reconnect ลำโพงจากหน้าเว็บหนึ่งครั้ง เพื่อให้ helper แทนที่ MAC ใน MPD output และ restart MPD อัตโนมัติ.

### 5. หากยังไม่มีเสียง

ตรวจ profile ของอุปกรณ์ โดยใช้ MAC ของลำโพง:

```bash
bluetoothctl info <MAC>
```

ต้องเห็น `Connected: yes` และรองรับ `Audio Sink` หรือ A2DP. หากยังไม่ connected หรือ profile ไม่พร้อม ให้ reconnect:

```bash
bluetoothctl disconnect <MAC>
bluetoothctl connect <MAC>
```

ตรวจ log ของ service ที่เกี่ยวข้อง:

```bash
journalctl -u bluealsa -n 80 --no-pager
journalctl -u mpd -n 80 --no-pager
journalctl -u piradio-poweroff-helper.service -n 80 --no-pager
```
