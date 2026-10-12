# คู่มือการแก้ไขปัญหาเบื้องต้น (Troubleshooting Guide) - Pi Radio

คู่มือฉบับนี้สรุปปัญหาที่พบบ่อยหลังจากการปิดพักเครื่อง Raspberry Pi 3B ไปหลายวัน แล้วเมื่อเปิดใหม่กลับไม่สามารถเชื่อมต่ออินเทอร์เน็ตเพื่อเล่นคลื่นวิทยุได้ พร้อมขั้นตอนแก้ไขและตรวจสอบการทำงานของระบบ

---

## 1. อาการที่พบ (Symptom)
* เปิดเครื่อง Raspberry Pi ขึ้นมาแล้วใช้งาน Internet Radio ผ่าน Docker ไม่ได้
* รีโมทเข้าเครื่องผ่าน SSH ไม่สำเร็จ (IP เดิมเชื่อมต่อไม่ได้)
* บนหน้าจอแสดงสถานะระบุว่า: `My IP address is 127.0.1.1` (ไม่มี IP ของวง LAN เช่น `192.168.x.x` แสดงผล)

---

## 2. สาเหตุหลักของปัญหา (Root Causes)
1. **ตัวเครื่อง Pi ไม่ได้เชื่อมต่อเครือข่ายอินเทอร์เน็ต:** ตัวเลข IP `127.0.1.1` คือ Local Loopback IP ภายในตัวเองเท่านั้น ทำให้เครือข่ายภายนอกมองไม่เห็นเครื่อง และ Docker สตรีมเพลงไม่ได้
2. **โปรไฟล์ Wi-Fi ใน NetworkManager เสียหาย:** เมื่อพยายามใช้คำสั่งเชื่อมต่อใหม่ คอนโซลส่งแจ้งเตือน:
   > `Error: 802-11-wireless-security.key-mgmt: property is missing.`
   เกิดจากการมีโปรไฟล์เก่าที่บันทึกไว้แบบไม่สมบูรณ์ค้างอยู่ ทำให้ NetworkManager ปฏิเสธการเขียนทับโดยข้อมูลคีย์ความปลอดภัยใหม่

---

## 3. วิธีการแก้ไขปัญหา (Solutions)

ทำตามขั้นตอนต่อไปนี้ผ่านหน้าจอคอมพิวเตอร์ที่ต่อตรงกับ Pi (ใช้ Keyboard ต่อกับพอร์ต USB ของ Pi):

### ขั้นตอนที่ 1: ตรวจสอบและลบโปรไฟล์การเชื่อมต่อเดิมที่พังออก
พิมพ์คำสั่งนี้เพื่อทำการลบโปรไฟล์ Wi-Fi "M-Home_2.4" ตัวที่มีปัญหาออกก่อน:
```bash
sudo nmcli connection delete "M-Home_2.4"
```

### ขั้นตอนที่ 2: ทำการลงทะเบียนเชื่อมต่อ Wi-Fi ใหม่อีกครั้ง
เชื่อมต่อไปหาเราเตอร์ Wi-Fi ของคุณ (ระวังตัวอักษรพิมพ์ใหญ่-เล็ก และเครื่องหมายขีดล่าง `_`):
```bash
sudo nmcli device wifi connect "M-Home_2.4" password "รหัสผ่าน_WiFi_ของคุณ"
```
*หมายเหตุ: หากยังติดขัดปัญหาในข้อความรหัสผ่าน ให้ใช้ออปชัน `--ask` เพื่อป้อนทีละขั้นตอน:*
```bash
sudo nmcli --ask device wifi connect "M-Home_2.4"
```

### ขั้นตอนที่ 3: ตรวจสอบการรับ IP และอินเทอร์เน็ต
เมื่อระบบประมวลผลการเชื่อมต่อสำเร็จ ให้ยืนยันหมายเลข IP และทดสอบการเดินสัญญาณเครือข่ายด้วยสองคำสั่งนี้:
```bash
# ตรวจสอบ IP Address
hostname -I

# ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตออกสู่ภายนอก
ping -c 3 google.com
```

---

## 4. วิธีการตรวจสอบว่าระบบกลับมาเป็นปกติหรือยัง (How to Verify)

เมื่อตัวเครื่องเชื่อมต่ออินเทอร์เน็ตและได้ IP ปกติเรียบร้อย สามารถเช็คตัวระบบ Docker Radio ดังนี้:

