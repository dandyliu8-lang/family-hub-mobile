import {canonical,sharedData,initialShared,emptyShared,emptyDoc,changeDoc,mergeDocs,conflicts,materialize,applyShared,resolveDoc,enforceReviews,equal} from './sync-model.js';
import {parsePairCode,sealDoc,openDoc,hash,pairCode} from './sync-crypto.js';

export const SYNC_ENDPOINT='https://family-hub-private-2027.netlify.app/api/sync/v1/';
export function createLink(state,code){const pair=parsePairCode(code,SYNC_ENDPOINT),device=crypto.randomUUID();return {...pair,device,doc:changeDoc(emptyDoc(),emptyShared(),initialShared(state),device),observedData:sharedData(state),uploadSeq:0,publishedHash:null,lastSyncedAt:null};}
export function prepareLocalChange(before,after){if(before.syncLink&&!after.syncLink)after.syncLink=structuredClone(before.syncLink);if(after.syncLink&&before.syncLink){const tracked=after.syncLink.observedData||sharedData(before);after.syncLink.doc=changeDoc(after.syncLink.doc,tracked,sharedData(before),after.syncLink.device);after.syncLink.doc=changeDoc(after.syncLink.doc,sharedData(before),sharedData(after),after.syncLink.device);after.syncLink.observedData=sharedData(after);}}
const abortError=e=>e?.name==='AbortError';
export class SyncEngine{
 constructor({getState,persist,canApply=()=>true,isVisible=()=>true,onStatus=()=>{},onConflict=()=>{},fetcher=fetch}){Object.assign(this,{getState,persist,canApply,isVisible,onStatus,onConflict,fetcher});this.running=false;this.pending=null;this.timer=null;this.stopped=false;this.status={kind:'off',text:'未连接同步'};}
 setStatus(kind,text){this.status={kind,text};this.onStatus(this.status);}
 start(){this.stopped=false;this.schedule(50);}
 stop(){this.stopped=true;clearTimeout(this.timer);this.abort?.abort();this.pending=null;this.setStatus('locked','已锁定，暂停同步');}
 schedule(ms=350){clearTimeout(this.timer);if(this.stopped)return;this.timer=setTimeout(()=>this.run(),ms);this.timer.unref?.();}
 changed(){if(!this.getState()?.syncLink)return;this.setStatus('pending','已保存本机 · 等待同步');this.schedule();}
 async request(link,method='GET',payload){if(!link.endpoint||link.endpoint!==SYNC_ENDPOINT)throw Error('同步地址与当前应用不匹配，已停止上传。');const controller=new AbortController();const stop=()=>controller.abort();this.abort?.signal.addEventListener('abort',stop,{once:true});const timeout=setTimeout(stop,20000);try{const response=await this.fetcher(link.endpoint+encodeURIComponent(link.vault),{method,headers:{Authorization:'Bearer '+link.token,...(payload?{'Content-Type':'application/json'}:{})},cache:'no-store',credentials:'omit',signal:controller.signal,...(payload?{body:JSON.stringify(payload)}:{})});let body;try{body=await response.json();}catch{throw Error('同步服务返回了无法识别的内容。本机数据仍保留。');}if(!response.ok){const e=Error(response.status===401?'配对授权无效，已停止同步，请重新配对。':body.error||'同步暂未完成，本机数据仍保留。');e.status=response.status;throw e;}return body;}finally{clearTimeout(timeout);this.abort?.signal.removeEventListener('abort',stop);}}
 async run(){
  if(this.running||this.stopped)return;let first=this.getState();if(!first?.syncLink){this.setStatus('off','未连接同步');return;}
  if(first.syncLink.syncError){this.setStatus('pending','已保存本机 · 同步暂停：'+first.syncLink.syncError);this.schedule(60000);return;}
  if(!this.isVisible()){this.schedule(30000);return;}
  if(!this.canApply()){this.schedule(1000);return;}
  this.running=true;this.abort=new AbortController();let retry=10000;
  try{
   this.setStatus('working','正在加密同步…');const reconciled=structuredClone(first);prepareLocalChange(first,reconciled);if(!equal(first.syncLink.doc,reconciled.syncLink.doc)){await this.persist(s=>{if(!equal(sharedData(s),sharedData(first)))throw Object.assign(Error('本机有新修改'),{retry:true});s.syncLink.doc=reconciled.syncLink.doc;s.syncLink.observedData=sharedData(s);});first=this.getState();}const link=structuredClone(first.syncLink),reply=await this.request(link);
   if(!Array.isArray(reply.files)||reply.files.length>30)throw Error('云端设备版本列表不合法，未改动本机数据。');
   let remote=emptyDoc(),serverSeq=0;
   for(const file of reply.files){if(!file||!Number.isSafeInteger(file.seq)||file.seq<1||typeof file.writer!=='string')throw Error('云端版本信息不合法。');remote=mergeDocs(remote,await openDoc(file.envelope,link));if(file.writer===link.device)serverSeq=Math.max(serverSeq,file.seq);}
   if(this.stopped||!this.canApply())return;
   let current=this.getState();if(!current?.syncLink||current.syncLink.vault!==link.vault)return;
   let merged=mergeDocs(current.syncLink.doc,remote),items=conflicts(merged);
   if(items.length){this.pending=merged;this.onConflict(items);this.setStatus('conflict',`${items.length} 项修改需要选择 · 本机记录保留`);retry=30000;return;}
   merged=enforceReviews(merged,link.device);const data=materialize(merged),docHash=await hash(canonical(merged));
   let reserved=null;
   // The adapter commits the business data and synchronization metadata in the
   // same encrypted IndexedDB write, with the app's existing revision guard.
   await this.persist(s=>{
    if(!s.syncLink||s.syncLink.vault!==link.vault)throw Error('同步连接已更改，请重试。');
    if(!equal(s.syncLink.doc,current.syncLink.doc))throw Object.assign(Error('本机新增了修改，准备重新同步。'),{retry:true});
    applyShared(s,data);s.syncLink.doc=merged;s.syncLink.observedData=sharedData(s);
    if(s.syncLink.publishedHash!==docHash){s.syncLink.uploadSeq=Math.max(s.syncLink.uploadSeq||0,serverSeq)+1;reserved={seq:s.syncLink.uploadSeq,doc:structuredClone(merged),hash:docHash};}
    else if(!s.syncLink.lastSyncedAt)s.syncLink.lastSyncedAt=new Date().toISOString();
   },{noChange:equal(current.syncLink.doc,merged)&&current.syncLink.publishedHash===docHash});
   if(reserved){
    if(this.stopped)return;const envelope=await sealDoc(reserved.doc,link);const payload={writer:link.device,seq:reserved.seq,envelope};
    if(new TextEncoder().encode(JSON.stringify(payload)).length>1800000)throw Error('加密版本超过同步容量上限；本机仍已保存，请先导出加密备份。');
    const acknowledged=await this.request(link,'PUT',payload);if(!acknowledged.stored||acknowledged.seq!==reserved.seq)throw Error('云端未确认保存，仍保留为待同步。');
    if(this.stopped)return;
    await this.persist(s=>{if(!s.syncLink||s.syncLink.vault!==link.vault)return;s.syncLink.publishedHash=reserved.hash;s.syncLink.lastSyncedAt=new Date().toISOString();});
   }
   this.pending=null;this.onConflict([]);const latest=this.getState();if(!latest?.syncLink)return;
   const stillDirty=await hash(canonical(latest.syncLink.doc))!==latest.syncLink.publishedHash;
   this.setStatus(stillDirty?'pending':'ok',stillDirty?'已保存本机 · 新记录等待同步':'已同步 · '+new Date(latest.syncLink.lastSyncedAt||Date.now()).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
   if(stillDirty)retry=350;
  }catch(e){
   if(!abortError(e)||!this.stopped){this.setStatus(e.status===401?'auth':'pending',e.retry?'本机有新修改，正在重新同步':(abortError(e)?'连接超时 · 已保存本机，稍后继续':e.message)||'离线或连接暂不可用 · 已保存本机');retry=e.retry?350:e.status===401?60000:15000;}
  }finally{this.running=false;this.abort=null;if(!this.stopped&&this.getState()?.syncLink)this.schedule(retry);}
 }
 async resolve(choices){if(!this.pending)throw Error('暂无需要解决的冲突，请重新同步。');const state=this.getState();if(!state?.syncLink)throw Error('请先解锁工作台。');const resolved=resolveDoc(mergeDocs(this.pending,state.syncLink.doc),choices,state.syncLink.device),data=materialize(resolved);await this.persist(s=>{applyShared(s,data);s.syncLink.doc=resolved;s.syncLink.observedData=sharedData(s);},{allowDialog:true});this.pending=null;this.onConflict([]);this.changed();}
 code(){const link=this.getState()?.syncLink;if(!link)throw Error('尚未连接同步。');return pairCode(link);}
}
