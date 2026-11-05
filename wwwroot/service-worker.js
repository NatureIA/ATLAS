/* ATLAS PWA: never cache authenticated HTML, forms, financial endpoints or SQL data. */
const CACHE_NAME = 'atlas-static-v9';
const STATIC_ASSETS = ['/css/site.css', '/js/site.js', '/js/pwa.js', '/manifest.webmanifest', '/icons/atlas-192.png', '/icons/atlas-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('atlas-static-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode === 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !STATIC_ASSETS.includes(url.pathname) || request.headers.has('authorization')) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(() => caches.match(request)));
});

/* Push notifications only; existing installation/cache lifecycle remains unchanged. */
self.addEventListener('push', event => {
  let payload={title:'ATLAS',body:'Você possui despesas pendentes de baixa.',url:'/Expenses?status=pending',tag:'atlas-pending-expenses'};
  try { if(event.data) payload={...payload,...event.data.json()}; } catch (_) {}
  const safeUrl=typeof payload.url==='string' && payload.url.startsWith('/') && !payload.url.startsWith('//')
    ?payload.url:'/Expenses?status=pending';
  event.waitUntil(self.registration.showNotification(String(payload.title).slice(0,90),{
    body:String(payload.body).slice(0,180),
    icon:'/icons/atlas-192.png',
    badge:'/icons/atlas-192.png',
    tag:'atlas-pending-expenses',
    renotify:true,
    data:{url:safeUrl}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/Expenses?status=pending',self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const windowClient of windows){
      if(windowClient.url.startsWith(self.location.origin)){
        await windowClient.navigate(target);
        return windowClient.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
