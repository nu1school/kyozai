// 通信を優先し，遅い・つながらないときは保存済みの内容で開く。
const SHELL='kyozai-shell-v1', MATERIALS='kyozai-materials-v1';
const FILES=['./','index.html','style.css','app.js','app.webmanifest','materials/manifest.json','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'];
const WAIT_MS=2500;

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(SHELL);
    await Promise.all(FILES.map(f=>c.add(new Request(f,{cache:'no-cache'})).catch(()=>{})));
    self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys())if(k!==SHELL&&k!==MATERIALS)await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin)return;
  const isMaterial=/\/materials\/[^/]+\.html$/.test(url.pathname);
  e.respondWith(handle(req,isMaterial?MATERIALS:SHELL));
});
async function handle(req,name){
  const cache=await caches.open(name);
  const net=fetch(req,{cache:'no-cache'}).then(r=>{
    if(r.ok){const copy=r.clone();cache.put(req.mode==='navigate'?'index.html':req,copy).catch(()=>{})}
    return r;
  });
  const saved=()=>req.mode==='navigate'?cache.match('index.html'):caches.match(req,{ignoreSearch:true});
  const timed=new Promise(res=>setTimeout(()=>res('late'),WAIT_MS));
  try{
    const first=await Promise.race([net,timed]);
    if(first!=='late')return first.ok?first:((await saved())||first);
    return (await saved())||await net;
  }catch(err){
    const s=await saved();
    if(s)return s;
    throw err;
  }
}