### ตรวจสอบสถานะการรัน Container
เรียกเข้าโฟลเดอร์สำหรับติดตั้ง Docker และสั่งตรวจเช็คผ่าน SSH จากระยะไกล:
```bash
cd ~/radio-server/Docker
docker compose ps
```
*(สถานะของ container ชื่อ `piradio` ต้องขึ้นสถานะว่า `Up`)*

### ตรวจสอบการทำเครื่องเล่นเสียง (MPD)
ตรวจดูว่า Docker ติดต่อกับเครื่องเล่นเสียงที่พาร์ทหลัก Host สำเร็จ:
```bash
docker compose exec piradio mpc status
```
*(ต้องรายงานข้อมูลระดับเสียงและสถานะคลื่นเพลงมาตรงกัน ไม่ขึ้นข้อกล่าวหา: CONNECTION REFUSED)*

### ทดสอบใช้งานผ่านหน้าเว็บเบราว์เซอร์
เปิดโปรแกรมท่องเว็บ (Google Chrome/Safari) ผ่านอุปกรณ์ในวง Wi-Fi เดียวกัน แล้วไปที่พอร์ท `:5000`:
```text
http://<IP_ของ_Raspberry_Pi>:5000
```
หากเสียงเพลงสตรีมออกลำโพงได้ตามปกติและเปลี่ยนสถานีได้ราบรื่น แสดงว่าระบบทั้งหมดกลับมาใช้งานได้ครบถ้วนแล้ว!

---

## 5. ปัญหา: ปุ่ม Power Off บนหน้าเว็บไม่ทำงานเมื่อรันผ่าน Docker (Raspberry Pi 3B)

### อาการที่พบ (Symptom)
* กดปุ่ม Power Off (ปุ่มปิดเครื่องสีแดง) บนหน้าเว็บแล้ว Raspberry Pi 3B ไม่ยอมปิดเครื่อง (ไม่มีผลใดๆ เกิดขึ้น) ต่างจากบน Raspberry Pi Zero 2 W ที่รันแบบ Bare-metal/systemd ซึ่งกดปิดเครื่องได้ตามปกติ

### สาเหตุของปัญหา (Root Causes)
1. **ไม่มีคำสั่ง `sudo` ภายใน Container:** โค้ดใน backend เรียกคำสั่ง `subprocess.Popen(["sudo", "/sbin/poweroff"])` แต่ใน Docker Image ติดตั้งไว้เพียง `bluez` และ `mpc` ไม่มีแพ็กเกจ `sudo` และไม่มีการตั้งค่า sudoers ใน Container ทำให้คำสั่งล้มเหลวทันที
2. **ข้อจำกัดเรื่องสิทธิ์และการแยกส่วนของ Docker (Container Isolation):** โดยค่าเริ่มต้น Container จะถูกจำกัด Linux capabilities (ไม่มี `CAP_SYS_BOOT`) และไม่มี systemd ของ Host ทำให้ process ภายใน Container ไม่มีสิทธิ์ส่งสัญญาณปิดเครื่องจริงของ Host ได้

### วิธีการแก้ไข / ข้อแนะนำ (Workaround & Solutions)
* **การด้านกระดาษโน้ต - ปัญหาสำหรับ Line Endings (CRLF / `\r`):**
  เมื่อดาวน์โหลดหรือแก้ไขสคริปต์บนระบบปฏิบัติการ Windows แล้วนำไปเปิดระบบบลูทูธหรือระบบ Wi-Fi หมุนเวียนบนบอร์ด Linux เช่น `/usr/local/sbin/piradio-update-mpd-bluetooth` หรือ `/usr/local/bin/wifi-fallback.sh` มักจะเกิดพาร์ทแปลกปลอมตัวอักษรแฝง `\r` ทำให้รันคำสั่งเฟล ให้กู้และทำความสะอาดด้วยการรันคำสั่ง:
  ```bash
  sudo sed -i 's/\r$//' /usr/local/sbin/piradio-update-mpd-bluetooth
  sudo sed -i 's/\r$//' /usr/local/bin/wifi-fallback.sh
  sudo systemctl daemon-reload
  sudo systemctl restart wifi-fallback.service
  ```
* **การเชื่อมสัญญาณเมื่อบอร์ดหลุดวงเครือข่ายแล้วปล่อย Host WiFi `PiRadio-Setup`:**
  1. ล็อกอินเข้า Wi-Fi คลื่น `PiRadio-Setup` ด้วยคีย์รหัสผ่าน **`piradio1234`**
  2. เข้าเว็บเบราว์เซอร์ไปที่โดเมนหลัก **`http://10.42.0.1`** (หรือลองผ่าน mDNS **`http://raspberrypi.local`**)
  3. กดที่เครื่องฟันเฟือง **⚙️ Settings** -> เลือก **📶 Wi-Fi** แล้วป้อนเชื่อมกับสแกนเนอร์ Wi-Fi บ้าน วงความถี่ 2.4GHz
  4. เมื่อเชื่อมต่อแล้ว ให้เชื่อมโครงข่ายมือถือคุณเข้าที่เดิม แล้วสั่งรันหน้าเว็บหลักได้ผ่านโดเมน **`http://raspberrypi.local`** (หรือ IP หลักของบอร์ด) ได้ทันทีครับ!
