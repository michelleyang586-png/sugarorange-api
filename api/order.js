const LINE_TOKEN = '2pgUy78YYeH/bf+gL4MyCWxiQYA2XtFUPzWwIigkRj3/JBHy5Ee6Z92uOBkTYgo9kZYp5mBCfLybgd9VVLLb7hTPqb9VE2Q2d1lYMVPV3euPtDKYEuinsN0LcuxXCtpm9MIS9dLqvVphxhCTETYZmAdB04t89/1O/w1cDnyilFU=';
const ADMIN_USER_ID = 'Uf86482255e83a7bcd1b70e70a50aef76';
const SPREADSHEET_ID = '1mou2lH78WpiCaFouirBw57E3foZN-UYrQy1z05tF1o0';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.method === 'GET' ? req.query.action : req.body?.action;

  if (!action || action === 'stock') {
    return handleStock(req, res);
  } else if (action === 'order') {
    return handleOrder(req, res);
  }
}

async function handleStock(req, res) {
  try {
    const { GoogleSpreadsheet } = await import('google-spreadsheet');
    const { JWT } = await import('google-auth-library');
    const doc = await getDoc(GoogleSpreadsheet, JWT);
    const sheet = doc.sheetsByTitle['庫存控制'];
    const rows = await sheet.getRows();
    const row = rows[0];
    return res.json({
      remaining: Number(row.get('剩餘庫存')),
      price: Number(row.get('單價'))
    });
  } catch(e) {
    return res.json({ remaining: 9999, price: 400 });
  }
}

async function handleOrder(req, res) {
  try {
    const { GoogleSpreadsheet } = await import('google-spreadsheet');
    const { JWT } = await import('google-auth-library');
    const data = req.method === 'POST' ? req.body : req.query;
    const quantity = parseInt(data.quantity);
    const amount = parseInt(data.amount);
    const orderId = 'ORD-' + Date.now();
    const timestamp = new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});

    const doc = await getDoc(GoogleSpreadsheet, JWT);

    const orderSheet = doc.sheetsByTitle['訂單總表'];
    await orderSheet.addRow({
      '訂單編號': orderId,
      '時間戳記': timestamp,
      'LINE名稱': data.lineName,
      '電話': data.phone,
      '取貨方式': data.deliveryType,
      '數量': quantity,
      '金額': amount,
      '收件地址': data.address || '自取',
      '備註': data.note || '',
      '付款狀態': data.deliveryType === '宅配' ? '待匯款' : '貨到付款',
      '出貨狀態': '待出貨'
    });

    const stockSheet = doc.sheetsByTitle['庫存控制'];
    const rows = await stockSheet.getRows();
    const row = rows[0];
    const newSold = Number(row.get('已售數量')) + quantity;
    const total = Number(row.get('總庫存'));
    row.set('已售數量', newSold);
    row.set('剩餘庫存', total - newSold);
    await row.save();

    await sendLine(orderId, data, quantity, amount);

    return res.json({ status: 'success', orderId });
  } catch(e) {
    return res.status(500).json({ status: 'error', message: e.message });
  }
}

async function getDoc(GoogleSpreadsheet, JWT) {
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

async function sendLine(orderId, data, quantity, amount) {
  const shipping = data.deliveryType === '宅配' ? Math.ceil(quantity / 4) * 150 : 0;
  const productAmount = amount - shipping;
  const emoji = data.deliveryType === '宅配' ? '🚚' : '🏪';
  const message = '📦 新訂單！\n' +
    '訂單編號：' + orderId + '\n' +
    '姓名：' + data.lineName + '\n' +
    '電話：' + data.phone + '\n' +
    '取貨方式：' + emoji + ' ' + data.deliveryType + '\n' +
    '數量：' + quantity + ' 盒\n' +
    '商品金額：NT$ ' + productAmount + '\n' +
    (data.deliveryType === '宅配' ? '運費：NT$ ' + shipping + '\n' : '') +
    '總金額：NT$ ' + amount + '\n' +
    (data.deliveryType === '宅配' ? '地址：' + data.address + '\n' : '') +
    (data.note ? '備註：' + data.note + '\n' : '') +
    '付款：' + (data.deliveryType === '宅配' ? '⏳ 等待匯款' : '貨到付款');

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
