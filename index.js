import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcodeLib from 'qrcode';
import pino from 'pino';
import http from 'http';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = process.env.PORT || 8080;

let currentQR = null;
let connectionStatus = 'מתחבר...';

http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (currentQR) {
    const qrImage = await qrcodeLib.toDataURL(currentQR);
    res.end(`<html dir="rtl"><body style="text-align:center;font-family:sans-serif;padding-top:40px">
      <h2>סרוק את הקוד עם וואטסאפ</h2>
      <img src="${qrImage}" style="width:300px"/>
      <p>וואטסאפ ← הגדרות ← מכשירים מקושרים ← קישור מכשיר</p>
      <p>הדף מתרענן אוטומטית</p>
      <script>setTimeout(()=>location.reload(),8000)</script>
    </body></html>`);
  } else {
    res.end(`<html dir="rtl"><body style="text-align:center;font-family:sans-serif;padding-top:40px">
      <h2>${connectionStatus}</h2>
      <script>setTimeout(()=>location.reload(),8000)</script>
    </body></html>`);
  }
}).listen(PORT, () => console.log(`שרת רץ על פורט ${PORT}`));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['WhatsApp Bridge', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      connectionStatus = 'ממתין לסריקה...';
      console.log('QR מוכן - פתח את הדף כדי לסרוק');
    }

    if (connection === 'close') {
      currentQR = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'החיבור נסגר, מתחבר מחדש...';
      console.log('החיבור נסגר. קוד:', statusCode, 'מתחבר מחדש:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      }
    } else if (connection === 'open') {
      currentQR = null;
      connectionStatus = '✅ מחובר לוואטסאפ!';
      console.log('✅ מחובר לוואטסאפ בהצלחה!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    if (from.endsWith('@g.us')) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';
    if (!text) return;

    const phone = from.split('@')[0];
    console.log(`הודעה מ-${phone}: ${text}`);

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Whatsapp-Secret': WEBHOOK_SECRET,
        },
        body: JSON.stringify({ phone_number: phone, message_text: text }),
      });

      const data = await response.json();
      const reply = data.reply || data.message || 'לא התקבלה תשובה.';
      await sock.sendMessage(from, { text: reply });
      console.log(`נשלחה תשובה ל-${phone}`);
    } catch (err) {
      console.error('שגיאה:', err);
      await sock.sendMessage(from, { text: 'אירעה שגיאה. נסה שוב מאוחר יותר.' });
    }
  });
}

startBot();
