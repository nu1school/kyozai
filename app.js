'use strict';
(function(){
const REPO={owner:'nu1school',name:'kyozai',branch:'main'};
const API='https://api.github.com/repos/'+REPO.owner+'/'+REPO.name;
const MANIFEST='materials/manifest.json';
const MCACHE='kyozai-materials-v1';
const KEY='kyozai-token';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let man={version:1,folders:[],items:[]},cwd='',admin=false,token=null,busy=false;
try{token=localStorage.getItem(KEY)}catch(e){}

// ---- 共通表示 ----
let toastT;
function toast(msg,bad){const t=$('toast');t.textContent=msg;t.classList.toggle('bad',!!bad);t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true},bad?6000:3000)}
function dlg(html){
  return new Promise(res=>{
    const d=$('dlg'),f=$('dlgForm');
    f.innerHTML=html;
    const done=v=>{d.close();res(v)};
    f.onsubmit=e=>{
      e.preventDefault();
      const b=e.submitter&&e.submitter.value;
      if(b==='cancel'){done(null);return}
      const o={};new FormData(f).forEach((v,k)=>{o[k]=typeof v==='string'?v.trim():v});
      done(o);
    };
    d.oncancel=e=>{e.preventDefault();done(null)};
    d.showModal();
    const inp=f.querySelector('input,select');if(inp)inp.focus();
  });
}
const btns=(ok,danger)=>`<div class="dbtns"><button class="btn" value="cancel" formnovalidate>やめる</button><button class="btn ${danger?'danger':'primary'}" value="ok">${esc(ok)}</button></div>`;

// ---- フォルダの計算 ----
const parent=p=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';
const leaf=p=>p.slice(p.lastIndexOf('/')+1);
function allFolders(m){
  const s=new Set();
  const add=p=>{while(p){s.add(p);p=parent(p)}};
  m.folders.forEach(add);m.items.forEach(i=>add(i.folder||''));
  return [...s].sort((a,b)=>a.localeCompare(b,'ja',{numeric:true}));
}
const inFolder=(p,f)=>p===f||p.startsWith(f+'/');
const cleanName=s=>s.replace(/[\/\\]/g,'／').replace(/\s+/g,' ').trim();

// ---- データ ----
function sortMan(m){m.items.sort((a,b)=>a.title.localeCompare(b.title,'ja',{numeric:true}));m.folders=[...new Set(m.folders)].sort()}
async function loadManifest(){
  try{
    let got=null;
    if(token){
      // 鍵があるときは最新を直接読む（アップロード直後でも一覧に出る）
      try{got=await apiJSON('/contents/'+MANIFEST+'?ref='+REPO.branch+'&t='+Date.now(),{headers:{Accept:'application/vnd.github.raw+json'}})}catch(e){}
    }
    if(!got){
      const r=await fetch(MANIFEST,{cache:'no-cache'});
      if(!r.ok)throw new Error(r.status);
      got=await r.json();
    }
    man=got;
  }catch(e){
    const c=await (window.caches?caches.match(MANIFEST):null);
    if(c)man=await c.json();
    else if(!navigator.onLine)toast('通信できず，保存済みの一覧もありません。',true);
    else toast('一覧を読み込めませんでした。',true);
  }
  man.folders=man.folders||[];man.items=man.items||[];sortMan(man);
}
async function saveOffline(){
  if(!window.caches)return;
  try{
    const c=await caches.open(MCACHE),keys=await c.keys(),want=new Set(man.items.map(i=>new URL(i.file,location.href).href));
    for(const k of keys)if(!want.has(k.url))await c.delete(k);
    let n=0;
    for(const i of man.items){
      const u=new URL(i.file,location.href).href;
      if(await c.match(u)){n++;continue}
      try{const r=await fetch(u);if(r.ok){await c.put(u,r);n++}}catch(e){}
    }
    $('offline').textContent=man.items.length?`この端末に保存済み ${n}/${man.items.length}`:'';
  }catch(e){}
}
async function loadHtml(item){
  const u=new URL(item.file,location.href).href;
  try{const r=await fetch(u,{cache:'no-cache'});if(r.ok)return await r.text()}catch(e){}
  if(window.caches){const c=await caches.match(u);if(c)return await c.text()}
  if(token){
    try{return await apiText('/contents/'+item.file+'?ref='+REPO.branch,{headers:{Accept:'application/vnd.github.raw+json'}})}catch(e){}
  }
  return null;
}

