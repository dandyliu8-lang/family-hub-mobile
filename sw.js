const CACHE='family-hub-shell-v1.1.0';
const FILES=['./','./index.html','./styles.css','./app.js','./core.js','./storage.js','./excel.js','./vendor/xlsx.full.min.js','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('family-hub-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin)return;if(e.request.mode==='navigate'&&url.pathname.startsWith(new URL(self.registration.scope).pathname)){e.respondWith(caches.match('./index.html').then(c=>c||fetch(e.request)));return;}e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));});
self.addEventListener('message',e=>{if(e.data==='ACTIVATE_UPDATE')self.skipWaiting();});
