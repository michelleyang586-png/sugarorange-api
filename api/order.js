const LINE_TOKEN = '2pgUy78YYeH/bf+gL4MyCWxiQYA2XtFUPzWwIigkRj3/JBHy5Ee6Z92uOBkTYgo9kZYp5mBCfLybgd9VVLLb7hTPqb9VE2Q2d1lYMVPV3euPtDKYEuinsN0LcuxXCtpm9MIS9dLqvVphxhCTETYZmAdB04t89/1O/w1cDnyilFU=';
const ADMIN_USER_ID = 'Uf86482255e83a7bcd1b70e70a50aef76';
const SPREADSHEET_ID = '1mou2lH78WpiCaFouirBw57E3foZN-UYrQy1z05tF1o0';

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const { createSign } = await import('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const signature = sign.sign(rawKey, 'base64url');
  const jwt = `${header}.${claim}.${signature}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('取得 token 失敗：' + JSON.stringify(data));
  return data.access_token;
}

async function readRange(token, range) {
  const encodedRange = encodeURIComponent(range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}`;
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  const data = await res.json();
  if (!data.values) throw new Error('讀取試算表失敗：' + JSON.stringify(data));
  return data.values;
}

async function writeRange(token, range, values) {
  const encodedRange = encodeURIComponent(range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
}

async function appendRow(token, range, values) {
  const encodedRange = encodeURIComponent(range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}:append?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
}

async function sendLine(message) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN },
    body: JSON.stringify({ to: ADMIN_USER_ID, messages: [{ type: 'text', text: message }] })
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await getAccessToken();
    const action = req.query.action;

    if (action === 'order') {
      const { lineName, recipientName, phone, deliveryType, quantity, amount, address, note, lineUserId } = req.query;
      const qty = parseInt(quantity);
      const amt = parseInt(amount);
      const orderId = 'ORD-' + Date.now();
      const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      const actualName = recipientName || lineName;

      await appendRow(token, '訂單總表!A:K', [[
        orderId, timestamp,
        lineName + '（' + actualName + '）',
        phone, deliveryType, qty, amt,
        address || '自取', note || '',
        deliveryType === '宅配' ? '待匯款' : '貨到付款',
        '待出貨'
      ]]);

      const stockValues = await readRange(token, '庫存控制!B2:E2');
      const row = stockValues[0];
      const total = Number(row[1]);
      const sold = Number(row[2]);
      const newSold = sold + qty;
      await writeRange(token, '庫存控制!D2:E2', [[newSold, total - newSold]]);

      const shipping = deliveryType === '宅配' ? Math.ceil(qty / 4) * 150 : 0;
      const productAmount = amt - shipping;
      const emoji = deliveryType === '宅配' ? '🚚' : '🏪';
      const msg = '📦 新訂單！\n' +
        '訂單編號：' + orderId + '\n' +
        'LINE帳號：' + lineName + '\n' +
        '收件人：' + actualName + '\n' +
        '電話：' + phone + '\n' +
        '取貨方式：' + emoji + ' ' + deliveryType + '\n' +
        '數量：' + qty + ' 盒\n' +
        '商品金額：NT$ ' + productAmount + '\n' +
        (deliveryType === '宅配' ? '運費：NT$ ' + shipping + '\n' : '') +
        '總金額：NT$ ' + amt + '\n' +
        (deliveryType === '宅配' ? '地址：' + address + '\n' : '') +
        (note ? '備註：' + note + '\n' : '') +
        '付款：' + (deliveryType === '宅配' ? '⏳ 等待匯款' : '貨到付款');

      await sendLine(msg);
      return res.json({ status: 'success', orderId });

    } else {
      const stockValues = await readRange(token, '庫存控制!B2:E2');
      const row = stockValues[0];
      const price = Number(row[0]);
      const remaining = Number(row[3]);
      return res.json({ price, remaining });
    }

  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
