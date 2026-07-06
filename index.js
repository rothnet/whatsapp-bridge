import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('=== סרוק את הקוד הבא עם וואטסאפ ===');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('החיבור נסגר. מתחבר מחדש:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ מחובר לוואטסאפ בהצלחה!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    if (from.endsWith('@g.us')) return; // מתעלם מקבוצות

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';
    if (!text) return;

    const phone = from.split('@')[0];
    console.log(`הודעה מ-${phone}: ${text}`);

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Whatsapp-Secret': WEBHOOK_SECRET,
        },
        body: JSON.stringify({ phone_number: phone, message_text: text }),
      });

      const data = await res.json();
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