// ---- GitHub ----
async function api(path,opt={}){
  const r=await fetch(API+path,{...opt,cache:'no-store',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token,...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})}});
  if(!r.ok){const e=new Error('GitHub '+r.status);e.status=r.status;throw e}
  return r;
}
const apiJSON=async(p,o)=>(await api(p,o)).json();
const apiText=async(p,o)=>(await api(p,o)).text();
const postJSON=(p,b,m)=>apiJSON(p,{method:m||'POST',body:JSON.stringify(b)});
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));return btoa(s)}

// 変更を1回のコミットにまとめる。mutate は最新の一覧を書き換え，削除するパスを返す。
async function commit(message,mutate,uploads){
  uploads=uploads||[];
  const blobs=[];
  for(const u of uploads){
    const b=await postJSON('/git/blobs',{content:b64(u.bytes),encoding:'base64'});
    blobs.push({path:u.path,mode:'100644',type:'blob',sha:b.sha});
  }
  for(let attempt=0;attempt<3;attempt++){
    const ref=await apiJSON('/git/ref/heads/'+REPO.branch);
    const head=ref.object.sha;
    const c=await apiJSON('/git/commits/'+head);
    const cur=await apiJSON('/contents/'+MANIFEST+'?ref='+head,{headers:{Accept:'application/vnd.github.raw+json'}});
    cur.folders=cur.folders||[];cur.items=cur.items||[];
    const del=mutate(cur)||[];
    sortMan(cur);
    const tree=[...blobs,{path:MANIFEST,mode:'100644',type:'blob',content:JSON.stringify(cur,null,1)+'\n'},...del.map(p=>({path:p,mode:'100644',type:'blob',sha:null}))];
    const t=await postJSON('/git/trees',{base_tree:c.tree.sha,tree});
    const n=await postJSON('/git/commits',{message,tree:t.sha,parents:[head]});
    try{
      await postJSON('/git/refs/heads/'+REPO.branch,{sha:n.sha},'PATCH');
      man=cur;return;
    }catch(e){if(e.status!==422||attempt===2)throw e}
  }
}
function explain(e){
  if(e.status===401)return '鍵が違うか，期限切れです。管理の鍵を設定し直してください。';
  if(e.status===403||e.status===404)return 'この鍵には書き込みの権限がありません。作成時の設定を確認してください。';
  if(!navigator.onLine)return '通信できないため保存できませんでした。';
  return '保存できませんでした（'+(e.status||e.message)+'）。もう一度試してください。';
}
async function run(message,mutate,uploads,okMsg){
  if(busy)return false;busy=true;
  toast('保存中…');
  try{await commit(message,mutate,uploads);render();saveOffline();toast(okMsg);return true}
  catch(e){toast(explain(e),true);return false}
  finally{busy=false}
}

// ---- 一覧 ----
function render(){
  const fs=allFolders(man);
  const parts=cwd?cwd.split('/'):[];
  let path='',cr='<a href="#/">すべて</a>';
  parts.forEach(p=>{path=path?path+'/'+p:p;cr+=`<span>›</span><a href="#/f/${encodeURIComponent(path)}">${esc(p)}</a>`});
  $('crumbs').innerHTML=cr;
  const subs=fs.filter(f=>parent(f)===cwd);
  $('folders').innerHTML=subs.map(f=>{
    const n=man.items.filter(i=>inFolder(i.folder||'',f)).length;
    return `<div class="folder"><a href="#/f/${encodeURIComponent(f)}"><b>${esc(leaf(f))}</b><small>${n} 件</small></a>${admin?`<div class="fmenu"><button type="button" class="mini" data-fren="${esc(f)}">名前</button><button type="button" class="mini del" data-fdel="${esc(f)}">削除</button></div>`:''}</div>`;
  }).join('');
  const its=man.items.filter(i=>(i.folder||'')===cwd);
  $('items').innerHTML=its.map(i=>`<div class="item"><a href="#/v/${esc(i.id)}"><span class="play" aria-hidden="true">▶</span><b>${esc(i.title)}</b></a>${admin?`<div class="imenu"><button type="button" class="mini" data-copy="${esc(i.id)}">URL</button><button type="button" class="mini" data-ren="${esc(i.id)}">名前</button><button type="button" class="mini" data-mv="${esc(i.id)}">移動</button><button type="button" class="mini del" data-del="${esc(i.id)}">削除</button></div>`:''}</div>`).join('');
  const e=$('empty');e.hidden=subs.length+its.length>0;
  e.textContent=admin?'このフォルダは空です。「＋ HTMLを追加」から教材を入れられます。':'このフォルダに教材はまだありません。';
  $('tools').hidden=!admin;
  $('manage').hidden=admin;
}

