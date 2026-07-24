const CACHE='maps-app-v14-16-rel';
const ASSETS=['./','index.html','style.css','app.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-512-maskable.png','icons/apple-touch-icon.png','vendor/jszip.min.js'];

// Niente skipWaiting automatico: il codice non deve cambiare sotto i piedi dell'utente
// mentre sta salvando. L'aggiornamento parte solo quando lo chiede lui dal banner.
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(err=>{console.warn('precache parziale',err)}))
});

self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting()});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  )
});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  const sameOrigin=url.origin===location.origin;

  if(sameOrigin){
    e.respondWith(
      fetch(e.request,{cache:'no-cache'})
        .then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return res})
        .catch(()=>caches.match(e.request).then(r=>{
          if(r)return r;
          if(e.request.mode==='navigate')return caches.match('index.html');
          return new Response('',{status:504,statusText:'Offline'})
        }))
    );
    return
  }

  // risorse esterne (tile della mappa, geocoder): cache prima, poi rete.
  // Prima, in caso di errore, veniva restituito index.html anche per una tile PNG:
  // il browser si ritrovava HTML dove aspettava un'immagine.
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request)
      .then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return res})
      .catch(()=>new Response('',{status:504,statusText:'Offline'})))
  )
});
