import {initialState,validateState,invalidate} from './core.js';

// Encrypted snapshots contain a multi-value register per record. Observed edits
// replace ancestors; concurrent edits stay visible until the user resolves them.
export const SHARED_FIELDS=['budgets','months','transactions','snapshots','trips','todos','references'];
const MAPS=['budgets','months'],LISTS=['transactions','snapshots','trips','todos'];
export function canonical(v){if(v===undefined)return 'undefined';if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
export const equal=(a,b)=>canonical(a)===canonical(b);
export function sharedData(s){const out={};for(const k of SHARED_FIELDS)if(s[k]!==undefined)out[k]=structuredClone(s[k]);return out;}
export function emptyShared(){return {budgets:{},months:{},transactions:[],snapshots:[],trips:[],todos:[]};}
export function initialShared(s){const out=sharedData(s);for(const [y,b] of Object.entries(out.budgets))if(Object.values(b).every(v=>v===0))delete out.budgets[y];return out;}
export const emptyDoc=()=>({format:'family-hub-crdt-v1',clock:{},registers:{}});
const path=(group,key)=>group+'/'+encodeURIComponent(key);
export function flatten(s){const out={};for(const g of MAPS)for(const [k,v]of Object.entries(s[g]||{}))out[path(g,k)]=v;for(const g of LISTS)for(const v of s[g]||[])out[path(g,g==='snapshots'?v.date:v.id)]=v;if(s.references!==undefined)out.references=s.references;return out;}
export function covers(a,b){return Object.keys(b).every(k=>(a[k]||0)>=b[k]);}
export function dominates(a,b){return covers(a,b)&&Object.keys(a).some(k=>a[k]>(b[k]||0));}
function mergeClock(a,b){const out={...a};for(const [k,v]of Object.entries(b))out[k]=Math.max(out[k]||0,v);return out;}
function compact(versions){const entries=Object.entries(versions);return Object.fromEntries(entries.filter(([id,v])=>!entries.some(([other,w])=>other!==id&&dominates(w.clock,v.clock))));}
export function validateDoc(d){
 if(!d||d.format!=='family-hub-crdt-v1'||!d.clock||!d.registers||Object.keys(d.registers).length>25000||Object.keys(d.clock).length>100)throw Error('云端版本格式或数量不合法。');
 const clock=c=>{for(const [k,v]of Object.entries(c))if(['__proto__','constructor','prototype'].includes(k)||!/^[a-zA-Z0-9_-]{8,80}$/.test(k)||!Number.isSafeInteger(v)||v<0)throw Error('云端版本时钟不合法。');};clock(d.clock);
 for(const [p,versions]of Object.entries(d.registers)){
  if(p!=='references'&&!/^(budgets|months|transactions|snapshots|trips|todos)\/[^/]{1,500}$/.test(p))throw Error('云端记录类型不合法。');
  const [group,encoded]=p.split('/');const mapKey=encoded?decodeURIComponent(encoded):'';if(group==='snapshots'&&!/^\d{4}-\d{2}-\d{2}$/.test(mapKey))throw Error('快照日期标识不合法。');if(group==='budgets'&&!/^\d{4}$/.test(mapKey)||group==='months'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(mapKey))throw Error('云端年月标识不合法。');
  if(!versions||Object.keys(versions).length>100)throw Error('云端并发版本过多。');
  for(const [id,v]of Object.entries(versions)){if(!/^[a-zA-Z0-9:_-]{8,200}$/.test(id)||!v||typeof v.deleted!=='boolean'||!v.clock)throw Error('云端记录版本不合法。');clock(v.clock);if(!covers(d.clock,v.clock))throw Error('云端版本时钟不完整。');}
 }return d;
}
export function changeDoc(doc,before,after,device){
 validateDoc(doc);const old=flatten(before),next=flatten(after),changes=[...new Set([...Object.keys(old),...Object.keys(next)])].filter(p=>!equal(old[p],next[p]));
 if(!changes.length)return structuredClone(doc);
 const result=structuredClone(doc),seq=(result.clock[device]||0)+1;result.clock[device]=seq;
 const id=device+':'+seq+':'+crypto.randomUUID();
 for(const p of changes)result.registers[p]={[id]:{clock:{...result.clock},deleted:next[p]===undefined,value:structuredClone(next[p]===undefined?old[p]:next[p])}};
 return result;
}
export function mergeDocs(...docs){const result=emptyDoc();for(const d of docs){validateDoc(d);result.clock=mergeClock(result.clock,d.clock);for(const [p,versions]of Object.entries(d.registers)){const all={...(result.registers[p]||{})};for(const [id,v]of Object.entries(versions)){if(all[id]&&!equal(all[id],v))throw Error('云端出现重复但内容不同的版本，已停止同步。');all[id]=structuredClone(v);}result.registers[p]=compact(all);}}return result;}
export function conflicts(doc){return Object.entries(doc.registers).filter(([,vs])=>new Set(Object.values(vs).map(v=>canonical([v.deleted,v.value]))).size>1).map(([path,versions])=>({path,versions:Object.entries(versions).map(([id,v])=>({id,...v}))}));}
export function materialize(doc){
 validateDoc(doc);if(conflicts(doc).length)throw Error('有并发修改需要先选择，未覆盖本机记录。');const data=emptyShared();
 for(const [p,versions]of Object.entries(doc.registers)){const v=Object.values(versions)[0];if(!v||v.deleted)continue;if(p==='references'){data.references=structuredClone(v.value);continue;}const [g,encoded]=p.split('/'),key=decodeURIComponent(encoded);if(MAPS.includes(g))data[g][key]=structuredClone(v.value);else{if((g==='snapshots'?v.value?.date:v.value?.id)!==key)throw Error('云端记录标识不一致。');data[g].push(structuredClone(v.value));}}
 for(const g of LISTS)data[g].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const checked=initialState();applyShared(checked,data);validateState(checked);
 if(new Set(data.snapshots.map(s=>s.date)).size!==data.snapshots.length)throw Error('合并后有同日资产快照，请先在设备中核对，未覆盖本机记录。');return data;
}
export function applyShared(state,data){for(const k of SHARED_FIELDS){if(data[k]===undefined)delete state[k];else state[k]=structuredClone(data[k]);}return state;}
export function resolveDoc(doc,choices,device){const result=structuredClone(doc),items=conflicts(doc);if(items.some(c=>!choices[c.path]||!c.versions.some(v=>v.id===choices[c.path])))throw Error('请为每一项冲突选择要保留的版本。');result.clock[device]=(result.clock[device]||0)+1;const id=device+':'+result.clock[device]+':'+crypto.randomUUID();for(const c of items){const chosen=c.versions.find(v=>v.id===choices[c.path]);result.registers[c.path]={[id]:{clock:{...result.clock},deleted:chosen.deleted,value:structuredClone(chosen.value)}};}return result;}
export function enforceReviews(doc,device){
 if(conflicts(doc).length)return doc;const data=materialize(doc),next=structuredClone(data);
 for(const [month,m]of Object.entries(data.months)){
  if(!m.reviewed||m.mode==='summary')continue;
  const monthVersions=Object.values(doc.registers[path('months',month)]||{}),reviewClock=monthVersions.reduce((c,v)=>mergeClock(c,v.clock),{});
  const unseen=Object.entries(doc.registers).filter(([p])=>p.startsWith('transactions/')).some(([,versions])=>Object.values(versions).some(v=>v.value?.date?.startsWith(month)&&!covers(reviewClock,v.clock)));
  if(unseen){next.months[month].reviewed=false;next.months[month].zeroChecked=false;}
 }
 return changeDoc(doc,data,next,device);
}
export function stripSyncSecrets(s){const copy=structuredClone(s);delete copy.syncLink;return copy;}