* **การเปิดเล่นมีเดียเซิร์ฟเวอร์ (DLNA) บูตแล้วเล่นได้เพลงเดียวค้าง:**
  - ตัวแอปพลิเคชันได้รับการปรับแต่งแกนทำงานใน `restore_last_audio_output()` ให้กลับไปปะคอสร้างดึงคิวของเพลงทั้งอัลบั้มมาใส่ MPD ใหม่ตั้งแต่ต้นให้แล้ว เพียงส่งไฟล์ `app.py` หลังอัปเดตและสั่งรีสตาร์ตระบบเซอร์วิส:
    ```bash
    sudo systemctl restart radio.service
    ```
    บอร์ดก็จะกู้คืนสตรีมทั้งโฟลเดอร์ทำงานได้เหมือนเพิ่งกดจองบนเว็บแล้วครับ!

---

## 6. ปัญหา: กดปุ่ม Play แล้วไม่เล่น หรือเด้งกลับมาเป็นปุ่ม PLAY/Stopped เหมือนเดิม (Bare-metal)

### อาการที่พบ (Symptom)
* เมื่อกดปุ่ม Play บนหน้าเว็บ หน้าจอพยายามโหลดหรือเปลี่ยนเป็นปุ่ม Pause/Stop ชั่วครู่ จากนั้นเด้งกลับไปเป็นสถานะ Stopped หรือโชว์ปุ่ม Play เหมือนเดิม โดยไม่มีเสียงเพลงออก
* เมื่อเข้าไปพิมพ์คำสั่ง `mpc status` ด้วย SSH บน Raspberry Pi จะพบข้อผิดพลาดสีแดง เช่น:
  ```text
  ERROR: Failed to open "USB Headphone" (alsa); Failed to open ALSA device "plughw:CARD=Audio,DEV=0": No such device
  ```

### สาเหตุของปัญหา (Root Causes)
1. **ไม่สามารถเปิดช่องเสียงหลักที่เลือกไว้ได้ (Audio Output Failed):** 
   - ตัวโปรแกรม MPD (Music Player Daemon) ถูกตั้งค่าให้ส่งสัญญาณเสียงออกไปยัง USB Sound Card / DAC (ในระบบมักตั้งชื่อว่า "USB Headphone" และชี้อุปกรณ์ไปที่ `plughw:CARD=Audio,DEV=0`) แต่ในขณะนั้นตัวเครื่อง Pi ตรวจไม่พบฮาร์ดแวร์ USB Sound Card ดังกล่าว (อาจเกิดจากสายหลวม, เสียบพอร์ตผิด, หรือไม่มีตัวอุปกรณ์เสียบอยู่)
   - มีการเปิดใช้งาน (enable) อุปกรณ์ Bluetooth Speaker ค้างไว้ แต่ไม่ได้เปิดเครื่องหรือเชื่อมต่อสัญญาณลำโพง Bluetooth จริง ๆ ทำให้ MPD พยายามสตรีมเสียงออกปลายทางแล้วเปิดระบบเสียงไม่ได้ จึงตัดจบการเล่นลงทันที
2. **พิมพ์คำสั่ง mpc บน Terminal ผิดไวยากรณ์ (Syntax Error):**
   - เช่น การแอดลิงก์สตรีมวิทยุผ่านคอมมานด์ไลน์ที่มีอักขระพิเศษอย่างเครื่องหมายเซมิโคลอน `;` โดยไม่ป้อนอัญประกาศครอบเครื่องหมาย เช่น `mpc add https://coolism-web.cdn.byteark.com/;stream/1` ซึ่งจะทำให้ระบบปฏิบัติการ Linux ตีความผิดพลาดและพยายามรันคำสั่งถัดไปหลังจากเครื่องหมาย `;` จนขึ้นความผิดพลาด `-bash: stream/1: No such file or directory`

### วิธีการแก้ไข (Solutions)

