
/** 餘有榮焉訂單 API：與 admin.html 配套，部署前須完成整合測試。 */
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '1ZQrN--Rp703JXXXfBJECKE5L_z2Td2ZvompWXVD7K5c';
const ORIGIN = process.env.ALLOWED_ORIGIN || 'https://michelleyang586-png.github.io';
const DEFAULTS = Object.freeze({ price:400, boxesPerPiece:4, shippingPerPiece:150, pickupShipping:0 });
const TABS = Object.freeze({orders:'訂單總表',details:'配送明細',payments:'收款紀錄',settings:'系統設定'});
const header = (res) => {res.setHeader('Access-Control-Allow-Origin',ORIGIN);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Admin-Password, X-Admin-Session');res.setHeader('Cache-Control','no-store');};
const send = (res,code,obj) => res.status(code).json(obj);
const safeStr = (v,max=150) => typeof v==='string' ? v.trim().slice(0,max) : '';
const positiveInt = v => Number.isSafeInteger(Number(v)) && Number(v)>0 && Number(v)<=10000 ? Number(v) : null;
const numeric = v => Number.isFinite(Number(v)) && Number(v)>=0 ? Number(v) : null;
const nowTW = () => new Date().toLocaleString('sv-SE',{timeZone:'Asia/Taipei'}).replace(' ','T');
function calculate(lines,settings=DEFAULTS){
  if(!Array.isArray(lines)||lines.length<1||lines.length>30) throw new Error('配送明細需有 1 至 30 筆');
  const normalized = lines.map((line,i)=>{
    const type=safeStr(line.type,8), qty=positiveInt(line.qty);
    if(!['自取','宅配'].includes(type)||!qty) throw new Error(`第 ${i+1} 筆配送方式或盒數不正確`);
    const name=safeStr(line.name,60),phone=safeStr(line.phone,30),address=safeStr(line.address,200);
    if(type==='宅配'&&(!name||!phone||!address)) throw new Error(`第 ${i+1} 筆收件資訊不完整`);
    const pieces=type==='宅配'?Math.ceil(qty/settings.boxesPerPiece):0;
    const shipping=type==='宅配'?pieces*settings.shippingPerPiece:settings.pickupShipping;
    return {type,qty,name,phone,address:type==='宅配'?address:'',pieces,shipping,goods:qty*settings.price,note:safeStr(line.note,300),requestedDate:safeStr(line.requestedDate,20),requestedTime:safeStr(line.requestedTime,40)};
  });
  const boxes=normalized.reduce((s,x)=>s+x.qty,0), goods=normalized.reduce((s,x)=>s+x.goods,0), shipping=normalized.reduce((s,x)=>s+x.shipping,0);
  return {lines:normalized,boxes,goods,shipping,total:goods+shipping};
}
async function accessToken(){
  const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
  if(!email||!key) throw new Error('缺少 Google 服務帳號環境變數');
  const {createSign}=require('node:crypto'), t=Math.floor(Date.now()/1000);
  const a=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const b=Buffer.from(JSON.stringify({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:t,exp:t+3600})).toString('base64url');
  const s=createSign('RSA-SHA256');s.update(`${a}.${b}`);
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${a}.${b}.${s.sign(key,'base64url')}`})});
  const d=await r.json();if(!r.ok||!d.access_token)throw new Error('Google 授權失敗');return d.access_token;
}
async function sheets(token,path,method='GET',body){
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path.startsWith(':') || path.startsWith('?') ? '' : '/'}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const d=await r.json();if(!r.ok)throw new Error(`Google Sheets ${r.status}: ${JSON.stringify(d).slice(0,250)}`);return d;
}
const range = (s) => `values/${encodeURIComponent(s)}`;
const read = async (t,s) => (await sheets(t,range(s))).values||[];
async function append(t,tab,rows){return sheets(t,`${range(`${tab}!A:Z`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,'POST',{values:rows});}
async function settings(t){
  const rows=await read(t,`${TABS.settings}!A1:B20`),map=Object.fromEntries(rows.slice(1).map(r=>[r[0],r[1]]));
  const price=positiveInt(map['砂糖橘每盒售價']),boxesPerPiece=positiveInt(map['每件最多盒數']);
  const shippingPerPiece=numeric(map['每件宅配運費']),pickupShipping=numeric(map['自取運費']);
  if(!price||!boxesPerPiece||shippingPerPiece===null||pickupShipping===null) throw new Error('系統設定內容不完整，請檢查 A1:B5');
  return {price,boxesPerPiece,shippingPerPiece,pickupShipping};
}
// 管理動作依「配送編號」定位，不依試算表列號，避免排序後誤改他人訂單。
const sheetCol=(n)=>{let x=n+1,s='';while(x){x--;s=String.fromCharCode(65+x%26)+s;x=Math.floor(x/26)}return s};
async function updateCells(t,updates){
  if(!updates.length)return;
  return sheets(t,'values:batchUpdate','POST',{valueInputOption:'RAW',data:updates.map(x=>({range:`'${x.tab}'!${sheetCol(x.col)}${x.row}`,values:[[x.value]]}))});
}
const httpError=(message,status=400)=>Object.assign(new Error(message),{status});
const isoDate=(v)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'));
async function manageDelivery(t,body){
  const detailId=safeStr(body.detailId,80),operation=body.action;
  if(!detailId)throw httpError('缺少配送編號');
  const [details,payments,orders]=await Promise.all([read(t,'配送明細!A2:S'),read(t,'收款紀錄!A2:L'),read(t,'訂單總表!A2:U')]);
  const i=details.findIndex(r=>r[0]===detailId);
  if(i<0)throw httpError('找不到此配送明細',404);
  const d=details[i],row=i+2,orderId=d[1],payIndex=payments.findIndex(r=>r[2]===detailId);
  const ts=nowTW(),changes=[];
  const change=(tab,r,c,v)=>changes.push({tab,row:r,col:c,value:v});
  let result={detailId,orderId};
  if(operation==='setShipDate'){
    if(d[13]==='已出貨')throw httpError('已出貨的配送明細不可修改日期');
    const date=safeStr(body.shipDate,10);
    if(date&&!isoDate(date))throw httpError('出貨日期格式錯誤');
    change(TABS.details,row,11,date);change(TABS.details,row,13,date?'待出貨':'待安排');
    change(TABS.details,row,18,ts);result.shipDate=date;
  }else if(operation==='markPaid'){
    if(payIndex<0)throw httpError('找不到此配送的收款紀錄，請先人工核對');
    const p=payments[payIndex],pr=payIndex+2,due=Number(p[4]),oldPaid=Number(p[6]||0);
    if(!Number.isFinite(due)||due<0||!Number.isFinite(oldPaid))throw httpError('收款金額資料不正確');
    const paid=body.paid===true?due:body.paid===false?0:null;
    if(paid===null)throw httpError('收款狀態必須指定 true 或 false');
    if(body.paid===false&&d[13]==='已出貨'&&d[4]==='宅配')throw httpError('宅配已出貨，不可直接取消收款，請先核對');
    change(TABS.payments,pr,6,paid);change(TABS.payments,pr,7,paid===due?'已收款':'待收款');
    change(TABS.payments,pr,9,paid===due?ts:'');change(TABS.payments,pr,11,ts);
    result.paid=paid;result.due=due;
  }else if(operation==='markShipped'){
    if(typeof body.shipped!=='boolean')throw httpError('出貨狀態必須指定 true 或 false');
    if(body.shipped){
      if(!d[11])throw httpError('請先安排出貨日期');
      if(d[4]==='宅配'){
        if(payIndex<0)throw httpError('宅配缺少收款紀錄，禁止出貨');
        const p=payments[payIndex];
        if(Number(p[6]||0)<Number(p[4]||0))throw httpError('宅配尚未全額收款，禁止標記出貨');
      }
    }
    change(TABS.details,row,12,body.shipped?ts.slice(0,10):'');
    change(TABS.details,row,13,body.shipped?'已出貨':d[11]?'待出貨':'待安排');
    change(TABS.details,row,18,ts);result.shipped=body.shipped;
  }else throw httpError('不支援的管理操作',404);
  // 先更新目標資料，成功後再同步訂單總表的摘要欄位。
  await updateCells(t,changes);
  const oi=orders.findIndex(r=>r[0]===orderId);
  if(oi>=0){
    const orderRow=oi+2;
    const all=details.filter(r=>r[1]===orderId);
    if(operation==='markShipped')d[13]=body.shipped?'已出貨':d[11]?'待出貨':'待安排';
    if(operation==='setShipDate'){d[11]=result.shipDate;d[13]=result.shipDate?'待出貨':'待安排'}
    if(operation==='markPaid')payments[payIndex][6]=result.paid;
    const related=payments.filter(r=>r[1]===orderId);
    const due=related.reduce((s,r)=>s+Number(r[4]||0),0),paid=related.reduce((s,r)=>s+Number(r[6]||0),0);
    const payStatus=paid>=due?'已收款':paid>0?'部分收款':'待收款';
    const shipStatus=all.every(r=>r[13]==='已出貨')?'已完成':all.some(r=>r[13]==='已出貨')?'部分出貨':all.every(r=>r[11])?'已安排':'待安排';
    try{await updateCells(t,[{tab:TABS.orders,row:orderRow,col:12,value:payStatus},{tab:TABS.orders,row:orderRow,col:15,value:shipStatus},{tab:TABS.orders,row:orderRow,col:18,value:ts}]);}
    catch(e){throw httpError('配送/收款明細已更新，但訂單總表摘要同步失敗，請重新整理並人工核對：'+e.message,503)}
  }
  return result;
}
// LINE access token 必須由 LINE 官方 verify API 驗證，絕不相信前端自行傳來的 userId。
async function verifiedLineUser(req){
  const token=(req.headers.authorization||'').match(/^Bearer (.+)$/i)?.[1];
  if(!token)throw Object.assign(new Error('需要 LINE 登入'),{status:401});
  const channel=process.env.LINE_LOGIN_CHANNEL_ID||'2009767596';
  const vr=await fetch('https://api.line.me/oauth2/v2.1/verify?access_token='+encodeURIComponent(token));
  if(!vr.ok)throw httpError('LINE 登入已失效',401);
  const v=await vr.json();
  if(String(v.client_id)!==String(channel))throw httpError('LINE 登入來源不正確',401);
  const r=await fetch('https://api.line.me/v2/profile',{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok)throw httpError('LINE 無法取得使用者資訊',401);
  const p=await r.json();if(!p.userId)throw httpError('LINE 驗證失敗',401);return p;
}
async function requireAdmin(req) {
  const sessionToken = req.headers['x-admin-session'];

  if (typeof sessionToken === 'string' && sessionToken) {
  const session = verifyAdminSession(sessionToken);
  const user = await verifiedLineUser(req);

  if (session.lineUserId !== user.userId) {
    throw httpError('管理員 LINE 身分不符，請重新登入', 401);
  }

  return session;
}

  const expected = process.env.ADMIN_PASSWORD;
  const supplied = req.headers['x-admin-password'];

  if (!expected) {
    throw httpError('尚未設定管理員密碼', 503);
  }

  if(typeof supplied!=='string'||supplied!==expected)
  throw httpError('管理員密碼不正確',401);

const user = await verifiedLineUser(req);

return {
  role: 'admin',
  userId: user.userId,
  displayName: user.displayName,
  lineUserId: user.userId
};
}

const crypto = require('node:crypto');

const ADMIN_SESSION_SECONDS = 7 * 24 * 60 * 60;

function createAdminSession(lineUserId) {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;

  const payload = Buffer.from(JSON.stringify({
    uid: lineUserId,
    exp: expires
  })).toString('base64url');

  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret) {
    throw httpError('尚未設定管理員登入金鑰', 503);
  }

  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return {
    token: `${payload}.${signature}`,
    expires
  };
}

function verifyAdminSession(token) {
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret || typeof token !== 'string') {
    throw httpError('管理員登入已失效，請重新登入', 401);
  }

  const parts = token.split('.');

  if (parts.length !== 2) {
    throw httpError('管理員登入憑證無效', 401);
  }

  const [payload, signature] = parts;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest();

  let supplied;

  try {
    supplied = Buffer.from(signature, 'base64url');
  } catch {
    throw httpError('管理員登入憑證無效', 401);
  }

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    throw httpError('管理員登入憑證無效', 401);
  }

  let data;

  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw httpError('管理員登入憑證無效', 401);
  }

  if (
    typeof data.uid !== 'string' ||
    !data.uid ||
    !Number.isSafeInteger(data.exp) ||
    data.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw httpError('管理員登入已過期，請重新登入', 401);
  }

  return { role: 'admin', lineUserId: data.uid };
}
function id(prefix){return `${prefix}${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${require('node:crypto').randomBytes(5).toString('hex').toUpperCase()}`;}
function buildRows(payload,calc,source,lineUser){
  const ts=nowTW(),oid=id('SO'),buyer=safeStr(payload.buyerName,60),phone=safeStr(payload.buyerPhone,30);
  if(!buyer||!phone)throw new Error('訂購人姓名與電話不可空白');
const order = [
  oid, ts, source,
  source === 'LINE' ? (lineUser?.displayName || '') : '',
  source === 'LINE' ? (lineUser?.userId || '') : '',
  buyer, phone, calc.boxes, calc.goods, calc.shipping, calc.total,
  '分項收款', '待收款', '', '', '待安排',
  safeStr(payload.note, 500), '', ts,
  source === '後台手動輸入' ? (lineUser?.userId || '') : '',
  source === '後台手動輸入' ? (lineUser?.displayName || '') : ''
];

const details = [], payments = [];
  for(const line of calc.lines){
    const did=id('DL'),payid=id('PY'),due=line.goods+line.shipping;
    details.push([did,oid,line.name,line.phone,line.type,line.address,'砂糖橘 5台斤／盒',line.qty,line.pieces,line.type==='宅配'?line.pieces?line.shipping/line.pieces:0:0,line.shipping,'','','待安排','',line.requestedDate,line.requestedTime,line.note,ts]);
    payments.push([payid,oid,did,line.type==='宅配'?'宅配預付':'自取貨款',due,line.type==='宅配'?'銀行轉帳':'現場付款或銀行轉帳',0,'待收款','','','',ts]);
  }
  return {oid,order,details,payments};
}
// 注意：Sheets 跨分頁寫入不是交易；出錯時回傳「待人工核對」，避免誤報完成。
async function createOrder(t,payload,source,user){
  const config=await settings(t),calc=calculate(payload.deliveries,config);
  const rows=buildRows(payload,calc,source,user);
  // 一次提交三張表的新增列，避免分開呼叫造成部分寫入。
  // appendCells 的 sheetId 由工作表 metadata 查得，不依賴分頁順序。
  const meta=await sheets(t,'?fields=sheets(properties(sheetId,title))');
  const ids=Object.fromEntries((meta.sheets||[]).map(s=>[s.properties.title,s.properties.sheetId]));
  const requests=[[TABS.orders,[rows.order]],[TABS.details,rows.details],[TABS.payments,rows.payments]].map(([tab,values])=>{
    if(ids[tab]===undefined)throw httpError(`找不到工作表：${tab}`,500);
    return {appendCells:{sheetId:ids[tab],rows:values.map(row=>({values:row.map(value=>({userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:String(value??'')}}))})),fields:'userEnteredValue'}};
  });
  try{await sheets(t,':batchUpdate','POST',{requests});}
  catch(e){throw httpError(`訂單 ${rows.oid} 寫入結果不明，請先人工核對，不要重複送單：${e.message}`,503);}
  return {orderId:rows.oid,boxes:calc.boxes,goods:calc.goods,shipping:calc.shipping,total:calc.total};
}
module.exports = async function handler(req, res) {
  header(res);if(req.method==='OPTIONS')return res.status(204).end();
  try{
    const action=req.method==='GET'?req.query?.action:req.body?.action;
    if (req.method === 'POST' && action === 'adminLogin') {
  const user = await requireAdmin(req);
  const session = createAdminSession(user.userId);

  return send(res, 200, {
    status: 'success',
    token: session.token,
    expires: session.expires,
    lineUserId: user.userId,
    lineName: user.displayName
  });
}
    if(req.method==='GET'&&action==='settings'){const t=await accessToken();return send(res,200,{status:'success',settings:await settings(t)});}
    if(req.method==='POST'&&action==='createOrder'){
      // 客戶端必須提供有效 LINE token；管理員電話訂單需同時通過管理員授權。
      const source = req.body?.source === '後台手動輸入'
  ? '後台手動輸入'
  : 'LINE';

let user = null;

if (source === '後台手動輸入') {
  await requireAdmin(req);
  user = await verifiedLineUser(req);
} else {
  user = await verifiedLineUser(req);
}
      const t=await accessToken(),result=await createOrder(t,req.body,source,user);
      return send(res,201,{status:'success',...result});
    }
    if(req.method==='GET'&&action==='getOrders'){
      await requireAdmin(req);const t=await accessToken();
      const [orders,details,payments]=await Promise.all([read(t,'訂單總表!A2:U'),read(t,'配送明細!A2:S'),read(t,'收款紀錄!A2:L')]);
      return send(res,200,{status:'success',orders,details,payments,settings:await settings(t)});
    }
    if(req.method==='POST'&&['setShipDate','markPaid','markShipped'].includes(action)){
      await requireAdmin(req);const t=await accessToken();
      const result=await manageDelivery(t,req.body||{});
      return send(res,200,{status:'success',...result});
    }
    return send(res,404,{status:'error',message:'此版本尚未提供該功能'});
  }catch(e){return send(res,e.status||((/不正確|不完整|不可空白|需有/.test(e.message))?400:500),{status:'error',message:e.message});}
};
