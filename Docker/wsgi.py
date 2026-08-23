import os
import threading

from waitress import serve

from app import app, restore_last_audio_output


threading.Thread(target=restore_last_audio_output, daemon=True).start()

serve(app, host="0.0.0.0", port=int(os.environ.get("PIRADIO_PORT", "5000")), threads=4)