// ---- 管理 ----
async function login(err){
  const v=await dlg(`<h2>管理用の鍵</h2>
    ${err?`<p class="err">${esc(err)}</p>`:''}
    <p>アップロードと削除に使います。設定は端末ごとに1回だけです。生徒は設定しなくても教材を見られます。</p>
    <ol>
      <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHubの鍵の作成画面</a>を開く</li>
      <li>Resource owner を <b>nu1school</b> にする</li>
      <li>Repository access で <b>kyozai</b> だけを選ぶ</li>
      <li>Permissions の <b>Contents</b> を Read and write にする</li>
      <li>作成された鍵をコピーして下に貼る</li>
    </ol>
    <label>鍵<input name="t" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>${btns('設定する')}`);
  if(!v)return;
  token=v.t;
  try{
    const r=await apiJSON('');
    if(r.permissions&&r.permissions.push===false){const e=new Error();e.status=403;throw e}
    await api('/git/ref/heads/'+REPO.branch);
  }catch(e){token=null;return login(explain(e))}
  try{localStorage.setItem(KEY,token)}catch(e){toast('この端末には鍵を保存できませんでした。閉じると再入力が必要です。',true)}
  admin=true;await loadManifest();render();toast('管理モードにしました');
}
$('manage').onclick=()=>{if(token){admin=true;loadManifest().then(render)}else login()};
$('logout').onclick=async()=>{
  const v=await dlg(`<h2>管理を終える</h2><p>「鍵も削除」を選ぶと，この端末から鍵を消します。職員室の共用端末などではこちらを選んでください。</p><label>終え方<select name="m"><option value="keep">鍵は残す</option><option value="wipe">鍵も削除</option></select></label>${btns('終える')}`);
  if(!v)return;
  if(v.m==='wipe'){token=null;try{localStorage.removeItem(KEY)}catch(e){}}
  admin=false;render();
};
$('newFolder').onclick=async()=>{
  const v=await dlg(`<h2>新しいフォルダ</h2><p>場所：${esc(cwd||'すべて')}</p><label>フォルダ名<input name="n" required></label>${btns('作る')}`);
  if(!v)return;
  const n=cleanName(v.n);if(!n)return;
  const p=cwd?cwd+'/'+n:n;
  if(allFolders(man).includes(p)){toast('同じ名前のフォルダがあります。',true);return}
  run('フォルダ作成: '+p,m=>{m.folders.push(p)},[],'フォルダを作りました');
};
function makeId(){const d=new Date(),p=n=>String(n).padStart(2,'0'),a=new Uint8Array(3);crypto.getRandomValues(a);return 'm'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+[...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
$('fileInput').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';
  if(!files.length)return;
  const up=[],meta=[],warn=[];
  for(const f of files){
    if(!/\.html?$/i.test(f.name)){toast(f.name+' はHTMLではありません。',true);return}
    if(f.size>20*1024*1024){toast(f.name+' は20MBを超えています。',true);return}
    const bytes=new Uint8Array(await f.arrayBuffer()),text=new TextDecoder().decode(bytes);
    const m=text.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title=cleanName((m&&m[1])||f.name.replace(/\.html?$/i,''))||f.name;
    if(/<(?:script|img|link)\b[^>]*\b(?:src|href)=["'](?!https?:|data:|blob:|#|\/\/)[^"']+/i.test(text))warn.push(title);
    const id=makeId(),path='materials/'+id+'.html';
    up.push({path,bytes});meta.push({id,title,folder:cwd,file:path,added:new Date().toISOString().slice(0,10)});
  }
  const ok=await run('教材追加: '+meta.map(x=>x.title).join(', '),m=>{m.items.push(...meta)},up,meta.length+' 件追加しました');
  if(ok&&warn.length)toast('「'+warn[0]+'」は別ファイルを読み込んでいるようです。画像などが表示されない場合があります。',true);
};
$('folders').onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.fren){
    const f=b.dataset.fren;
    const v=await dlg(`<h2>フォルダ名の変更</h2><label>新しい名前<input name="n" value="${esc(leaf(f))}" required></label>${btns('変更する')}`);
    if(!v)return;const n=cleanName(v.n);if(!n||n===leaf(f))return;
    const to=(parent(f)?parent(f)+'/':'')+n;
    if(allFolders(man).includes(to)){toast('同じ名前のフォルダがあります。',true);return}
    const sw=p=>inFolder(p,f)?to+p.slice(f.length):p;
    run('フォルダ名変更: '+f+' → '+to,m=>{m.folders=m.folders.map(sw);m.items.forEach(i=>{i.folder=sw(i.folder||'')})},[],'名前を変更しました');
  }else if(b.dataset.fdel){
    const f=b.dataset.fdel,n=man.items.filter(i=>inFolder(i.folder||'',f)).length;
    const v=await dlg(`<h2>フォルダの削除</h2><p>「${esc(leaf(f))}」${n?`と，中の教材 <b>${n} 件</b>`:''}を削除します。生徒に配ったURLも開けなくなります。</p>${btns('削除する',true)}`);
    if(!v)return;
    run('フォルダ削除: '+f,m=>{const d=m.items.filter(i=>inFolder(i.folder||'',f)).map(i=>i.file);m.items=m.items.filter(i=>!inFolder(i.folder||'',f));m.folders=m.folders.filter(p=>!inFolder(p,f));return d},[],'削除しました');
  }
};
$('items').onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  const id=b.dataset.copy||b.dataset.ren||b.dataset.mv||b.dataset.del,it=man.items.find(i=>i.id===id);if(!it)return;
  if(b.dataset.copy){
    const url=location.origin+location.pathname+'#/v/'+id;
    try{await navigator.clipboard.writeText(url);toast('生徒用のURLをコピーしました')}
    catch(_){await dlg(`<h2>生徒用のURL</h2><label>長押しでコピーしてください<input name="u" value="${esc(url)}" readonly></label>${btns('閉じる')}`)}
  }else if(b.dataset.ren){
    const v=await dlg(`<h2>教材名の変更</h2><label>新しい名前<input name="n" value="${esc(it.title)}" required></label>${btns('変更する')}`);
    if(!v)return;const n=cleanName(v.n);if(!n||n===it.title)return;
    run('教材名変更: '+n,m=>{const x=m.items.find(i=>i.id===id);if(x)x.title=n},[],'名前を変更しました');
  }else if(b.dataset.mv){
    const opts=['',...allFolders(man)].map(f=>`<option value="${esc(f)}"${f===(it.folder||'')?' selected':''}>${esc(f?f.replace(/\//g,' › '):'すべて（一番上）')}</option>`).join('');
    const v=await dlg(`<h2>移動</h2><p>${esc(it.title)}</p><label>移動先<select name="f">${opts}</select></label>${btns('移動する')}`);
    if(!v||v.f===(it.folder||''))return;
    run('教材移動: '+it.title,m=>{const x=m.items.find(i=>i.id===id);if(x)x.folder=v.f},[],'移動しました');
  }else{
    const v=await dlg(`<h2>教材の削除</h2><p>「${esc(it.title)}」を削除します。生徒に配ったURLも開けなくなります。</p>${btns('削除する',true)}`);
    if(!v)return;
    run('教材削除: '+it.title,m=>{const x=m.items.find(i=>i.id===id);m.items=m.items.filter(i=>i.id!==id);return x?[x.file]:[]},[],'削除しました');
  }
};

