// ── 砂糖橘系統設定
const LINE_TOKEN = '2pgUy78YYeH/bf+gL4MyCWxiQYA2XtFUPzWwIigkRj3/JBHy5Ee6Z92uOBkTYgo9kZYp5mBCfLybgd9VVLLb7hTPqb9VE2Q2d1lYMVPV3euPtDKYEuinsN0LcuxXCtpm9MIS9dLqvVphxhCTETYZmAdB04t89/1O/w1cDnyilFU=';
const SPREADSHEET_ID = '1o-qz74NpmMshMbFG3O9oCMPRQs8G2Rmr1HEBecUyvXo'; // 砂糖橘專用試算表
const PICKUP_ADDRESS = '苗栗縣公館鄉館東村和東街46號（每日 09:00–17:00）';

// ── Telegram 設定（與水蜜桃共用）
const TELEGRAM_TOKEN = '8667366687:AAE8B2mgPmiFUVo1VfOSoCJ5EjGwayaI7J0';
const TELEGRAM_CHAT_ID = '7588402543';

// ── 砂糖橘商品規格（只有一種，之後可增加）
const specs = [
  { key: 'spec0', name: '砂糖橘 5斤裝', unit: 1, price: 400 }
];

// ── 運費計算（每4盒一單位 $180）
function calcShipping(totalBoxes) {
  if (totalBoxes === 0) return 0;
  return Math.ceil(totalBoxes / 4) * 180;
}

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
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('取得 token 失敗：' + JSON.stringify(data));
  return data.access_token;
}

async function readRange(token, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  return data.values || [];
}

async function writeRange(token, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
}

async function appendRow(token, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&includeValuesInResponse=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  return await res.json();
}

async function colorRows(token, sheetId, startRow, endRow, color) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: startRow, endRowIndex: endRow },
          cell: { userEnteredFormat: { backgroundColor: color } },
          fields: 'userEnteredFormat.backgroundColor'
        }
      }]
    })
  });
}

// ── 訂單編號：TS（自取）/ TD（宅配）+ 日期 + 流水號
async function generateOrderId(token, deliveryType) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = yy + mm + dd;
  const prefix = deliveryType === '宅配' ? 'TD' : 'TS';
  const todayPrefix = prefix + dateStr;
  const rows = await readRange(token, '訂單總表!A:A');
  let maxSeq = 0;
  for (const r of rows) {
    if (!r[0] || !r[0].startsWith(todayPrefix)) continue;
    const parts = r[0].split('-');
    const seq = parseInt(parts[1], 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  const seq = String(maxSeq + 1).padStart(3, '0');
  return `${todayPrefix}-${seq}`;
}

async function sendTelegram(message) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
  });
}

async function sendLineToCustomer(userId, message) {
  if (!userId || !LINE_TOKEN || LINE_TOKEN === 'YOUR_LINE_TOKEN_HERE') return;
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: message }] })
  });
}