#### ขั้นตอนที่ 1: ตรวจสอบสัญญาณฮาร์ดแวร์การ์ดเสียงที่เชื่อมต่ออยู่
เข้าสู่ระบบด้วย SSH แล้วพล็อตดูสถานะของซาวด์การ์ด:
```bash
aplay -l
```
* หากพบลักษณะ `no soundcards found...` แสดงว่าสายเสียบของ USB Sound Card หลวมหรือไม่ได้ต่อตรงอยู่ ให้ขยับหรือสลับช่องเสียบ USB ใหม่ให้เข้าที่แน่นหนา
* สังเกตชื่อการ์ดเสียงที่ระบบตรวจพบในการ์ดปัจจุบัน (เช่น มีชื่อ `CARD=Audio` ตรวจพบหรือไม่)

#### ขั้นตอนที่ 2: ปิด-เปิดการสตรีมเสียง (Output) ที่เชื่อมต่ออยู่จริง
หากต้องการสลับมาใช้งาน **USB Sound Card** (Output 1) โดยยังไม่ติดตั้งลำโพงบลูทูธ:
1. เรียกดูรายชื่อและค่า ID ของ outputs:
   ```bash
   mpc outputs
   ```
2. ดำเนินการสั่งปิดการทำงานตัวที่ไม่ได้เชื่อมอยู่จริงและเปิดตัวหลักให้รันทำงาน (สมมติให้ USB Headphone เป็นเลข 1 และ Bluetooth Speaker เป็นเลข 2):
   ```bash
   mpc enable 1
---

## 7. ปัญหา: เปิดเครื่องมาเล่นเพลงต่อได้ แล้ว network หลุดให้ตั้งค่า Wi‑Fi ใหม่ทุกครั้ง (Bare-metal)

### อาการที่พบ (Symptom)

* เปิดเครื่อง Raspberry Pi (ไม่ใช้ Docker) Internet Radio กลับมาเล่นสถานีเดิมต่อจากครั้งก่อนได้ปกติ
* เล่นไปสักพัก (ประมาณ 1-2 นาที) network หลุด หน้าเว็บขึ้นข้อความ "Setup hotspot active — connect a phone/computer to the Pi's own Wi-Fi to configure"
* ต้องเข้าไปหน้า Wi‑Fi Settings เพื่อ Connect ใหม่ทุกครั้งหลังบูต

### สาเหตุของปัญหา (Root Causes)

1. **`wifi-fallback.service` เปิด hotspot `PiRadio-Setup` แทน:** มีการติดตั้ง systemd service `wifi-fallback.service` ซึ่งรัน `scripts/wifi-fallback.sh` หลังบูต โดยสคริปต์จะรอให้ Wi‑Fi เชื่อมต่อภายในเวลาที่กำหนด (`WAIT_SECONDS`) หากไม่ทันจะรัน `nmcli connection up PiRadio-Setup` ซึ่ง **ตัด Wi‑Fi จริงทิ้งและเปลี่ยนการ์ดเป็นโหมด AP** ทันที
2. **เกณฑ์ตัดสินเดิมใช้แค่ Wi‑Fi interface state:** สคริปต์รุ่นเก่าดูแค่ว่า `wlan0` มี active connection ที่ไม่ใช่ hotspot หรือไม่ — ไม่สนใจ ethernet หรือการเข้าถึงอินเทอร์เน็ตจริง (Layer 3)
3. **Pi Zero 2 W เชื่อมต่อ Wi‑Fi ช้า:** โดยเฉพาะกับ router ที่ DHCP ช้า หรือสัญญาณอ่อน อาจต้องใช้เวลา 60-90 วินาทีจึงจะได้ IP
4. **MPD เล่นเพลงจาก buffer ต่อได้ช่วงแรก:** ทำให้ดูเหมือน network ปกติ ก่อนที่ hotspot จะตัด Wi‑Fi ทิ้ง

### วิธีการแก้ไข (Solutions)

#### วิธีที่ 1: อัปเดตสคริปต์ `wifi-fallback.sh` และ restart service (แนะนำ)

สคริปต์รุ่นล่าสุด (v2026-10-01) มีการปรับปรุงดังนี้:
- ใช้ **ping 8.8.8.8 / 1.1.1.1** เพื่อเช็คอินเทอร์เน็ตจริงก่อนเปิด hotspot
- เพิ่มการเช็ค **ethernet** — ถ้าต่อ LAN อยู่และอินเทอร์เน็ตถึง จะไม่เปิด hotspot
- เพิ่ม **state stamp** (`/var/run/wifi-fallback-online.stamp`) — ถ้าอินเทอร์เน็ตเคยถึงใน boot นี้แล้ว จะไม่เปิด hotspot อีก
- เพิ่มเวลารอ **60 → 90 วินาที**
- เพิ่ม retries **3 → 5** ครั้ง

**ขั้นตอนอัปเดต:**
```bash
# ส่งไฟล์ใหม่ไป Pi แล้วติดตั้ง
sudo install -m 755 ~/radio-server/scripts/wifi-fallback.sh /usr/local/bin/wifi-fallback.sh
sudo install -m 644 ~/radio-server/scripts/wifi-fallback.service /etc/systemd/system/wifi-fallback.service
sudo systemctl daemon-reload
sudo systemctl disable wifi-fallback.service   # disable ของเก่าที่กำลังรัน
sudo systemctl enable --now wifi-fallback.service

