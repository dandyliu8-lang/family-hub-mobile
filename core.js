export const SCHEMA=1;
export const CATEGORIES=[
 {id:'salary',label:'家庭税后工资',type:'income',short:'工资'},
 {id:'bonus',label:'税后奖金到账',type:'income',short:'奖金'},
 {id:'equity',label:'本年新增股权变现净额',type:'income',short:'新增股权'},
 {id:'income',label:'其他新增现金收入',type:'income',short:'其他收入'},
 {id:'mortgage',label:'房贷自付部分',type:'expense',short:'房贷'},
 {id:'living',label:'日常生活',type:'expense',short:'生活'},
 {id:'travel',label:'旅行',type:'expense',short:'旅行'},
 {id:'car',label:'车辆',type:'expense',short:'车辆'},
 {id:'other',label:'教育 / 医疗 / 保险等',type:'expense',short:'其他费用'},
 {id:'interest',label:'融资利息及费用',type:'expense',short:'利息'}
];
export const TRANSFERS=[{id:'transfer',label:'家庭账户转账'},{id:'invest',label:'入金 / 买入股票'},{id:'repay',label:'偿还融资本金'},{id:'oldstock',label:'既有股票变现'},{id:'extraMortgage',label:'额外偿还房贷本金'}];
export const DEFAULT_BUDGET={salary:0,mortgage:0,fund:0,living:0,travel:0,car:0,other:0,fixed:0,stretch:0,annual:0,combined:0,reserve:0};
export const BUDGET_FIELDS=[['salary','家庭税后工资 / 月'],['mortgage','房贷总供 / 月'],['fund','公积金抵扣 / 月'],['living','日常生活 / 月'],['travel','旅行 / 年'],['car','车辆 / 年'],['other','教育、保险等及融资利息 / 年'],['fixed','工资固定储蓄目标 / 月'],['stretch','工资争取储蓄目标 / 月'],['annual','工资结余目标 / 年'],['combined','综合积累争取目标 / 年'],['reserve','可用现金储备目标']];
export function initialState(){return {schema:SCHEMA,revision:0,updatedAt:null,budgets:{2027:{...DEFAULT_BUDGET}},transactions:[],months:{},snapshots:[],trips:[],todos:[],preferences:{theme:'system'},imports:[]};}
export const uid=()=>globalThis.crypto.randomUUID();
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export const sum=a=>round(a.reduce((s,n)=>s+n,0));
export function money(v){return v===null||v===undefined?'—':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(v);}
export function budgetFor(s,y){return s.budgets[y]||{...DEFAULT_BUDGET};}
export function budgetTotals(b){const expense=round((Math.max(0,b.mortgage-b.fund)+b.living)*12+b.travel+b.car+b.other);return {income:b.salary*12,expense,saving:round(b.salary*12-expense)};}
export function chinaToday(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function nextReview(date=new Date()){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date),v=Object.fromEntries(p.map(x=>[x.type,x.value]));
 let y=Number(v.year),m=Number(v.month);if(Number(v.day)>5||(Number(v.day)===5&&Number(v.hour)>=20)){m++;if(m===13){y++;m=1;}}
 return {date:`${y}-${String(m).padStart(2,'0')}-05`,month:`${m===1?y-1:y}-${String(m===1?12:m-1).padStart(2,'0')}`};
}
export function monthEnd(month){const [y,m]=month.split('-').map(Number);return `${month}-${new Date(Date.UTC(y,m,0)).getUTCDate()}`;}
export function monthInfo(s,month){
 const stored=s.months[month]||{},mode=stored.mode||'detail';
 const tx=s.transactions.filter(t=>t.date.startsWith(month));
 const amounts=Object.fromEntries(CATEGORIES.map(c=>[c.id,mode==='summary'?(stored.amounts?.[c.id]??null):tx.some(t=>t.category===c.id)?sum(tx.filter(t=>t.category===c.id).map(t=>t.amount)):stored.zeroChecked?0:null]));
 const complete=CATEGORIES.every(c=>Number.isFinite(amounts[c.id]));
 const income=complete?sum(CATEGORIES.filter(c=>c.type==='income').map(c=>amounts[c.id])):null;
 const expense=complete?sum(CATEGORIES.filter(c=>c.type==='expense').map(c=>amounts[c.id])):null;
 return {...stored,mode,amounts,complete,income,expense,saving:complete?round(income-expense):null,salarySaving:complete?round(amounts.salary-expense):null,reviewed:complete&&stored.reviewed===true,transactions:tx};
}
export function annualInfo(s,year){const months=Array.from({length:12},(_,i)=>monthInfo(s,`${year}-${String(i+1).padStart(2,'0')}`)); const reviewed=months.filter(m=>m.reviewed);return {months,count:reviewed.length,saving:reviewed.length?sum(reviewed.map(m=>m.saving)):null,salarySaving:reviewed.length?sum(reviewed.map(m=>m.salarySaving)):null,travel:sum(months.map(m=>m.amounts.travel||0))};}
export function snapshotInfo(s){const financial=!!s&&s.verified===true&&s.netConfirmed===true&&['cash','usNet','otherNet'].every(k=>Number.isFinite(s[k]));const household=financial&&['property','mortgageDebt','otherDebt'].every(k=>Number.isFinite(s[k]));return {financial:financial?sum([s.cash,s.usNet,s.otherNet]):null,reserve:s?.verified&&Number.isFinite(s.cash)&&Number.isFinite(s.reserved)?round(s.cash-s.reserved):null,net:household?round(s.cash+s.usNet+s.otherNet+s.property-s.mortgageDebt-s.otherDebt):null};}
export function invalidate(s,month){s.months[month]={...(s.months[month]||{}),reviewed:false,zeroChecked:false};}
export function addTransaction(s,t){
 validateTransaction(t);const month=t.date.slice(0,7);if(s.months[month]?.mode==='summary')throw new Error('本月使用汇总模式，请先切换为逐笔模式；原汇总会保留但不参与统计。');
 if(s.transactions.some(x=>x.id===t.id))return false;s.transactions.push(t);invalidate(s,month);return true;
}
export function validateTransaction(t){if(!t||typeof t.id!=='string'||!validDate(t.date)||!Number.isFinite(t.amount)||t.amount<=0||t.amount>1e12||!CATEGORIES.concat(TRANSFERS).some(c=>c.id===t.category)||typeof t.note!=='string'||t.note.length>2000)throw new Error('流水日期、分类或金额不合法；金额须大于 0，最多两位小数。');if(round(t.amount)!==t.amount)throw new Error('金额最多保留两位小数。');}
export function validDate(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;}
export function validateState(s){
 if(!s||s.schema!==SCHEMA||!Array.isArray(s.transactions)||!Array.isArray(s.snapshots)||!Array.isArray(s.trips)||!Array.isArray(s.todos)||!s.budgets||!s.months||!s.preferences)throw new Error('不是可识别的 Family Hub v1 备份。');
 if(s.transactions.length>100000)throw new Error('记录超过上限。');
 s.transactions.forEach(validateTransaction);
 for(const [y,b] of Object.entries(s.budgets)){if(!/^\d{4}$/.test(y))throw new Error('预算年份不合法。');for(const [k] of BUDGET_FIELDS)if(!Number.isFinite(b[k])||b[k]<0||b[k]>1e12)throw new Error('预算金额不合法。');}
 for(const [m,v] of Object.entries(s.months)){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)||!['detail','summary'].includes(v.mode||'detail'))throw new Error('月度数据不合法。');
  for(const n of Object.values(v.allocations||{}))if(n!==null&&(!Number.isFinite(n)||n<0||n>1e12))throw new Error('结余去向金额不合法。');for(const n of Object.values(v.amounts||{}))if(n!==null&&(!Number.isFinite(n)||n<0||n>1e12))throw new Error('月度金额不合法。');
 }
 for(const v of s.snapshots){if(!validDate(v.date)||typeof v.id!=='string')throw new Error('快照日期不合法。');for(const k of ['cash','reserved','usNet','otherNet','financing','property','mortgageDebt','otherDebt','pnl'])if(v[k]!==null&&v[k]!==undefined&&(!Number.isFinite(v[k])||Math.abs(v[k])>1e12))throw new Error('快照金额不合法。');if(['cash','reserved','financing','property','mortgageDebt','otherDebt'].some(k=>(v[k]??0)<0))throw new Error('现金、融资或非证券资产负债不能为负。');if((v.cash??0)<0||(v.reserved??0)<0||(v.reserved??0)>(v.cash??Infinity))throw new Error('现金或专用现金不合法。');}
 for(const v of s.trips)if(typeof v.name!=='string'||typeof v.id!=='string'||!Number.isFinite(v.budget)||v.budget<0||v.budget>1e12||!/^\d{4}$/.test(String(v.year)))throw new Error('旅行计划不合法。');
 for(const v of s.todos)if(typeof v.id!=='string'||typeof v.text!=='string'||(v.due&&!validDate(v.due)))throw new Error('待办不合法。');
 for(const list of [s.transactions,s.snapshots,s.trips,s.todos])if(new Set(list.map(t=>t.id)).size!==list.length)throw new Error('备份含重复标识。');
 return s;
}
export function csvString(rows){return '\uFEFF'+rows.map(row=>row.map(v=>{let text=String(v??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
export function parseCSV(text){text=text.replace(/^\uFEFF/,'');let rows=[],row=[],value='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(!quoted&&value==='')quoted=true;else if(quoted)quoted=false;else throw new Error('CSV 引号格式有误。');}else if(c===','&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(Boolean))rows.push(row);row=[];value='';}else value+=c;}if(quoted)throw new Error('CSV 引号未闭合。');if(value||row.length){row.push(value);rows.push(row);}return rows;}
export function transactionsCSV(s){return csvString([['id','日期','分类','金额','备注','旅行ID'],...s.transactions.map(t=>[t.id,t.date,CATEGORIES.concat(TRANSFERS).find(c=>c.id===t.category).label,t.amount,t.note,t.tripId||''])]);}
export async function csvTransactions(text){const rows=parseCSV(text),header=rows.shift();if(!header||!['日期','分类','金额'].every(h=>header.includes(h)))throw new Error('CSV 需要列：日期、分类、金额，可选 id、备注、旅行ID。');const ix=h=>header.indexOf(h);return Promise.all(rows.map(async(row,i)=>{const raw=Object.fromEntries(header.map((h,j)=>[h,row[j]||'']));const c=CATEGORIES.concat(TRANSFERS).find(c=>c.label===raw.分类||c.id===raw.分类);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(raw)));const id=raw.id||'csv-'+[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');const t={id,date:raw.日期,category:c?.id,amount:Number(raw.金额),note:(raw.备注||'').replace(/^'(?=[=+@\-\t\r])/,'').slice(0,2000),tripId:raw.旅行ID||''};try{validateTransaction(t);}catch(e){throw new Error(`第 ${i+2} 行：${e.message}`);}return t;}));}
export function applyCSV(s,transactions){const candidate=structuredClone(s),seen=new Set(candidate.transactions.map(t=>t.id));let added=0,duplicates=0;for(const t of transactions){if(seen.has(t.id)){const old=candidate.transactions.find(x=>x.id===t.id);if(old&&JSON.stringify([old.date,old.category,old.amount,old.note,old.tripId||''])!==JSON.stringify([t.date,t.category,t.amount,t.note,t.tripId||'']))throw new Error('同一流水 ID 的内容有变化，请先在应用中核对；未导入任何记录。');duplicates++;continue;}addTransaction(candidate,t);seen.add(t.id);added++;}return {candidate,added,duplicates};}
