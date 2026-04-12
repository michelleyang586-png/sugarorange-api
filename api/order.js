const LINE_TOKEN = '2pgUy78YYeH/bf+gL4MyCWxiQYA2XtFUPzWwIigkRj3/JBHy5Ee6Z92uOBkTYgo9kZYp5mBCfLybgd9VVLLb7hTPqb9VE2Q2d1lYMVPV3euPtDKYEuinsN0LcuxXCtpm9MIS9dLqvVphxhCTETYZmAdB04t89/1O/w1cDnyilFU=';
const ADMIN_USER_ID = 'Uf86482255e83a7bcd1b70e70a50aef76';
const SPREADSHEET_ID = '1mou2lH78WpiCaFouirBw57E3foZN-UYrQy1z05tF1o0';

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const signature = sign.sign(key, 'base64url');
  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  return data.access_token;
}

async function appendRow(token, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/%E8%A8%82%E5%96%AE%E7%B8%BD%E8%A1%A8!A:K:append?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [values] })
  });
}

async function getStockData(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/%E5%BA%AB%E5%AD%98%E6%8E%A7%E5%88%B6!A2:E2`;
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const data = await res.json();
  return data.values[0];
}

async function updateStock(token, newSold, newRemaining) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/%E5%BA%AB%E5%AD%98%E6%8E%A7%E5%88%B6!D2:E2?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [[newSold, newRemaining]] })
  });
}

async function sendLine(message) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_TOKEN
    },
    body: JSON.stringify({
      to: ADMIN_USER_ID,
      messages: [{ type: 'text', text: message }]
    })
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

      await appendRow(token, [
        orderId, timestamp, lineName + '（' + (recipientName || lineName) + '）', phone, deliveryType,
        qty, amt, address || '自取', note || '',
        deliveryType === '宅配' ? '待匯款' : '貨到付款',
        '待出貨'
      ]);

      const stockValues = await getStockData(token);
      const price = Number(stockValues[1]);
      const total = Number(stockValues[2]);
      const sold = Number(stockValues[3]);
      const newSold = sold + qty;
      await updateStock(token, newSold, total - newSold);

      const shipping = deliveryType === '宅配' ? Math.ceil(qty / 4) * 150 : 0;
      const productAmount = amt - shipping;
      const emoji = deliveryType === '宅配' ? '🚚' : '🏪';
      const msg = '📦 新訂單！\n' +
        '訂單編號：' + orderId + '\n' +
        'LINE帳號：' + lineName + '\n' +
        '收件人：' + (recipientName || lineName) + '\n' +
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
      const stockValues = await getStockData(token);
      const price = Number(stockValues[1]);
      const remaining = Number(stockValues[4]);
      return res.json({ price, remaining });
    }

  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