// ---- ビューア ----
// 教材は隔離した枠で開く。枠の中から管理用の鍵や他のページには触れない。
const SHIM='<script>(function(){function M(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].length}catch(e){try{Object.defineProperty(window,n,{value:M(),configurable:true})}catch(_){}}})})();<\/script>';
function withShim(h){
  if(/<head[^>]*>/i.test(h))return h.replace(/<head[^>]*>/i,m=>m+SHIM);
  if(/<!doctype[^>]*>/i.test(h))return h.replace(/<!doctype[^>]*>/i,m=>m+SHIM);
  return SHIM+h;
}
let curItem=null,curHtml='';
async function openItem(id){
  $('library').hidden=true;$('viewer').hidden=false;
  const it=man.items.find(i=>i.id===id);
  const msg=$('loadmsg');
  clearInk();setDraw(false);
  if(!it){curItem=null;$('vtitle').textContent='';$('frame').srcdoc='';msg.textContent='この教材は見つかりませんでした。削除された可能性があります。';msg.hidden=false;return}
  curItem=it;$('vtitle').textContent=it.title;msg.textContent='読み込み中…';msg.hidden=false;
  const h=await loadHtml(it);
  if(curItem!==it)return;
  if(h===null){msg.textContent='読み込めませんでした。通信できる場所で一度開くと，次からは通信なしでも使えます。';return}
  curHtml=withShim(h);
  $('frame').srcdoc=curHtml;
  msg.hidden=true;
  requestAnimationFrame(sizeInk);
}
function closeViewer(){
  curItem=null;$('frame').srcdoc='';$('viewer').hidden=true;$('library').hidden=false;
}
$('back').onclick=()=>{
  if(document.fullscreenElement||document.webkitFullscreenElement){(document.exitFullscreen||document.webkitExitFullscreen).call(document)}
  location.hash=cwd?'#/f/'+encodeURIComponent(cwd):'#/';
};
$('reload').onclick=()=>{if(curHtml){$('frame').srcdoc='';requestAnimationFrame(()=>{$('frame').srcdoc=curHtml})}};
(function(){
  const el=document.documentElement,standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  const req=$('viewer').requestFullscreen||$('viewer').webkitRequestFullscreen;
  if(req&&!standalone){$('full').hidden=false;$('full').onclick=()=>{
    if(document.fullscreenElement||document.webkitFullscreenElement)(document.exitFullscreen||document.webkitExitFullscreen).call(document);
    else{try{const p=req.call($('viewer'));if(p&&p.catch)p.catch(()=>{})}catch(e){}}
  }}
})();