const ORDER_COLORS = [
  { red: 1,    green: 0.88, blue: 0.75 },
  { red: 0.82, green: 0.95, blue: 0.82 },
  { red: 0.82, green: 0.9,  blue: 1    },
  { red: 1,    green: 0.85, blue: 0.85 },
  { red: 0.9,  green: 0.85, blue: 1    }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await getAccessToken();
    const action = req.query.action;

    // ── 庫存讀取
    const stockRow = await readRange(token, '庫存控制!A2:C2');
    const totalStock  = Number(stockRow[0]?.[0]) || 0;
    const soldStock   = Number(stockRow[0]?.[1]) || 0;
    const remainStock = Number(stockRow[0]?.[2]) || 0;

    if (action === 'debug') {
      return res.json({ totalStock, soldStock, remainStock });
    }

    if (action === 'order') {
      const { lineName, recipientName, phone, deliveryType, amount, address, note } = req.query;
      const actualName = recipientName || lineName;
      const amt = parseInt(amount) || 0;
      const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      const orderId = await generateOrderId(token, deliveryType);

      let totalBoxes = 0;
      let specSummary = [];
      let orderItems = [];

      for (const item of specs) {
        const qty = parseInt(req.query[item.key]) || 0;
        if (qty <= 0) continue;
        totalBoxes += qty;
        specSummary.push(`${item.name} x ${qty}`);
        orderItems.push({ item, qty, itemAmount: qty * item.price });
      }

      const shipping = deliveryType === '宅配' ? calcShipping(totalBoxes) : 0;

      if (totalBoxes > remainStock) {
        return res.status(400).json({ status: 'error', message: '庫存不足' });
      }

      const rows = await readRange(token, '訂單總表!A:A');
      const uniqueOrders = [...new Set(rows.slice(1).map(r => r[0]).filter(Boolean))];
      const color = ORDER_COLORS[uniqueOrders.length % ORDER_COLORS.length];

      // 欄位對應（A~Q）：
      // A 訂單編號 | B 時間戳記 | C LINE名稱 | D 收件人 | E 電話
      // F 規格 | G 取貨方式 | H 數量 | I 金額 | J 收件地址
      // K 備註 | L 付款狀態 | M 出貨狀態 | N 後五碼(手填)
      // O 預計出貨日(後台排) | P 🟠出貨日期(後台自動) | Q 🟢收款日期(後台自動)
      let firstRowIndex = null;
      for (const row of orderItems) {
        const result = await appendRow(token, '訂單總表!A:Q', [[
          orderId, timestamp, lineName, actualName, phone,
          row.item.name, deliveryType, row.qty, row.itemAmount,
          address || '自取', note || '',
          deliveryType === '宅配' ? '待匯款' : '貨到付款',
          '待出貨', '', '', '', ''
        ]]);
        if (firstRowIndex === null) {
          const match = result.updates.updatedRange.match(/A(\d+):/);
          if (match) firstRowIndex = Number(match[1]) - 1;
        }
      }

      await colorRows(token, 0, firstRowIndex, firstRowIndex + orderItems.length, color);

      const newSold   = soldStock + totalBoxes;
      const newRemain = totalStock - newSold;
      await writeRange(token, '庫存控制!B2:C2', [[newSold, newRemain]]);

      const productAmount = amt - shipping;
      const emoji = deliveryType === '宅配' ? '🚛' : '🏪';
      const noteText = (note || '').trim() ? '\n📝 備註：' + note : '';
      const specLines = specSummary.join('\n');

      // ── 管理員通知（Telegram）
      const adminMsg =
        '🍊 新砂糖橘訂單！\n' +
        '訂單編號：' + orderId + '\n' +
        'LINE帳號：' + lineName + '\n' +
        '收件人：' + actualName + '\n' +
        '電話：' + phone + '\n' +
        '取貨方式：' + emoji + ' ' + deliveryType + '\n' +
        '數量：' + totalBoxes + ' 盒\n' +
        '商品金額：NT$ ' + productAmount + '\n' +
        (deliveryType === '宅配' ? '運費：NT$ ' + shipping + '\n' : '') +
        '總金額：NT$ ' + amt + '\n' +
        (deliveryType === '宅配' ? '地址：' + address + '\n' : '') +
        (note ? '備註：' + note + '\n' : '') +
        '付款：' + (deliveryType === '宅配' ? '⏳ 等待匯款' : '貨到付款');

      // ── 顧客通知（LINE）
      let customerMsg;
      if (deliveryType === '自取') {
        customerMsg =
          '🍊【餘有榮焉 訂單確認】\n' +
          '━━━━━━━━━━━━━━━\n' +
          '📋 訂單編號：' + orderId + '\n' +
          '👤 訂購人：' + actualName + '\n' +
          '📞 電話：' + phone + '\n' +
          '━━━━━━━━━━━━━━━\n' +
          '🛍️ 訂購內容：\n' + specLines + '\n' +
          '━━━━━━━━━━━━━━━\n' +
          '🏪 取貨方式：現場自取\n' +
          '📍 自取地點：' + PICKUP_ADDRESS + '\n' +
          '💰 應付金額：NT$ ' + amt + '（貨到付款）' +
          noteText + '\n' +
          '━━━━━━━━━━━━━━━\n' +
          '感謝訂購！如有問題請直接回覆訊息 🙏';
      } else {
        customerMsg =
          '🚛【餘有榮焉 訂單確認】\n' +
          '━━━━━━━━━━━━━━━\n' +
          '📋 訂單編號：' + orderId + '\n' +
          '👤 訂購人：' + actualName + '\n' +
          '📞 電話：' + phone + '\n' +
          '━━━━━━━━━━━━━━━\n' +
          '🛍️ 訂購內容：\n' + specLines + '\n' +
          '━━━━━━━━━━━━━━━\n' +
          '🚛 取貨方式：新竹貨運宅配\n' +
          '📦 收件地址：' + address + '\n' +
          '💴 商品金額：NT$ ' + productAmount + '\n' +
          '🚛 運費：NT$ ' + shipping + '\n' +
          '💰 應付總金額：NT$ ' + amt +
          noteText + '\n' +
          '━━━━━━━━━━━━━━━\n' +
          '🏦【匯款資訊】\n' +
          '銀行：中國信託（822）\n' +
          '帳號：901 5611 35830\n' +
          '戶名：楊敏\n' +
          '⚠️ 請於訂購後 48 小時內完成匯款\n' +
          '✅ 匯款後請回覆此訊息告知後五碼，將依匯款順序出貨\n' +
          '━━━━━━━━━━━━━━━\n' +
          '感謝訂購！如有問題請直接回覆訊息 🙏';
      }

      await sendTelegram(adminMsg);
      await sendLineToCustomer(req.query.lineUserId || '', customerMsg);

      return res.json({ status: 'success', orderId, totalBoxes, remainStock: newRemain });
    }

    return res.json({ totalStock, soldStock, remainStock, specs });

  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
