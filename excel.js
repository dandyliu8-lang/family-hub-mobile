import {stripSyncSecrets} from './sync-model.js';
import {CATEGORIES,TRANSFERS,DEFAULT_BUDGET,BUDGET_FIELDS,monthInfo,monthEnd,initialState,validateState} from './core.js';
const rowMap={salary:11,bonus:12,equity:13,income:14,mortgage:17,living:18,travel:19,car:20,other:21,interest:22};
const budgetMap={salary:8,mortgage:9,fund:10,living:12,travel:13,car:14,other:15,fixed:16,stretch:17,combined:19,reserve:20};
const numeric=(ws,addr)=>{const v=ws?.[addr]?.v;return typeof v==='number'&&Number.isFinite(v)?v:null;};
const cell=(ws,addr)=>ws?.[addr]?.v??'';
function fingerprint(wb){let h=2166136261;const data=wb.SheetNames.filter(n=>n!=='FamilyHub备份').map(n=>[n,Object.keys(wb.Sheets[n]).filter(a=>!a.startsWith('!')&&wb.Sheets[n][a].v!==undefined).sort().map(a=>[a,wb.Sheets[n][a].v,wb.Sheets[n][a].f||''])]);for(const c of JSON.stringify(data)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function lib(){if(!globalThis.XLSX)throw new Error('Excel 组件未载入，请刷新或使用 CSV。');return globalThis.XLSX;}
export function readWorkbook(bytes){
 const X=lib(),wb=X.read(bytes,{type:'array',cellDates:false});
 if(wb.Sheets['FamilyHub备份']){const expected=cell(wb.Sheets['FamilyHub备份'],'B1');if(!expected||String(expected)!==fingerprint(wb))throw new Error('导出报告的可见表格已被编辑，不能按完整快照恢复。请用原版三工作表或 CSV 导入编辑后的记录，避免忽略改动。');const chunks=X.utils.sheet_to_json(wb.Sheets['FamilyHub备份'],{header:1}).map(r=>r[0]||'');try{return {kind:'backup',state:validateState(JSON.parse(chunks.join(''))),description:'Family Hub 完整备份（包含所有年份）'};}catch{throw new Error('工作台备份页损坏，未导入。');}}
 if(!['预算设置','月度收支','资产与复盘'].every(n=>wb.Sheets[n]))throw new Error('请使用原版三工作表，或本应用导出的 Excel。逐笔数据请用 CSV。');
 const settings=wb.Sheets['预算设置'],monthly=wb.Sheets['月度收支'],assets=wb.Sheets['资产与复盘'];
 if(cell(settings,'B8')!=='家庭税后工资'||cell(monthly,'B11')!=='家庭税后工资'||cell(assets,'C7')!=='现金及存款')throw new Error('工作表布局已变化，无法安全自动映射，请用 CSV 或恢复原版布局。');
 const year=numeric(settings,'C7');if(!year||year<2000||year>2100)throw new Error('预算设置 C7 的年份不合法。');
 const budget={...DEFAULT_BUDGET};for(const [k,r] of Object.entries(budgetMap)){const n=numeric(settings,'C'+r);if(n!==null)budget[k]=n;}budget.annual=budget.stretch*12;
 const months={},snapshots=[];
 for(let i=0;i<12;i++){const col=X.utils.encode_col(5+i),m=`${year}-${String(i+1).padStart(2,'0')}`,amounts=Object.fromEntries(Object.entries(rowMap).map(([k,r])=>[k,numeric(monthly,col+r)]));if(Object.values(amounts).some(v=>v!==null)){months[m]={mode:'summary',amounts,reviewed:cell(monthly,col+'8')==='已核对'&&m<=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).slice(0,7),allocations:{savings:numeric(monthly,col+'34'),repay:numeric(monthly,col+'35'),invest:numeric(monthly,col+'36'),mortgage:numeric(monthly,col+'37')},note:'',action:''};}}
 for(let i=0;i<13;i++){const r=i+8,date=i===0?`${year-1}-12-31`:monthEnd(`${year}-${String(i).padStart(2,'0')}`);const s={id:'legacy-'+date,date,cash:numeric(assets,'C'+r),reserved:numeric(assets,'D'+r),usNet:numeric(assets,'F'+r),otherNet:numeric(assets,'G'+r),financing:numeric(assets,'I'+r),pnl:numeric(assets,'L'+r),property:null,mortgageDebt:null,otherDebt:null,verified:false,netConfirmed:false,note:String(cell(assets,'M'+r)),action:String(cell(assets,'N'+r))};if(['cash','reserved','usNet','otherNet','financing','pnl'].some(k=>s[k]!==null)||s.note||s.action)snapshots.push(s);}
 const test=initialState();test.budgets={[year]:budget};test.months=months;test.snapshots=snapshots;validateState(test);
 return {kind:'legacy',year,budget,months,snapshots,description:`${year} 年预算、${Object.keys(months).length} 个月收支、${snapshots.length} 份资产记录；资产需在应用内复核`};
}
export function applyLegacy(s,p){
 const candidate=structuredClone(s);for(const m of Object.keys(p.months)){const existing=candidate.months[m];if(existing||candidate.transactions.some(t=>t.date.startsWith(m))){const same=existing?.mode==='summary'&&JSON.stringify(Object.entries(p.months[m].amounts).sort())===JSON.stringify(Object.entries(existing.amounts||{}).sort())&&JSON.stringify(p.months[m].allocations||{})===JSON.stringify(existing.allocations||{})&&p.months[m].reviewed===existing.reviewed;if(!same)throw new Error(`${m} 已有不同记录；为避免覆盖或重复累计，整次导入已停止。`);}}
 for(const v of p.snapshots){const existing=candidate.snapshots.find(x=>x.date===v.date);if(existing&&!['cash','reserved','usNet','otherNet','financing','pnl','note','action'].every(k=>(existing[k]??null)===(v[k]??null)))throw new Error('已有不同的同日快照，导入已停止，请先核对。');}
 candidate.budgets[p.year]=structuredClone(p.budget);for(const [m,v] of Object.entries(p.months))if(!candidate.months[m])candidate.months[m]=structuredClone(v);candidate.snapshots.push(...structuredClone(p.snapshots.filter(v=>!candidate.snapshots.some(x=>x.date===v.date))));validateState(candidate);return candidate;
}
export function exportWorkbook(s,year){
 s=stripSyncSecrets(s);
 const X=lib(),wb=X.utils.book_new(),b=s.budgets[year]||DEFAULT_BUDGET;
 const rows=[['Family Hub · 月度收支',year],['金额：人民币元；空白为未知，0 为已确认无发生'],['月份','模式','复盘确认',...CATEGORIES.map(c=>c.label),'新增现金结余','工资结余','本月事项','下月行动','转储蓄','融资还本','新增投资','额外房贷还本']];
 for(let i=1;i<=12;i++){const month=`${year}-${String(i).padStart(2,'0')}`,m=monthInfo(s,month);rows.push([month,m.mode==='detail'?'逐笔':'汇总',m.reviewed?'已核对':'待核对',...CATEGORIES.map(c=>m.amounts[c.id]),m.saving,m.salarySaving,m.note||'',m.action||'',m.allocations?.savings??null,m.allocations?.repay??null,m.allocations?.invest??null,m.allocations?.mortgage??null]);}
 const snap=[['日期','现金及存款','其中已有用途','美股账户净权益','其他投资净值','融资余额（备查）','房产估值','房贷余额','其他负债','投资净盈亏','余额已核实','证券已扣融资','主要事项','下月行动'],...s.snapshots.map(v=>[v.date,v.cash,v.reserved,v.usNet,v.otherNet,v.financing,v.property,v.mortgageDebt,v.otherDebt,v.pnl,v.verified?'是':'否',v.netConfirmed?'是':'否',v.note||'',v.action||''])];
 const tx=[['id','日期','分类','金额','备注','旅行ID'],...s.transactions.map(t=>[t.id,t.date,CATEGORIES.concat(TRANSFERS).find(c=>c.id===t.category)?.label,t.amount,t.note,t.tripId||''])];
 for(const [name,data] of [['月度收支',rows],['资产与复盘',snap],['预算设置',[['年份',year],...BUDGET_FIELDS.map(([k,label])=>[label,b[k]])]],['流水',tx],['旅行',[['id','年份','名称','计划预算','备注'],...s.trips.map(t=>[t.id,t.year,t.name,t.budget,t.note||''])]]]){const ws=X.utils.aoa_to_sheet(data);ws['!cols']=Array.from({length:Math.max(...data.map(r=>r.length))},(_,i)=>({wch:i===0?24:20}));X.utils.book_append_sheet(wb,ws,name);}
 X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['家庭工作台 Excel 导出说明'],['可见工作表为只读报告，FamilyHub备份页用于原样完整恢复。'],['修改可见报告后，应用将拒绝恢复，避免静默忽略改动。'],['继续编辑历史文件请使用原版2027三工作表，或使用CSV逐笔导入。'],['本文件包含全部年份的完整明文备份，请妥善保管。']]),'使用说明');const hash=fingerprint(wb);const json=JSON.stringify(s),chunks=[];for(let i=0;i<json.length;i+=20000)chunks.push([json.slice(i,i+20000)]);chunks[0][1]=hash;X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(chunks),'FamilyHub备份');
 X.writeFile(wb,`家庭工作台-${year}.xlsx`,{compression:true});
}