// ---- Apple Pencil の書き込み ----
const ink=$('ink'),ig=ink.getContext('2d');
let strokes=[],curS=null,penC='#eeebe0',erasing=false,penSeen=false;
function sizeInk(){
  const r=ink.getBoundingClientRect(),d=window.devicePixelRatio||1;
  if(!r.width)return;
  ink.width=Math.round(r.width*d);ink.height=Math.round(r.height*d);ig.setTransform(d,0,0,d,0,0);redraw();
}
function seg(a,b,c){ig.strokeStyle=c;ig.lineWidth=b.w;ig.lineCap='round';ig.lineJoin='round';ig.beginPath();ig.moveTo(a.x,a.y);ig.lineTo(b.x,b.y);ig.stroke()}
function redraw(){const r=ink.getBoundingClientRect();ig.clearRect(0,0,r.width,r.height);for(const s of strokes){if(s.p.length===1)seg(s.p[0],s.p[0],s.c);for(let i=1;i<s.p.length;i++)seg(s.p[i-1],s.p[i],s.c)}}
function clearInk(){strokes=[];curS=null;redraw()}
function setDraw(on){
  ink.classList.toggle('on',on);$('pens').hidden=!on;
  $('draw').setAttribute('aria-pressed',on?'true':'false');
  if(on)sizeInk();
}
$('draw').onclick=()=>setDraw(!ink.classList.contains('on'));
$('pens').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.c){penC=b.dataset.c;erasing=false;$('eraser').classList.remove('on');document.querySelectorAll('.pen').forEach(x=>x.classList.toggle('on',x===b))}
  else if(b.id==='eraser'){erasing=!erasing;b.classList.toggle('on',erasing)}
  else if(b.id==='undo'){strokes.pop();redraw()}
  else if(b.id==='clear')clearInk();
});
const ptOf=e=>{const r=ink.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top,w:e.pointerType==='pen'?1.6+3.4*(e.pressure||.4):3.2}};
const accept=e=>{if(e.pointerType==='pen')penSeen=true;return !(penSeen&&e.pointerType==='touch')};
function eraseAt(p){const n=strokes.length;strokes=strokes.filter(s=>!s.p.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<14));if(strokes.length!==n)redraw()}
ink.addEventListener('pointerdown',e=>{
  if(!accept(e))return;
  e.preventDefault();try{ink.setPointerCapture(e.pointerId)}catch(_){}
  const p=ptOf(e);
  if(erasing){curS={erase:true};eraseAt(p);return}
  curS={c:penC,p:[p],id:e.pointerId};strokes.push(curS);seg(p,p,penC);
});
ink.addEventListener('pointermove',e=>{
  if(!curS||!accept(e))return;
  e.preventDefault();
  const list=e.getCoalescedEvents?e.getCoalescedEvents():[e];
  for(const ev of (list.length?list:[e])){
    const p=ptOf(ev);
    if(curS.erase){eraseAt(p);continue}
    const a=curS.p[curS.p.length-1];curS.p.push(p);seg(a,p,curS.c);
  }
});
const endS=()=>{curS=null};
ink.addEventListener('pointerup',endS);ink.addEventListener('pointercancel',endS);
window.addEventListener('resize',()=>{if(!$('viewer').hidden)sizeInk()});

// ---- 画面の切りかえ ----
function route(){
  const h=location.hash||'#/';
  if(h.startsWith('#/v/')){openItem(decodeURIComponent(h.slice(4)));return}
  if(!$('viewer').hidden)closeViewer();
  cwd=h.startsWith('#/f/')?decodeURIComponent(h.slice(4)):'';
  render();
}
window.addEventListener('hashchange',route);

(async function start(){
  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('sw.js')}catch(e){}}
  await loadManifest();
  route();
  saveOffline();
  if(navigator.storage&&navigator.storage.persist){try{navigator.storage.persist()}catch(e){}}
})();
})();