# ตรวจสอบ log
sudo journalctl -u wifi-fallback.service -n 100 --no-pager
```

หลัง reboot ควรเห็น log ขึ้น `"Internet reachable (via wifi or ethernet) after ~XXs"` หรือ `"Internet is already reachable"` แสดงว่าไม่หลุด hotspot

#### วิธีที่ 2: disable `wifi-fallback.service` ถ้าไม่ต้องการ hotspot เลย

ถ้าเครื่องต่อ ethernet เป็นหลัก หรือตั้งค่า Wi‑Fi จนเสถียรแล้ว และไม่ต้องการโหมด setup hotspot:

```bash
sudo systemctl disable --now wifi-fallback.service
```

#### วิธีที่ 3: ตรวจสอบและซ่อมโปรไฟล์ Wi‑Fi ที่เสีย

บางครั้งโปรไฟล์ Wi‑Fi ใน NetworkManager เสีย (key-mgmt หาย) ทำให้เชื่อมต่ออัตโนมัติไม่สำเร็จ:

```bash
# ดูโปรไฟล์ทั้งหมด
nmcli connection show

# ถ้าโปรไฟล์มีปัญหาหรือขึ้น Error: 802-11-wireless-security.key-mgmt: property is missing
# ให้ลบแล้วสร้างใหม่
sudo nmcli connection delete "<ชื่อ SSID>"

# สร้างใหม่
sudo nmcli device wifi connect "<SSID>" password "<รหัสผ่าน>"
```

### วิธีการตรวจสอบว่าหายหรือยัง (How to Verify)

1. Reboot Pi: `sudo reboot`
2. รอประมาณ 2 นาที
3. SSH เข้า Pi แล้วเช็ค:
   ```bash
   sudo systemctl status wifi-fallback.service --no-pager
   # ต้องเห็น status: exited (success) และไม่มีข้อความ "Starting setup hotspot"

   sudo journalctl -u wifi-fallback.service -n 50 --no-pager
   # ต้องไม่บรรทัด "Hotspot ... is now active"

   ping -c 3 8.8.8.8
   # ต้องตอบกลับ normal

   ls -la /var/run/wifi-fallback-online.stamp 2>/dev/null && echo "Online stamp exists ✓"
   ```
4. เปิดหน้าเว็บ: ต้องเห็นสถานะปกติ (connected to <SSID>) ไม่ใช่ "Setup hotspot active"

#### ขั้นตอนที่ 3: ตรวจค่าและแก้ไขไฟล์ตั้งค่าอุปกรณ์ `/etc/mpd.conf`
หากชื่อทางการ์ดเสียงที่ตรวจพบในระบบแตกต่างจากเดิม (เช่น เปลี่ยนชิปอุปกรณ์เสียบเสียงตัวใหม่):
```bash
sudo nano /etc/mpd.conf
```
เลื่อนลงไปแต่งแก้บล็อก `audio_output` ที่มีชื่อ `"USB Headphone"` ในส่วนกำหนดชี้พารามิเตอร์ `device` ให้ถูกต้องตามค่าจริงที่กวาดเจอจาก `aplay -l`:
```conf
audio_output {
    type        "alsa"
    name        "USB Headphone"
    device      "plughw:CARD=Audio,DEV=0"   # แก้ไขชื่อตามการ์ดเสียงจริงที่ได้จาก aplay -l
    mixer_type  "software"
}
```
กดสั่งเซฟและทำการ Restart บริการ MPD:
```bash
sudo systemctl restart mpd
```

#### ขั้นตอนที่ 4: การวางคำสั่งแอดสตรีมด้วยคอมมานด์ไลน์ที่ปลอดภัย 
จำไว้ว่าต้องครอบเครื่องหมายคำพูด (Quotes) ครอบลิงก์เพื่อไม่ให้อักขระพิเศษอย่าง `;` ทำงานผิดพลาด:
```bash
mpc add "https://coolism-web.cdn.byteark.com/;stream/1"
mpc play
```