const DB_NAME='maps-app-db';
const DB_STORE='projects';
const DB_KEY='main';
const LEGACY_KEY='maps-app-project-v3';
let project={version:2,updatedAt:null,clients:{},imports:{},tour:[],tourStart:null,tourStartLabel:'',tourStartGps:false,emailsOff:[]};
let map=null,markers=null,tourLayer=null,deferredPrompt,currentId=null;
const $=s=>document.querySelector(s);
const euro=n=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(Number(n)||0);
const norm=s=>String(s??'').trim();
const normHeader=s=>norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/['’`´]/g,'').replace(/\s+/g,' ').toUpperCase();
const canonId=v=>{const s=norm(v).toUpperCase();if(!s)return'';const compact=s.replace(/\s/g,'');const d=compact.replace(/\D/g,'');if(d&&d===compact)return d.replace(/^0+/,'').padStart(5,'0');return s};
const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:0;const s=String(v??'').trim().replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?n:0};
const excelDate=v=>{if(!v)return'';if(typeof v==='number'||/^\d+(\.\d+)?$/.test(String(v))){const n=Number(v);const d=new Date(Date.UTC(1899,11,30)+n*86400000);return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`}return String(v)};
const DB_KEY_BACKUP='backup';
const NORM_VERSION=3;   // cambia solo quando cambia la forma dei dati normalizzati
let loadFailed=false;          // true se non sono riuscito a leggere l'archivio: blocca le scritture
let pendingWrites=0;           // scritture in volo: impedisce il reload del service worker
let storagePersisted=null;     // esito di navigator.storage.persist()
let saveQueue=Promise.resolve();// serializza le scritture: niente transazioni concorrenti
function openDb(){return new Promise((resolve,reject)=>{
 let req,done=false;
 const fail=e=>{if(done)return;done=true;reject(e instanceof Error?e:new Error(String(e&&e.message||e||'IndexedDB non disponibile')))};
 const ok=db=>{if(done)return;done=true;resolve(db)};
 try{req=indexedDB.open(DB_NAME,1)}catch(e){return fail(e)}
 req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE)};
 req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();ok(db)};
 req.onerror=()=>fail(req.error||new Error('IndexedDB non disponibile (navigazione privata?)'));
 req.onblocked=()=>fail(new Error('Archivio bloccato da un\u2019altra scheda di Maps APP: chiudi le altre schede e riprova.'));
 setTimeout(()=>fail(new Error('IndexedDB non risponde. Su iPhone/iPad succede in navigazione privata: apri la app in una scheda normale.')),10000)
})}
function idbPut(db,key,value){return new Promise((resolve,reject)=>{
 let tx;
 try{tx=db.transaction(DB_STORE,'readwrite')}catch(e){return reject(e)}
 try{tx.objectStore(DB_STORE).put(value,key)}catch(e){try{tx.abort()}catch(_){}return reject(e)}
 tx.oncomplete=()=>resolve();
 tx.onerror=()=>reject(tx.error||new Error('scrittura non riuscita'));
 tx.onabort=()=>reject(tx.error||new Error('scrittura interrotta (spazio esaurito?)'))
})}
function idbGet(db,key){return new Promise((resolve,reject)=>{
 let tx;
 try{tx=db.transaction(DB_STORE,'readonly')}catch(e){return reject(e)}
 const req=tx.objectStore(DB_STORE).get(key);
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error||new Error('lettura non riuscita'))
})}
// Scrive il progetto e RILEGGE per confermare: senza verifica non si pu\u00f2 dire all'utente "salvato".
async function persistNow(verifica){
 if(loadFailed)throw new Error('Salvataggio bloccato: l\u2019archivio locale non \u00e8 stato letto correttamente all\u2019avvio. Ricarica la app prima di modificare i dati, altrimenti rischi di sovrascrivere quelli buoni.');
 pendingWrites++;
 const db=await openDb();
 try{
  // il vecchio progetto diventa backup: se un "Apri progetto" sbagliato sostituisce tutto, si recupera
  try{const prev=await idbGet(db,DB_KEY);if(prev&&prev.clients&&Object.keys(prev.clients).length)await idbPut(db,DB_KEY_BACKUP,prev)}catch(e){console.warn('backup non riuscito',e)}
  try{await idbPut(db,DB_KEY,project)}
  catch(e){
   // DataCloneError: qualcosa nel progetto non \u00e8 clonabile. Ripulisco passando da JSON e riprovo.
   if(String(e&&e.name)!=='DataCloneError')throw e;
   console.warn('DataCloneError: riprovo con una copia serializzata',e);
   await idbPut(db,DB_KEY,JSON.parse(JSON.stringify(project)))
  }
  const atteso=Object.keys(project.clients||{}).length;
  let back=null,letto=atteso;
  if(verifica){
   back=await idbGet(db,DB_KEY);
   letto=Object.keys((back&&back.clients)||{}).length;
   if(!back)throw new Error('salvataggio non confermato: rileggendo l\u2019archivio non c\u2019\u00e8 nulla');
   if(letto!==atteso)throw new Error(`salvataggio incompleto: salvati ${letto} clienti su ${atteso}`);
  }
  // se non esiste ancora un backup (primo salvataggio su questo dispositivo) lo semino adesso,
  // altrimenti un'eviction del browser lascerebbe l'agente senza nessuna rete di sicurezza
  try{const b=await idbGet(db,DB_KEY_BACKUP);if((!b||!b.clients||!Object.keys(b.clients).length)&&atteso)await idbPut(db,DB_KEY_BACKUP,back||project)}catch(e){console.warn('seed backup',e)}
  scriviSentinella();
  return letto
 }finally{try{db.close()}catch(e){}pendingWrites--;drainReload()}
}
function persistProject(verifica){const run=()=>persistNow(verifica);saveQueue=saveQueue.then(run,run);return saveQueue}
async function readProject(){const db=await openDb();try{return await idbGet(db,DB_KEY)}finally{try{db.close()}catch(e){}}}
async function readBackup(){const db=await openDb();try{return await idbGet(db,DB_KEY_BACKUP)}finally{try{db.close()}catch(e){}}}
// Applica TUTTI i valori di default e le migrazioni. Prima esisteva solo dentro load(),
// quindi un progetto aperto da file finiva in archivio in una forma diversa da quella attesa.
function adoptProject(p){
 if(!p||typeof p!=='object'||!p.clients||typeof p.clients!=='object')throw new Error('Il file non contiene un progetto Maps APP (manca l\u2019elenco clienti).');
 p.version??=2;p.imports??={};p.tour??=[];p.tourStart??=null;p.tourStartLabel??='';p.tourStartGps??=false;p.emailsOff??=[];
 if(!Array.isArray(p.tour))p.tour=[];
 if(!Array.isArray(p.emailsOff))p.emailsOff=[];
 for(const[k,c]of Object.entries(p.clients)){
  if(!c||typeof c!=='object'){delete p.clients[k];continue}
  c.id=norm(c.id)||canonId(k)||k;
  c.orderLines??=[];c.saleLines??=[];c.saleYears??={};c.emails??=[];c.phones??=[];
  if(!Array.isArray(c.orderLines))c.orderLines=[];
  if(!Array.isArray(c.saleLines))c.saleLines=[];
  if(!Array.isArray(c.emails))c.emails=[];
  if(!Array.isArray(c.phones))c.phones=[];
  if(!c.saleYears||typeof c.saleYears!=='object')c.saleYears={};
  c.orders=num(c.orders);c.sales=num(c.sales)
 }
 project=p;migrateAgentBase();migrateClients();return project
}
async function save(){
 project.updatedAt=new Date().toISOString();
 try{await persistProject()}
 catch(e){console.error('IndexedDB',e);storageAlert(e);throw e}
 render()
}
async function load(){
 let p=null,daBackup=false;
 try{p=await readProject()}
 catch(e){
  loadFailed=true;console.error('Lettura archivio locale non riuscita',e);
  storageAlert(e,'Non riesco a leggere i dati salvati su questo dispositivo. NON importare e non aprire nulla adesso: ricarica la pagina, cos\u00ec non rischi di sovrascrivere i dati buoni.');
  return
 }
 try{
  if(!p){const legacy=localStorage.getItem(LEGACY_KEY);if(legacy){p=JSON.parse(legacy);localStorage.removeItem(LEGACY_KEY)}}
  if(!p||!p.clients||!Object.keys(p.clients).length){
   const b=await readBackup().catch(()=>null);
   if(b&&b.clients&&Object.keys(b.clients).length){p=b;daBackup=true;console.warn('Archivio principale vuoto: ripristino dal backup')}
  }
  if(p&&p.clients){
   const eraNormalizzato=p.normVersion===NORM_VERSION;
   adoptProject(p);
   // riscrive in forma normalizzata solo se serve: cosi' l'archivio non resta mai
   // in uno stato "grezzo", ma l'avvio non ricopia 30 MB a ogni apertura
   if(!eraNormalizzato)await persistProject()
   if(daBackup)setTimeout(()=>alert('I dati principali non c\u2019erano pi\u00f9: ho ripristinato la copia di sicurezza interna ('+Object.keys(project.clients).length+' clienti). Esporta subito il progetto per sicurezza.'),400)
  }
 }catch(e){
  loadFailed=true;console.error('Archivio illeggibile',e);
  storageAlert(e,'I dati salvati sono presenti ma non sono riuscito ad aprirli. Non importare nulla: segnala il problema.')
 }
}

// ---------------------------------------------------------------------------
// Progetto agganciato al link.
// Se il browser dell'agente cancella l'archivio (Safari lo fa con i siti non
// installati, e le anteprime interne di WhatsApp/Gmail lo azzerano a ogni
// chiusura), riaprire il link ricarica da solo il progetto: nessun file da
// ritrovare, nessun passaggio manuale.
//   ...index.html?agente=dolce   ->  agenti/dolce.json
//   ...index.html?data=percorso/file.json
// ---------------------------------------------------------------------------
// I conteggi di import vanno ricalcolati sul sottoinsieme: altrimenti l'agente si
// vede scritto "vendite: 48779 righe" mentre ne ha 761, ed e' solo confusione.
function subsetImports(cs){
 const src=project.imports||{},out={};
 const righe={clienti:cs.length,
  ordini:cs.reduce((s,c)=>s+((c.orderLines||[]).length),0),
  vendite:cs.reduce((s,c)=>s+((c.saleLines||[]).length),0)};
 for(const k of ['clienti','ordini','vendite'])if(src[k])out[k]={...src[k],rows:righe[k]};
 out.clientiCount=cs.length;
 return out
}
function urlProgetto(){
 try{
  const u=new URL(location.href);
  const ag=u.searchParams.get('agente'),dt=u.searchParams.get('data');
  const rel=dt||(ag?('agenti/'+ag.toLowerCase().replace(/[^a-z0-9_-]/g,'')+'.json'):null);
  if(!rel)return null;
  const url=new URL(rel,location.href);
  if(url.origin!==location.origin)return null;   // solo file pubblicati insieme alla app
  return url.href
 }catch(e){return null}
}
async function scaricaProgetto(url){
 const r=await fetch(url,{cache:'no-cache'});
 if(!r.ok)throw new Error('HTTP '+r.status);
 const p=await r.json();
 if(!p||!p.clients)throw new Error('il file agganciato al link non contiene un progetto');
 return p
}
async function caricaDaLink(){
 const url=urlProgetto();
 if(!url)return false;
 const locali=Object.keys(project.clients||{}).length;
 let p;
 try{p=await scaricaProgetto(url)}
 catch(e){
  console.warn('progetto da link non disponibile',e);
  if(!locali)storageAlert(e,'Non riesco a scaricare il progetto agganciato al link: '+(e&&e.message||e));
  return false
 }
 const n=Object.keys(p.clients).length;
 if(!locali){
  // archivio vuoto: primo accesso oppure dati cancellati dal browser. Ricarico e basta.
  const perso=sentinellaDiceCheAvevoDati();   // va letta PRIMA di salvare, il salvataggio la riscrive
  adoptProject(p);
  try{await persistProject(true)}catch(e){console.warn('salvataggio non riuscito',e)}
  render();if(map)fit();
  $('#status').textContent=perso
   ? `Il browser aveva cancellato i dati: ho ricaricato il progetto dal link (${n} clienti).`
   : `Progetto caricato dal link: ${n} clienti.`;
  return true
 }
 // ho gia' dati miei: non tocco niente senza permesso
 const mio=Date.parse(project.updatedAt||0)||0,suo=Date.parse(p.updatedAt||0)||0;
 if(suo>mio)mostraAggiornamentoDaLink(p,n);
 return false
}
function mostraAggiornamentoDaLink(p,n){
 if(document.getElementById('linkBanner'))return;
 const d=document.createElement('div');d.id='linkBanner';d.className='upd-banner';
 d.innerHTML='<span>\u00c8 disponibile una versione pi\u00f9 recente del progetto ('+n+' clienti, '+new Date(p.updatedAt).toLocaleString('it-IT')+').</span><button type="button" id="linkMerge">Unisci</button><button type="button" id="linkOpen">Sostituisci</button><button type="button" id="linkNo">No</button>';
 document.body.appendChild(d);
 document.getElementById('linkNo').onclick=()=>d.remove();
 document.getElementById('linkMerge').onclick=async()=>{d.remove();mergeProject(p);await save()};
 document.getElementById('linkOpen').onclick=async()=>{
  if(!confirm('Sostituisci il progetto attuale ('+Object.keys(project.clients||{}).length+' clienti) con quello del link ('+n+')?'))return;
  d.remove();adoptProject(p);try{await persistProject(true);render();if(map)fit()}catch(e){storageAlert(e)}
 }
}
// Sentinella: un promemoria minuscolo in localStorage. Se dice che avevo dei clienti
// ma IndexedDB e' vuoto, il browser ha cancellato l'archivio: e' l'unico modo per
// distinguere "non ho mai salvato" da "me l'hanno cancellato".
function scriviSentinella(){try{localStorage.setItem('maps-app-sentinella',JSON.stringify({n:Object.keys(project.clients||{}).length,t:Date.now()}))}catch(e){}}
function sentinellaDiceCheAvevoDati(){try{const v=JSON.parse(localStorage.getItem('maps-app-sentinella')||'null');return !!(v&&v.n>0)}catch(e){return false}}
function avvisaSeDatiCancellati(){
 if(Object.keys(project.clients||{}).length)return;
 if(!sentinellaDiceCheAvevoDati())return;
 let v=null;try{v=JSON.parse(localStorage.getItem('maps-app-sentinella'))}catch(e){}
 alert('Il browser ha cancellato i dati salvati su questo dispositivo.\n\nL\u2019ultimo salvataggio ('+(v&&v.n)+' clienti, '+new Date(v&&v.t).toLocaleString('it-IT')+') non c\u2019\u00e8 pi\u00f9: non \u00e8 un errore della app, \u00e8 il sistema che libera spazio sui siti non installati.\n\nPer evitarlo: aggiungi Maps APP alla schermata Home (Condividi \u2192 Aggiungi a schermata Home) e riapri sempre da quell\u2019icona.');
}

function storageAlert(e,testo){
 const el=$('#status');
 const msg=testo||('Salvataggio non riuscito: '+(e&&e.message||e));
 if(el){el.textContent=msg;el.style.color='#b91c1c';el.style.fontWeight='700'}
 console.error(msg,e)
}
// Chiede al browser di NON cancellare i dati. Senza questa chiamata Safari/iOS
// tratta l'archivio come "best effort" e lo pu\u00f2 buttare via da un momento all'altro.
async function requestPersistentStorage(){
 try{
  if(!navigator.storage||!navigator.storage.persist){storagePersisted=null;return null}
  if(await navigator.storage.persisted()){storagePersisted=true;return true}
  storagePersisted=await navigator.storage.persist();
  return storagePersisted
 }catch(e){storagePersisted=null;return null}
}
function warnIfStorageVolatile(){
 if(storagePersisted!==false)return;
 if(!Object.keys(project.clients||{}).length)return;
 if(document.getElementById('volBanner'))return;
 const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 if(standalone)return;
 const d=document.createElement('div');d.id='volBanner';d.className='upd-banner';
 d.innerHTML='<span>Questi dati possono essere cancellati dal browser. Installa Maps APP (Condividi \u2192 Aggiungi a schermata Home) oppure esporta spesso il progetto.</span><button type="button" id="volClose">Ho capito</button>';
 document.body.appendChild(d);
 document.getElementById('volClose').onclick=()=>d.remove()
}
function migrateClients(){const merged={};for(const[k,c]of Object.entries(project.clients||{})){if(!c||typeof c!=='object')continue;const id=canonId(k)||k;if(!merged[id]){merged[id]={...c,id};continue}const t=merged[id];t.name=t.name||c.name;t.address=t.address||c.address;t.city=t.city||c.city;t.cap=t.cap||c.cap;t.province=t.province||c.province;t.agent=t.agent||c.agent;t.agentCode=t.agentCode||c.agentCode;t.abc=t.abc||c.abc;t.payment=t.payment||c.payment;t.note=[t.note,c.note].filter(Boolean).join('\n');t.orders=(t.orders||0)+(c.orders||0);t.sales=(t.sales||0)+(c.sales||0);t.orderLines=[...(t.orderLines||[]),...(c.orderLines||[])];t.saleLines=[...(t.saleLines||[]),...(c.saleLines||[])];t.saleYears||(t.saleYears={});for(const[y,v]of Object.entries(c.saleYears||{}))t.saleYears[y]=(t.saleYears[y]||0)+v;t.emails=[...new Set([...(t.emails||[]),...(c.emails||[])])];t.phones=[...new Set([...(t.phones||[]),...(c.phones||[])])];if(t.lat==null&&c.lat!=null){t.lat=c.lat;t.lng=c.lng;t.manualPosition=c.manualPosition}}project.clients=merged}
function initMap(){if(typeof L==='undefined'){document.getElementById('map').innerHTML='<div style="padding:24px;text-align:center"><b>Mappa non disponibile.</b><br><small>Serve una connessione Internet per caricare la cartografia. L’importazione Excel funziona comunque.</small></div>';return}map=L.map('map').setView([42.5,12.5],6);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);markers=L.layerGroup().addTo(map);tourLayer=L.layerGroup().addTo(map)}
function xmlText(node){return Array.from(node.getElementsByTagNameNS('*','t')).map(x=>x.textContent||'').join('')}
function colIndex(ref,fallback=0){const m=String(ref??'').match(/[A-Z]+/);if(!m)return fallback;let n=0;for(const ch of m[0])n=n*26+ch.charCodeAt(0)-64;return n-1}
function fileToArrayBuffer(file){if(file.arrayBuffer)return file.arrayBuffer();return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('Impossibile leggere il file'));r.readAsArrayBuffer(file)})}
async function readXlsx(file){if(typeof JSZip==='undefined')throw new Error('Lettore Excel non disponibile');const buffer=await fileToArrayBuffer(file);const zip=await JSZip.loadAsync(buffer);const parser=new DOMParser();let shared=[];const ss=zip.file('xl/sharedStrings.xml');if(ss){const doc=parser.parseFromString(await ss.async('string'),'application/xml');shared=Array.from(doc.getElementsByTagNameNS('*','si')).map(xmlText)}const wbDoc=parser.parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml');const relDoc=parser.parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'),'application/xml');const rels={};for(const r of relDoc.getElementsByTagNameNS('*','Relationship'))rels[r.getAttribute('Id')]=r.getAttribute('Target');const sheets=[];for(const s of wbDoc.getElementsByTagNameNS('*','sheet')){const rid=s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||s.getAttribute('r:id');let target=rels[rid];if(!target)continue;target=target.replace(/^\//,'');if(!target.startsWith('xl/'))target='xl/'+target.replace(/^\.\.\//,'');sheets.push({name:s.getAttribute('name'),target})}const all=[];for(const sh of sheets){const f=zip.file(sh.target);if(!f)continue;const doc=parser.parseFromString(await f.async('string'),'application/xml');const matrix=[];for(const row of doc.getElementsByTagNameNS('*','row')){const arr=[];let nextIdx=0;for(const c of row.getElementsByTagNameNS('*','c')){const idx=colIndex(c.getAttribute('r'),nextIdx);nextIdx=idx+1;const t=c.getAttribute('t');let v='';const vn=c.getElementsByTagNameNS('*','v')[0];if(t==='inlineStr')v=xmlText(c);else if(vn){v=vn.textContent||'';if(t==='s')v=shared[Number(v)]??'';else if(t==='b')v=v==='1';else if(v!==''&&!isNaN(v))v=Number(v)}arr[idx]=v}matrix.push(arr)}if(matrix.length)all.push({name:sh.name,rows:matrix})}return all}
function uniqueHeaders(raw){const used={};return raw.map((x,i)=>{let h=normHeader(x)||`COL_${i+1}`;used[h]=(used[h]||0)+1;return used[h]===1?h:`${h}_${used[h]-1}`})}
function headerRowIndex(matrix){for(let i=0;i<Math.min(matrix.length,15);i++){if(findType((matrix[i]||[]).map(normHeader)))return i}return 0}
function matrixToObjects(matrix){if(!matrix.length)return[];const hi=headerRowIndex(matrix);const headers=uniqueHeaders(matrix[hi]);return matrix.slice(hi+1).filter(r=>r.some(v=>norm(v)!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])))}
function findType(headers){const h=headers.map(normHeader);const cityCol=h.includes('CITTA')||h.includes('LOCALITA')||h.includes('COMUNE');if((h.includes('RAGIONE SOCIALE 1')||h.includes('RAGIONE SOCIALE'))&&h.includes('INDIRIZZO')&&cityCol)return'clienti';if(h.includes('IMPORTO INEVASO'))return'ordini';if(h.includes('IMPORTO CONSEGNATO'))return'vendite';return null}
async function importFiles(files){
  if(!files.length)return;
  const status=$('#status');
  let imported=0,errors=[];
  const avevo=Object.keys(project.clients).length;
  if(avevo>0)migrateAgentBase();   // fissa la base degli override che non ce l'hanno ancora
  const lavorati=new Set(Object.entries(project.clients).filter(([id,c])=>c.bizType||c.agentOverride||c.note||c.manualPosition).map(([id])=>id));
  window.__seenClientIds=new Set();   // riempito da importClients
  status.textContent='Lettura Excel in corso…';
  await new Promise(r=>setTimeout(r,80));
  for(const file of files){
    try{
      status.textContent=`Lettura di ${file.name}…`;
      await new Promise(r=>setTimeout(r,30));
      const sheets=await readXlsx(file);
      let recognized=false;
      for(const sh of sheets){
        const rows=matrixToObjects(sh.rows);
        if(!rows.length)continue;
        const type=findType(Object.keys(rows[0]));
        if(!type)continue;
        recognized=true;
        if(type==='clienti')importClients(rows);
        if(type==='ordini')importOrders(rows);
        if(type==='vendite')importSales(rows);
        project.imports[type]={file:file.name,rows:rows.length,date:new Date().toISOString()};
        imported++;
      }
      if(!recognized)errors.push(`${file.name}: struttura non riconosciuta`);
    }catch(e){
      console.error(e);
      errors.push(`${file.name}: ${e.message||'errore di lettura'}`);
    }
  }
  try{
    project.updatedAt=new Date().toISOString();
    await persistProject();
  }catch(e){
    console.error(e);
    errors.push('Salvataggio locale non riuscito: spazio o permessi del browser insufficienti');
  }
  try{render()}catch(e){console.error(e);errors.push(`Visualizzazione: ${e.message||'errore'}`)}
  // Se stavo AGGIORNANDO (avevo già clienti e ho ricaricato l'anagrafica), controllo chi è sparito.
  let conservati=0,rimossi=0;
  if(avevo>0&&window.__seenClientIds&&window.__seenClientIds.size){
    const seen=window.__seenClientIds;
    for(const [id,c] of Object.entries(project.clients)){
      if(seen.has(id)||(c.saleLines&&c.saleLines.length)||(c.orderLines&&c.orderLines.length))continue;
      if(lavorati.has(id)){c.notInRegistry=true;conservati++;}   // classificato da te: lo tengo
      else{delete project.clients[id];rimossi++;}                 // vuoto e sparito: via
    }
  }
  window.__seenClientIds=null;
  const clients=Object.keys(project.clients).length;
  const mapped=Object.values(project.clients).filter(c=>c.lat!=null&&c.lng!=null).length;
  status.textContent=`${clients} clienti · ${mapped} mappati`;
  let msg=`Importazione terminata. File riconosciuti: ${imported}. Clienti nel progetto: ${clients}.`;
  if(avevo>0)msg+=`\n\nAggiornamento sui dati esistenti: le tue classificazioni (tipo attività, agente, note, posizioni) sono state mantenute.`;
  if(conservati)msg+=`\n${conservati} clienti che avevi classificato non sono più nell'anagrafica del gestionale: li ho conservati (senza vendite) così non perdi il lavoro.`;
  if(rimossi)msg+=`\n${rimossi} clienti non più presenti e senza tuo lavoro sono stati rimossi.`;
  if(clients>0&&mapped===0)msg+='\n\nIl file clienti non contiene coordinate geografiche. Per vedere i marker usa “Geocodifica mancanti”.';
  if(errors.length)msg+=`\n\nAvvisi:\n${errors.join('\n')}`;
  alert(msg);
  $('#excelInput').value='';
}

function ensure(id,name=''){id=canonId(id);if(!id||id==='00000')return null;return project.clients[id]??={id,name,emails:[],phones:[],orders:0,sales:0,orderLines:[],saleLines:[],saleYears:{},note:'',lat:null,lng:null,manualPosition:false}}
function importClients(rows){const ak=agentDescKey(rows);const seen=new Set();for(const r of rows){const id=canonId(r['CLIENTE']);if(!id||id==='00000')continue;if(window.__seenClientIds)window.__seenClientIds.add(id);const rs=norm(r['RAGIONE SOCIALE 1']||r['RAGIONE SOCIALE']);const c=ensure(id,rs);c.name=rs||c.name;c.address=norm(r['INDIRIZZO'])||c.address||'';c.city=norm(r['CITTA']||r['LOCALITA']||r['COMUNE'])||c.city||'';{const cap=norm(r['CAP']);c.cap=cap?cap.padStart(5,'0'):''}c.province=norm(r['PROVINCIA'])||c.province||'';c.agentCode=norm(r['AGENTE']);c.agent=(ak?norm(r[ak]):'')||(norm(r['AGENTE'])?`cod. ${norm(r['AGENTE'])}`:'');c.abc=norm(r['CLASSE ABC']);c.payment=norm(r['DESCRIZIONE ELEMENTO']);[r['NR.TELEFONICO'],r['NR.CELLULARE']].map(norm).filter(Boolean).forEach(x=>{if(!c.phones.includes(x))c.phones.push(x)});for(const em of splitEmails(r['EMAIL']))if(!c.emails.some(x=>x.toLowerCase()===em))c.emails.push(em);seen.add(id)}project.imports.clientiCount=seen.size}
function importOrders(rows){const dk=classDescKey(rows);for(const c of Object.values(project.clients)){c.orders=0;c.orderLines=[]}for(const r of rows){const c=ensure(r['CLIENTE'],r['CLIENTE_1']);if(!c)continue;const amount=num(r['IMPORTO INEVASO']);c.name=c.name||norm(r['CLIENTE_1']);c.orders+=amount;c.orderLines.push({order:norm(r['NUM.']),date:excelDate(r['DATA CREAZIONE']),delivery:excelDate(r['DATA CONSEGNA']),year:norm(r['ANNO']),article:norm(r['ARTICOLO']),cls:learnClass(r,dk),description:norm(r['DESCRIZIONE']),qty:num(r['QTA INEVASA']),amount})}}
function classDescKey(rows){const k=Object.keys(rows[0]||{});const i=k.indexOf('CLASSE 3 ARTICOLO');return i>=0&&k[i+1]?k[i+1]:null}
// La descrizione dell'agente è la colonna subito dopo AGENTE. Niente ripieghi su altre
// colonne: quando è vuota il gestionale non ha un nome, e inventarlo pescando dalla
// dilazione di pagamento produceva agenti fantasma tipo "30 A 180 GG".
function agentDescKey(rows){const k=Object.keys(rows[0]||{});const i=k.indexOf('AGENTE');return i>=0&&k[i+1]?k[i+1]:null}
function learnClass(r,dk){const code=norm(r['CLASSE 3 ARTICOLO']);if(!code)return'';if(dk){const d=norm(r[dk]);if(d){project.classes??={};project.classes[code]=d}}return code}
function importSales(rows){const dk=classDescKey(rows);for(const c of Object.values(project.clients)){c.sales=0;c.saleYears={};c.saleLines=[]}for(const r of rows){const c=ensure(r['CLIENTE'],r['RAGIONE SOCIALE 1']);if(!c)continue;const amount=num(r['IMPORTO CONSEGNATO']);const year=norm(r['ANNO SPEDIZIONE']);c.name=c.name||norm(r['RAGIONE SOCIALE 1']);c.sales+=amount;c.saleYears[year]=(c.saleYears[year]||0)+amount;c.saleLines.push({shipment:norm(r['NUMERO SPEDIZIONE']),date:excelDate(r['DATA SPEDIZIONE']),year,article:norm(r['ARTICOLO']),cls:learnClass(r,dk),description:norm(r['DESCRIZIONE']),qty:num(r['QTA CONSEGNATA']),amount})}}
let REF_YEAR=0;


function toggleTour(id){project.tour??=[];const i=project.tour.indexOf(id);if(i>=0)project.tour.splice(i,1);else{if(project.tour.length>=30)return alert('Massimo 30 tappe per giro.');project.tour.push(id)}save()}
function tourAddFiltered(){project.tour??=[];const room=30-project.tour.length;if(room<=0)return alert('Massimo 30 tappe per giro.');const add=filtered().filter(c=>c.lat!=null&&!project.tour.includes(c.id)).slice(0,room);if(!add.length)return alert('Nessun cliente mappato da aggiungere nel filtro corrente.');add.forEach(c=>project.tour.push(c.id));save()}
function haversine(a,b){const R=6371,rad=x=>x*Math.PI/180;const dLat=rad(b[0]-a[0]),dLng=rad(b[1]-a[1]);const t=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(t))}
function nearestOrder(stops,start){const rest=[...stops],out=[];let pos=start;while(rest.length){let bi=0,bd=Infinity;rest.forEach((s,i)=>{const d=haversine(pos,[s.lat,s.lng]);if(d<bd){bd=d;bi=i}});const nxt=rest.splice(bi,1)[0];out.push(nxt);pos=[nxt.lat,nxt.lng]}return out}




function landmass(p){const la=p.lat,ln=p.lng;if(la==null)return'continente';if(la>=38.8&&la<=41.35&&ln>=8.0&&ln<=9.95)return'sardegna';if(la<=38.82&&ln<=15.63)return'sicilia';return'continente'}
const LAND_LABEL={continente:'Continente',sardegna:'Sardegna',sicilia:'Sicilia'};
function routeKm(start,stops){let km=0,pos=start;for(const s of stops){km+=haversine(pos,[s.lat,s.lng]);pos=[s.lat,s.lng]}return km}
function twoOpt(stops,start){let route=stops.slice(),improved=true;const P=x=>[x.lat,x.lng];while(improved){improved=false;for(let i=0;i<route.length-1;i++){for(let k=i+1;k<route.length;k++){const A=i===0?start:P(route[i-1]),B=P(route[i]),C=P(route[k]),D=k+1<route.length?P(route[k+1]):null;const before=haversine(A,B)+(D?haversine(C,D):0),after=haversine(A,C)+(D?haversine(B,D):0);if(after+1e-9<before){route=route.slice(0,i).concat(route.slice(i,k+1).reverse(),route.slice(k+1));improved=true}}}}return route}
function tourSegments(){const stops=(project.tour||[]).map(id=>project.clients[id]).filter(c=>c&&c.lat!=null);const segs=[];for(const c of stops){const lm=landmass(c);if(!segs.length||segs[segs.length-1].land!==lm)segs.push({land:lm,stops:[]});segs[segs.length-1].stops.push(c)}return segs}



function tourKmData(){if(project.tourKm&&project.tourKmHash===(project.tour||[]).join(','))return{segs:project.tourKm,real:true};const segs=tourSegments().map(seg=>{const from=[seg.stops[0].lat,seg.stops[0].lng];return{land:seg.land,km:Math.round(routeKm(from,seg.stops)*1.3),real:false,n:seg.stops.length}});return{segs,real:false}}
function tourCosts(){project.costParams??={consumo:7,prezzo:1.90,pedaggio:0.095,quota:60};const p=project.costParams;const{segs}=tourKmData();const tot=segs.reduce((a,x)=>a+x.km,0);const kmCont=segs.filter(x=>x.land==='continente').reduce((a,x)=>a+x.km,0);const fuel=tot/100*p.consumo*p.prezzo;const toll=kmCont*(p.quota/100)*p.pedaggio;return{tot,segs,fuel,toll,total:fuel+toll,anyEst:segs.some(x=>!x.real)}}

function tourIsOptimized(){return!!project.tourKmHash&&project.tourKmHash===(project.tour||[]).join(',')}
function decimate(coords,max=400){if(coords.length<=max)return coords;const step=(coords.length-1)/(max-1),out=[];for(let i=0;i<max;i++)out.push(coords[Math.round(i*step)]);return out}
async function osrmRoute(points){try{const coords=points.map(p=>`${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(';');const res=await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);const d=await res.json();if(d.code==='Ok'&&d.routes&&d.routes[0])return{km:d.routes[0].distance/1000,coords:decimate(d.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]))}}catch(e){console.warn('OSRM non disponibile',e)}return null}
async function optimizeTour(){const all=(project.tour||[]).map(id=>project.clients[id]).filter(Boolean);const noGeo=all.filter(c=>c.lat==null);const stops=all.filter(c=>c.lat!=null);if(stops.length<1)return alert('Aggiungi al giro almeno un cliente con coordinate (geocodificalo prima).');
$('#status').textContent='Ottimizzo il percorso…';
let start=project.tourStart||null;
const groups={};for(const c of stops)(groups[landmass(c)]??=[]).push(c);
const startLand=start?landmass({lat:start[0],lng:start[1]}):landmass(stops[0]);
const order=Object.keys(groups).sort((a,b)=>(a===startLand?-1:b===startLand?1:groups[b].length-groups[a].length));
const orderedAll=[],segKm=[],segGeom=[];
for(const land of order){let g=groups[land];const from=land===startLand&&start?start:[g[0].lat,g[0].lng];
g=nearestOrder(g,from);g=twoOpt(g,from);orderedAll.push(...g);
const pts=(land===startLand&&start?[start]:[]).concat(g.map(c=>[c.lat,c.lng]));
let km=null,coords=null;if(pts.length>=2){const r=await osrmRoute(pts);if(r){km=r.km;coords=r.coords}}
let real=true;if(km==null){km=pts.length>=2?routeKm(pts[0],g.slice(land===startLand&&start?0:1))*1.3:0;real=false;coords=null}
segKm.push({land,km:Math.round(km),real,n:g.length});if(coords)segGeom.push({land,coords})}
project.tour=[...orderedAll.map(c=>c.id),...noGeo.map(c=>c.id)];project.tourKm=segKm;project.tourGeom=segGeom;project.tourKmHash=project.tour.join(',');
await save();
const tot=segKm.reduce((a,x)=>a+x.km,0);const parts=segKm.map(x=>`${LAND_LABEL[x.land]} ${x.km} km${x.real?'':' (stima)'}`).join(' · ');
$('#status').textContent=`Percorso ottimizzato: ${orderedAll.length} tappe, ~${tot} km — ${parts}${segKm.length>1?' · ⛴ tra le sezioni serve traghetto/volo':''}${noGeo.length?` · ${noGeo.length} tappe senza coordinate escluse`:''}`}
function tourNavLinks(){const segs=tourSegments();const links=[];for(const seg of segs){const first=segs[0]===seg;const pts=[];if(project.tourStart&&first&&landmass({lat:project.tourStart[0],lng:project.tourStart[1]})===seg.land)pts.push({lat:project.tourStart[0],lng:project.tourStart[1]});pts.push(...seg.stops);
if(seg.stops.length===1&&pts.length<2){const c=seg.stops[0];links.push({label:`${LAND_LABEL[seg.land]} (1 tappa)`,url:`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving`});continue}
let i=0,leg=1;while(i<pts.length-1){const part=pts.slice(i,i+11);const o=part[0],d=part[part.length-1];const wps=part.slice(1,-1).map(c=>`${c.lat},${c.lng}`).join('|');const multi=pts.length>11;links.push({label:`${LAND_LABEL[seg.land]}${multi?` – tratta ${leg}`:''} (${part.length-1} tappe)`,url:`https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}${wps?`&waypoints=${encodeURIComponent(wps)}`:''}&travelmode=driving`});i+=part.length-1;leg++}}return links}
function renderTour(){const el=$('#tourList');if(!el)return;project.tour??=[];project.tour=project.tour.filter(id=>project.clients[id]);const stops=project.tour.map(id=>project.clients[id]);$('#tourCount').textContent=stops.length?`(${stops.length})`:'';
el.innerHTML=stops.map((c,i)=>`<div class="tour-stop"><span class="tour-num${landmass(c)!=='continente'?' island':''}">${i+1}</span><span class="tour-name">${escapeHtml(c.name||c.id)}${c.lat==null?' <span class="badge missing">no coord.</span>':''}</span><button type="button" class="mini" data-rm="${c.id}">×</button></div>`).join('')||'<small>Nessuna tappa. Aggiungi clienti con "+ Giro" dall\'elenco o dalla scheda.</small>';
el.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>toggleTour(b.dataset.rm));
const optimized=tourIsOptimized();
$('#tourLinks').innerHTML=optimized?tourNavLinks().map(l=>`<a class="button" target="_blank" rel="noopener" href="${l.url}">${escapeHtml(l.label)}</a>`).join(''):(stops.length>=2?'<p style="margin:6px 0 0;font-size:12px;color:#b45309">⚠️ Giro modificato: premi <b>Ottimizza percorso</b> per ricalcolare ordine, km e link di navigazione.</p>':'');
if(stops.length>=2){const c=tourCosts();const p=project.costParams;$('#costConsumo').value=p.consumo;$('#costPrezzo').value=p.prezzo;$('#costPedaggio').value=p.pedaggio;$('#costQuota').value=p.quota;
$('#tourStats').innerHTML=`<div class="detail-box"><span>Distanza${c.anyEst?' (stima — premi Ottimizza per km stradali reali)':' (km stradali reali)'}</span><b>${c.tot} km${c.segs.length>1?' — '+c.segs.map(x=>`${LAND_LABEL[x.land]} ${x.km}`).join(' · ')+' ⛴':''}</b></div><div class="detail-box"><span>Carburante (${p.consumo} l/100km × ${p.prezzo} €/l)</span><b>${c.fuel.toFixed(0)} €</b></div><div class="detail-box"><span>Pedaggi (solo continente, ${p.quota}% autostrada × ${p.pedaggio} €/km)</span><b>${c.toll.toFixed(0)} €</b></div><div class="detail-box"><span>Costo viaggio stimato</span><b>${c.total.toFixed(0)} €</b></div>`}else $('#tourStats').innerHTML='';
if(tourLayer&&typeof L!=='undefined'){tourLayer.clearLayers();const numOf=new Map();stops.forEach((c,i)=>numOf.set(c.id,i+1));
if(optimized){if(project.tourGeom&&project.tourGeom.length){for(const g of project.tourGeom)L.polyline(g.coords,{color:'#1d4ed8',weight:4,opacity:.85}).addTo(tourLayer)}else{for(const seg of tourSegments()){const first=tourSegments()[0]===seg;const line=(project.tourStart&&first&&landmass({lat:project.tourStart[0],lng:project.tourStart[1]})===seg.land?[project.tourStart]:[]).concat(seg.stops.map(c=>[c.lat,c.lng]));if(line.length>1)L.polyline(line,{color:'#1d4ed8',weight:3,dashArray:'6 6',opacity:.8}).addTo(tourLayer)}}}
for(const c of stops)if(c.lat!=null)L.marker([c.lat,c.lng],{icon:L.divIcon({className:'',html:`<div class="tour-pin${optimized?'':' stale'}">${numOf.get(c.id)}</div>`,iconSize:[22,22],iconAnchor:[11,11]}),interactive:false,zIndexOffset:1000}).addTo(tourLayer)}}
const PROV2REG={AQ:'Abruzzo',CH:'Abruzzo',PE:'Abruzzo',TE:'Abruzzo',MT:'Basilicata',PZ:'Basilicata',CS:'Calabria',CZ:'Calabria',KR:'Calabria',RC:'Calabria',VV:'Calabria',AV:'Campania',BN:'Campania',CE:'Campania',NA:'Campania',SA:'Campania',BO:'Emilia-Romagna',FC:'Emilia-Romagna',FE:'Emilia-Romagna',MO:'Emilia-Romagna',PC:'Emilia-Romagna',PR:'Emilia-Romagna',RA:'Emilia-Romagna',RE:'Emilia-Romagna',RN:'Emilia-Romagna',GO:'Friuli-Venezia Giulia',PN:'Friuli-Venezia Giulia',TS:'Friuli-Venezia Giulia',UD:'Friuli-Venezia Giulia',FR:'Lazio',LT:'Lazio',RI:'Lazio',RM:'Lazio',VT:'Lazio',GE:'Liguria',IM:'Liguria',SP:'Liguria',SV:'Liguria',BG:'Lombardia',BS:'Lombardia',CO:'Lombardia',CR:'Lombardia',LC:'Lombardia',LO:'Lombardia',MB:'Lombardia',MI:'Lombardia',MN:'Lombardia',PV:'Lombardia',SO:'Lombardia',VA:'Lombardia',AN:'Marche',AP:'Marche',FM:'Marche',MC:'Marche',PU:'Marche',CB:'Molise',IS:'Molise',AL:'Piemonte',AT:'Piemonte',BI:'Piemonte',CN:'Piemonte',NO:'Piemonte',TO:'Piemonte',VB:'Piemonte',VC:'Piemonte',BA:'Puglia',BR:'Puglia',BT:'Puglia',FG:'Puglia',LE:'Puglia',TA:'Puglia',CA:'Sardegna',NU:'Sardegna',OR:'Sardegna',SS:'Sardegna',SU:'Sardegna',CI:'Sardegna',VS:'Sardegna',OT:'Sardegna',OG:'Sardegna',AG:'Sicilia',CL:'Sicilia',CT:'Sicilia',EN:'Sicilia',ME:'Sicilia',PA:'Sicilia',RG:'Sicilia',SR:'Sicilia',TP:'Sicilia',AR:'Toscana',FI:'Toscana',GR:'Toscana',LI:'Toscana',LU:'Toscana',MS:'Toscana',PI:'Toscana',PO:'Toscana',PT:'Toscana',SI:'Toscana',BZ:'Trentino-Alto Adige',TN:'Trentino-Alto Adige',PG:'Umbria',TR:'Umbria',AO:"Valle d'Aosta",BL:'Veneto',PD:'Veneto',RO:'Veneto',TV:'Veneto',VE:'Veneto',VI:'Veneto',VR:'Veneto'};
const provOf=c=>norm(c.province).toUpperCase();
const regionOf=p=>PROV2REG[p]||(p?'Altro/Estero':'');
const geoSel={regions:new Set(),provinces:new Set()};
let _geoSig='';
function updateGeoSummaries(){$('#regionSummary').textContent=geoSel.regions.size?`Regioni (${geoSel.regions.size})`:'Tutte le regioni';$('#provinceSummary').textContent=geoSel.provinces.size?`Province (${geoSel.provinces.size})`:'Tutte le province'}
function renderGeoFilters(all){const provs={};for(const c of all){const p=provOf(c);if(p)provs[p]=(provs[p]||0)+1}
const sig=Object.keys(provs).sort().join(',');
const regions={};for(const[p,n]of Object.entries(provs)){const r=regionOf(p);regions[r]=(regions[r]||0)+n}
const visibleProvs=Object.keys(provs).filter(p=>!geoSel.regions.size||geoSel.regions.has(regionOf(p))).sort();
for(const p of[...geoSel.provinces])if(!visibleProvs.includes(p))geoSel.provinces.delete(p);
$('#regionList').innerHTML=Object.keys(regions).sort().map(r=>`<label class="multi-item"><input type="checkbox" data-region="${escapeHtml(r)}" ${geoSel.regions.has(r)?'checked':''}> ${escapeHtml(r)} <span class="count">${regions[r]}</span></label>`).join('')||'<small>Nessuna provincia nei dati</small>';
$('#provinceList').innerHTML=visibleProvs.map(p=>`<label class="multi-item"><input type="checkbox" data-prov="${escapeHtml(p)}" ${geoSel.provinces.has(p)?'checked':''}> ${escapeHtml(p)} — ${escapeHtml(regionOf(p))} <span class="count">${provs[p]}</span></label>`).join('')||'<small>Nessuna provincia</small>';
document.querySelectorAll('#regionList input').forEach(x=>x.onchange=()=>{const r=x.dataset.region;x.checked?geoSel.regions.add(r):geoSel.regions.delete(r);_geoSig='';render()});
document.querySelectorAll('#provinceList input').forEach(x=>x.onchange=()=>{const p=x.dataset.prov;x.checked?geoSel.provinces.add(p):geoSel.provinces.delete(p);updateGeoSummaries();render()});
updateGeoSummaries();_geoSig=sig+'|'+[...geoSel.regions].join(',')}
const EMAIL_RE=/^[^\s@;,]+@[^\s@;,]+\.[a-z]{2,}$/i;
function splitEmails(v){return String(v??'').split(/[;,/\s]+/).map(x=>x.trim().replace(/^mailto:/i,'').replace(/^[<(\[]+|[>)\]]+$/g,'').toLowerCase()).filter(x=>EMAIL_RE.test(x))}
const isPec=e=>/(^|[.@])pec\.|@.*\bpec\b|legalmail|@pec\.|^(amministrazione|contabilita|contabilit\u00e0|fatture|fatturazione|ragioneria)@/i.test(e);
function emailKey(id,em){return`${id}|${em.toLowerCase()}`}
function isEmailOff(id,em){return(project.emailsOff||[]).includes(emailKey(id,em))}
function setEmailOff(id,em,off){project.emailsOff??=[];const k=emailKey(id,em),i=project.emailsOff.indexOf(k);if(off&&i<0)project.emailsOff.push(k);if(!off&&i>=0)project.emailsOff.splice(i,1)}
function mailRows(){const out=[];for(const c of filtered())for(const em of(c.emails||[]))if(!isEmailOff(c.id,em))out.push({c,em});return out}
function mailUnique(){const seen=new Set(),out=[];for(const r of mailRows()){const k=r.em.toLowerCase();if(seen.has(k))continue;seen.add(k);out.push(r)}return out}
function csvCell(v){const s=String(v??'');return/[";,\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function download(name,text,mime='text/csv;charset=utf-8'){const blob=new Blob([text],{type:mime});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
function exportMail(){const rows=mailUnique();if(!rows.length)return alert('Nessun indirizzo email nei clienti filtrati (controlla i filtri o le esclusioni).');
const head=['EMAIL','RAGIONE SOCIALE','CODICE CLIENTE','CITTA','PROVINCIA','REGIONE','AGENTE','CLASSE ABC','STATO','TIPO ATTIVITA','CLASSIFICATO DA','ACQUISTI','ANNI MACCHINA','ULTIMA MACCHINA','VENDITE','ORDINI APERTI'];
const body=rows.map(({c,em})=>{const a=macAgeYears(c);return [em,c.name,c.id,c.city||'',c.province||'',regionOf(provOf(c)),agentOf(c),c.abc||'',clientStatus(c).status||'',bizOf(c)?BIZ[bizOf(c)]:(guessBiz(c)?BIZ[guessBiz(c)]:''),bizOf(c)?'impostato':(guessBiz(c)?'suggerito dal nome':''),behaviorOf(c).label,a!=null?a.toFixed(1).replace('.',','):'',lastMacDesc(c),Math.round(c.sales||0),Math.round(c.orders||0)].map(csvCell).join(',')});
const csv='\ufeff'+[head.join(','),...body].join('\r\n');
const d=new Date().toISOString().slice(0,10);
download(`mailing-list_${d}.csv`,csv);
$('#status').textContent=`Esportati ${rows.length} indirizzi univoci (${filtered().length} clienti filtrati).`}
async function copyMail(){const rows=mailUnique();if(!rows.length)return alert('Nessun indirizzo email nei clienti filtrati.');const txt=rows.map(r=>r.em).join('; ');try{await navigator.clipboard.writeText(txt);$('#status').textContent=`${rows.length} indirizzi copiati negli appunti (incollali nel campo CCN).`}catch{prompt('Copia gli indirizzi:',txt)}}
function renderMailPanel(){const el=$('#mailPanel');if(!el)return;const cl=filtered(),withMail=cl.filter(c=>(c.emails||[]).length);const rows=mailUnique(),tot=cl.reduce((a,c)=>a+(c.emails||[]).length,0),off=tot-mailRows().length;
$('#mailCount').textContent=rows.length?`(${rows.length})`:'';
$('#mailInfo').innerHTML=`<div class="mail-info"><b>${rows.length}</b> indirizzi univoci da <b>${withMail.length}</b> clienti su ${cl.length} filtrati${off?` · <span class="muted">${off} esclusi</span>`:''}${cl.length-withMail.length?` · <span class="muted">${cl.length-withMail.length} senza email</span>`:''}</div>`}
function renderMailDialog(){const cl=filtered().filter(c=>(c.emails||[]).length);
$('#mailList').innerHTML=cl.map(c=>`<div class="mail-client"><div class="mail-name">${escapeHtml(c.name||c.id)} <span class="muted">${escapeHtml(c.city||'')} ${escapeHtml(c.province||'')}</span></div>${(c.emails||[]).map(em=>`<label class="multi-item"><input type="checkbox" data-id="${c.id}" data-em="${escapeHtml(em)}" ${isEmailOff(c.id,em)?'':'checked'}> ${escapeHtml(em)}${isPec(em)?' <span class="badge">PEC/amm.</span>':''}</label>`).join('')}</div>`).join('')||'<small>Nessun cliente con email nel filtro corrente.</small>';
$('#mailList').querySelectorAll('input').forEach(x=>x.onchange=()=>{setEmailOff(x.dataset.id,x.dataset.em,!x.checked);save()})}
function mailBulk(mode){for(const c of filtered())for(const em of(c.emails||[])){if(mode==='all')setEmailOff(c.id,em,false);else if(mode==='none')setEmailOff(c.id,em,true);else if(mode==='nopec'&&isPec(em))setEmailOff(c.id,em,true)}save();renderMailDialog()}
function renderStart(){const el=$('#startInfo');if(!el)return;const s=project.tourStart;el.innerHTML=s?`<small class="start-ok">Partenza: ${escapeHtml(project.tourStartLabel||`${s[0].toFixed(4)}, ${s[1].toFixed(4)}`)}</small>`:'<small class="muted">Nessuna partenza impostata: il percorso parte dalla prima tappa. Usa 📍 GPS o scrivi un indirizzo.</small>';if($('#startAddr')&&document.activeElement!==$('#startAddr'))$('#startAddr').value=project.tourStartLabel&&!project.tourStartGps?project.tourStartLabel:''}
function invalidateRoute(){project.tourKmHash='';project.tourGeom=null}
async function setStartGps(){$('#status').textContent='Rilevo la posizione…';try{const pos=await new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(res,rej,{timeout:10000,enableHighAccuracy:true}):rej(new Error('GPS non disponibile')));project.tourStart=[pos.coords.latitude,pos.coords.longitude];project.tourStartLabel='Posizione attuale (GPS)';project.tourStartGps=true;invalidateRoute();await save();$('#status').textContent='Partenza impostata sulla posizione attuale. Premi Ottimizza percorso.'}catch(e){$('#status').textContent='';alert('Posizione non disponibile. Consenti l\u2019accesso alla posizione nel browser, oppure scrivi un indirizzo di partenza.')}}
async function setStartAddr(){const q=norm($('#startAddr').value);if(!q){project.tourStart=null;project.tourStartLabel='';project.tourStartGps=false;invalidateRoute();return save()}
$('#status').textContent='Cerco l\u2019indirizzo di partenza…';
try{const res=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(q)}`,{headers:{'Accept-Language':'it'}});const d=await res.json();
if(!d[0]){$('#status').textContent='';return alert('Indirizzo di partenza non trovato. Prova con "via, città" oppure con il CAP.')}
project.tourStart=[Number(d[0].lat),Number(d[0].lon)];project.tourStartLabel=d[0].display_name.split(',').slice(0,3).join(',').trim();project.tourStartGps=false;invalidateRoute();await save();
$('#status').textContent=`Partenza: ${project.tourStartLabel}. Premi Ottimizza percorso.`}catch(e){$('#status').textContent='';alert('Ricerca non riuscita: serve connessione a internet.')}}
const WIN=new Map();let REF_END=0,REF_LABEL='',STATS_SIG='';
function parseDMY(v){const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v||'').trim());return m?Date.UTC(+m[3],+m[2]-1,+m[1]):null}
const DAY=86400000;

function monthsSince(t){return t?Math.max(0,Math.round((REF_END-t)/(30.44*DAY))):null}

const APP_VERSION='v14.17';
function setVerBadge(txt,cls){const el=$('#verBadge');if(!el)return;el.textContent=txt;el.className='ver'+(cls?' '+cls:'')}
function showUpdateBanner(){updatePending=true;refreshInstallUI();if($('#updBanner'))return;const d=document.createElement('div');d.id='updBanner';d.className='upd-banner';
 d.innerHTML=`<span>È disponibile una versione più recente di Maps APP.</span><button type="button" id="updNow">Aggiorna ora</button>`;
 document.body.appendChild(d);$('#updNow').onclick=async()=>{const b=$('#updNow');if(b){b.disabled=true;b.textContent='Aggiornamento…'}
  try{await saveQueue}catch(e){}
  if(pendingWrites>0)await new Promise(r=>{const t=setInterval(()=>{if(pendingWrites===0){clearInterval(t);r()}},100);setTimeout(()=>{clearInterval(t);r()},5000)});
  try{if('caches'in window){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}
   if('serviceWorker'in navigator){const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister()}}catch(e){}
  // ricarico su un URL con bypass della cache HTTP, altrimenti il browser rispolvera i file vecchi
  location.replace(location.pathname+'?fresh='+Date.now())};}
const SW_EXPECTED='maps-app-v14-17-rel';
async function checkVersion(){setVerBadge(APP_VERSION);
 try{const res=await fetch('sw.js?ts='+Date.now(),{cache:'no-store'});const m=/const CACHE='([^']+)'/.exec(await res.text());
  if(m&&m[1]!==SW_EXPECTED){setVerBadge(APP_VERSION+' \u2022 disponibile: '+m[1].replace('maps-app-',''),'stale');showUpdateBanner()}}catch(e){}}
const TOP_12M=20000,CALO_RATIO=0.6,CALO_MIN=3000;

function monthsSince(t){return t?Math.max(0,Math.round((REF_END-t)/(30.44*DAY))):null}

function isTop(c){const w=WIN.get(c.id);return (w?w.a:0)>=TOP_12M}
function computeRefYear(force){const sig=`${Object.keys(project.clients).length}|${project.updatedAt||''}`;if(!force&&sig===STATS_SIG&&WIN.size)return;STATS_SIG=sig;
let y=0,maxT=0;const all=Object.values(project.clients);
for(const c of all){for(const k of Object.keys(c.saleYears||{})){const n=num(k);if(n>y)y=n}for(const l of c.saleLines||[]){const t=parseDMY(l.date);if(t&&t>maxT&&t<=Date.now()+DAY)maxT=t}}
REF_YEAR=y;REF_END=maxT||Date.now();
const w1=REF_END-365*DAY,w2=REF_END-730*DAY,h1=REF_END-182*DAY,h2=REF_END-547*DAY,h3=REF_END-365*DAY;
WIN.clear();
for(const c of all){let a=0,b=0,a6=0,b6=0,last=0,dated=false;
for(const l of c.saleLines||[]){const t=parseDMY(l.date);if(!t)continue;dated=true;if(t>last)last=t;const v=num(l.amount);
 if(t>w1)a+=v;else if(t>w2)b+=v;
 if(t>h1)a6+=v;else if(t>h2&&t<=h3)b6+=v}
// portafoglio ordini aperto = domanda del periodo corrente, assegnata per data di creazione
let oa=0,oa6=0;
for(const l of c.orderLines||[]){const v=num(l.amount);const t=parseDMY(l.date);
 if(!t){oa+=v;oa6+=v;continue}
 if(t>w1)oa+=v;
 if(t>h1)oa6+=v}
WIN.set(c.id,{a,b,a6,b6,oa,oa6,last,dated})}
REF_LABEL=maxT?`12 mesi al ${new Date(REF_END).toLocaleDateString('it-IT')}`:`anno ${REF_YEAR}`}
function monthsSince(t){return t?Math.max(0,Math.round((REF_END-t)/(30.44*DAY))):null}
function caloLabel(pct,parts){const p=parts.filter(Boolean);return `In calo ${Math.round(pct)}%${p.length?` (${p.join(', ')})`:''}`}
function clientStatus(c){const w=WIN.get(c.id);const hasOpen=(c.orders||0)>0;const sales=c.sales||0;
let cur,prev,dated=!!(w&&w.dated);const oa=w?w.oa:0,oa6=w?w.oa6:0;
if(dated){cur=w.a;prev=w.b}
else{const thisYear=new Date().getUTCFullYear();const ref=REF_YEAR>=thisYear?REF_YEAR-1:REF_YEAR;if(!ref)return{status:'',label:''};
 cur=(c.saleYears?.[ref]||0)+(REF_YEAR>=thisYear?(c.saleYears?.[REF_YEAR]||0):0);prev=c.saleYears?.[ref-1]||0}
if(sales>0&&cur===0&&!hasOpen){const m=dated?monthsSince(w.last):null;return{status:'dormiente',label:m?`Dormiente da ${m} mesi`:'Dormiente'}}
// il calo confronta il consegnato, ma somma gli ordini in corso al periodo attuale:
// un cliente con ordini in portafoglio non sta abbandonando, la consegna deve ancora avvenire
if(dated&&w.b6>=CALO_MIN&&(w.a6+oa6)<w.b6*CALO_RATIO)return{status:'calo',label:caloLabel(((w.a6+oa6)-w.b6)/w.b6*100,['ultimi 6 mesi',oa6>0&&'ordini inclusi'])};
if(prev>=CALO_MIN&&(cur+oa)<prev*CALO_RATIO)return{status:'calo',label:caloLabel(((cur+oa)-prev)/prev*100,[dated&&'12 mesi',oa>0&&'ordini inclusi'])};
if(sales>0||hasOpen)return{status:'attivo',label:''};
return{status:'',label:''}}
function isTop(c){const w=WIN.get(c.id);return (w?w.a:0)>=TOP_12M}
const CLS_ACC=/ACCESSOR|RICAMB|COMPONENTI/i, CLS_MAC=/PONTI|SMONTAGOMME|EQUILIBRATRIC|ASSETT|SOLLEVATOR|PROFILOMETRO|USAT|SANIFICATOR/i;
const TIPO={rivenditore:'Rivenditore',ricorrente:'Cliente ricorrente',utilizzatore:'Utilizzatore finale',accessori:'Solo accessori/ricambi'};
function clsKind(code){if(!code)return'';const d=(project.classes||{})[code]||'';if(CLS_ACC.test(d))return'acc';if(CLS_MAC.test(d))return'mac';return'altro'}
function hasClassData(){return Object.keys(project.classes||{}).length>0}
function macEvents(c){const g=[...new Set((c.saleLines||[]).filter(l=>clsKind(l.cls)==='mac').map(l=>parseDMY(l.date)).filter(Boolean))].sort((a,b)=>a-b);const ev=[];for(const t of g){if(!ev.length||t-ev[ev.length-1]>90*DAY)ev.push(t)}return ev}

function macAgeYears(c){const t=clientType(c).last;return t?(REF_END-t)/(365.25*DAY):null}
function lastMacDesc(c){const ev=clientType(c).ev;if(!ev.length)return'';const t=ev[ev.length-1];
 const l=(c.saleLines||[]).find(x=>clsKind(x.cls)==='mac'&&parseDMY(x.date)===t);
 return l?`${l.description||''} (${new Date(t).toLocaleDateString('it-IT')})`:''}
const BIZ={officina:'Officina / autoriparazione',gommista:'Gommista / pneumatici',carrozzeria:'Carrozzeria',concessionaria:'Concessionaria / autosalone',rivenditore:'Rivenditore / distributore',service:'Service / assistenza tecnica',trasporti:'Trasporti / noleggio',agente:'Agente / intermediario',altro:'Altro'};
// Suggerimento dal nome: è solo un'ipotesi, va confermata dall'agente. Ordine = priorità.
// L'ordine conta: chi vende attrezzature vince su parole generiche come GARAGE o MECCANICA,
// perché "GARAGE EQUIPMENT" e "X FORNITURE" sono rivenditori, non officine.
const BIZ_RX=[
 ['rivenditore',/RICAMB|FORNITUR|ATTREZZATUR|DISTRIBUZ|DISTRIBUT|INGROSSO|GROSSIST|\bUTENSIL|EQUIPMENT|\bCOMMERCIO\b/i],
 ['carrozzeria',/CARROZZ/i],
 ['gommista',/\bGOMM|PNEUMATIC|\bTYRE|GOMMIST/i],
 ['concessionaria',/CONCESSIONAR|AUTOSALON|\bMOTORS\b/i],
 ['officina',/OFFICIN|AUTORIPARAZ|AUTOSERVIZ|\bGARAGE\b|MECCANIC|AUTOMECCANIC/i],
 ['trasporti',/TRASPORT|AUTOTRASP|LOGISTIC|NOLEGG|\bRENT\b/i],
 ['agente',/\bAGENZIA\b|\bAGENTE\b|RAPPRESENT/i],
 ['service',/\bSERVICE\b|ASSISTENZ|\bASSISTANCE\b|MANUTENZ|\bTECNIC/i]];
function guessBiz(c){const n=(c.name||'').toUpperCase();for(const[k,rx]of BIZ_RX)if(rx.test(n))return k;return ''}
function bizOf(c){return c.bizType||''}
function bizLabel(c){const b=bizOf(c);if(b)return BIZ[b]||b;const g=guessBiz(c);return g?`${BIZ[g]} (da confermare)`:''}
// Comportamento d'acquisto: FATTO, non ipotesi
function behaviorOf(c){const ev=macEvents(c);
 if(ev.length>=2)return{k:'ripetuto',label:`${ev.length} macchine acquistate`,n:ev.length};
 if(ev.length===1)return{k:'singolo',label:'1 sola macchina acquistata',n:1};
 if((c.saleLines||[]).some(l=>clsKind(l.cls)==='acc'))return{k:'accessori',label:'Solo accessori/ricambi',n:0};
 return{k:'',label:'',n:0}}
function clientType(c){const ev=macEvents(c);return{tipo:behaviorOf(c).k,label:bizLabel(c),ev,last:ev.length?ev[ev.length-1]:0}}
function fillBizHint(c){const g=guessBiz(c),h=$('#detailBizHint');if(!h)return;
 const beh=behaviorOf(c),a=macAgeYears(c);
 const fatti=[beh.label,a!=null?`ultima ${a.toFixed(1)} anni fa`:''].filter(Boolean).join(' \u00b7 ');
 const stato=c.bizType?'<b style="color:#166534">Impostato da te</b>, vince su ogni suggerimento.'
   :(g?`Suggerimento dal nome: <b>${escapeHtml(BIZ[g])}</b> \u2014 <b style="color:#b45309">da confermare</b>: il nome inganna (\u201cLA NUOVA MECCANICA\u201d \u00e8 un rivenditore).`
      :'Non deducibile dal nome: scegli tu, o usa <b>Cerca online</b> per verificare.');
 h.innerHTML=stato+(fatti?` <span style="color:#6b7280">\u00b7 Acquisti: ${escapeHtml(fatti)}</span>`:'');}

function renderBizPanel(){const f=filtered();const set=f.filter(c=>bizOf(c)).length,gue=f.filter(c=>!bizOf(c)&&guessBiz(c)).length,no=f.length-set-gue;
 const el=$('#bizCount');if(el)el.textContent=`(${f.length})`;
 const i=$('#bizInfo');if(i)i.innerHTML=`<div class="mail-info"><b>${set}</b> impostati da te \u00b7 <b>${gue}</b> con suggerimento da confermare \u00b7 <b>${no}</b> da classificare</div>`}
const BIZ_MAX=250;   // oltre, la finestra diventa pesante: si restringe con i filtri
function bizRows(onlyTodo){const f=filtered().slice().sort((a,b)=>(b.sales||0)-(a.sales||0));
 return onlyTodo?f.filter(c=>!bizOf(c)):f}
let bizTodoOnly=false;
function renderBizList(){const all=bizRows(bizTodoOnly),rows=all.slice(0,BIZ_MAX),box=$('#bizList');if(!box)return;
 const opts=c=>Object.entries(BIZ).map(([k,v])=>`<option value="${k}"${bizOf(c)===k?' selected':''}>${escapeHtml(v)}</option>`).join('');
 box.innerHTML=rows.length?rows.map(c=>{const g=guessBiz(c),b=bizOf(c);
  return `<div class="biz-row"><div class="biz-name"><b>${escapeHtml(c.name||c.id)}</b><small>${escapeHtml([c.city,c.province].filter(Boolean).join(' '))} \u00b7 ${euro(c.sales||0)} \u00b7 ${escapeHtml(behaviorOf(c).label||'nessun acquisto')}</small></div>
  <select class="biz-sel" data-id="${escapeHtml(c.id)}"><option value="">${g?'\u2014 suggerito: '+escapeHtml(BIZ[g])+' \u2014':'\u2014 da classificare \u2014'}</option>${opts(c)}</select>
  <span class="biz-tag ${b?'ok':(g?'guess':'')}">${b?'impostato':(g?'da confermare':'')}</span></div>`}).join(''):'<p class="muted">Nessun cliente nella selezione.</p>';
 box.querySelectorAll('.biz-sel').forEach(sel=>sel.onchange=()=>{const c=project.clients[sel.dataset.id];if(!c)return;
  c.bizType=sel.value||'';save();renderBizList();renderBizPanel();render()});
 const st=$('#bizStat');if(st)st.textContent=all.length>BIZ_MAX
   ?`Mostrati i ${BIZ_MAX} di maggior storico su ${all.length}: restringi con i filtri (regione, provincia, stato) per lavorare gli altri.`
   :`${all.length} clienti in elenco, ordinati per storico`}
function acceptAllGuesses(){const rows=bizRows(false).filter(c=>!bizOf(c)&&guessBiz(c));
 if(!rows.length){alert('Nessun suggerimento da applicare nella selezione attuale.');return}
 if(!confirm(`Impostare il suggerimento dal nome su ${rows.length} clienti (tutti quelli filtrati, non solo quelli a schermo)?\n\nSono ipotesi ricavate dal nome: "GARAGE EQUIPMENT" o "LA NUOVA MECCANICA" possono essere rivenditori. Potrai correggere i singoli casi.`))return;
 for(const c of rows)c.bizType=guessBiz(c);save();renderBizList();renderBizPanel();render()}
function exportClientsCsv(){const f=filtered();
 const head=['CODICE','RAGIONE SOCIALE','INDIRIZZO','CITTA','CAP','PROVINCIA','REGIONE','AGENTE','CLASSE ABC','TIPO ATTIVITA','CLASSIFICATO DA','STATO','DETTAGLIO STATO','ACQUISTI','N. MACCHINE','ANNI MACCHINA','ULTIMA MACCHINA','STORICO','ULTIMI 12 MESI','12 MESI PRECEDENTI','ORDINI APERTI','EMAIL','TELEFONO'];
 const body=f.map(c=>{const w=WIN.get(c.id)||{},a=macAgeYears(c),b=bizOf(c),g=guessBiz(c);
  return [c.id,c.name,c.address||'',c.city||'',c.cap||'',c.province||'',regionOf(provOf(c)),agentOf(c),c.abc||'',
   b?BIZ[b]:(g?BIZ[g]:''),b?'impostato':(g?'suggerito dal nome':'da classificare'),
   clientStatus(c).status||'',clientStatus(c).label||'',behaviorOf(c).label||'',behaviorOf(c).n||0,
   a!=null?a.toFixed(1).replace('.',','):'',lastMacDesc(c),
   Math.round(c.sales||0),Math.round(w.a||0),Math.round(w.b||0),Math.round(c.orders||0),
   (c.emails||[]).join('; '),(c.phones||[]).join('; ')].map(csvCell).join(',')});
 if(!f.length)return alert('Nessun cliente nella selezione attuale.');
 const csv='\ufeff'+[head.map(csvCell).join(','),...body].join('\r\n');
 download(`clienti_${new Date().toISOString().slice(0,10)}.csv`,csv);
 $('#status').textContent=`Esportati ${f.length} clienti con il tipo di attività.`}
function agentOf(c){return norm(c.agentOverride)||norm(c.agent)||''}
function agentList(){return [...new Set(Object.values(project.clients).map(agentOf).filter(Boolean))].sort()}
// C'è un conflitto da rivedere quando: hai corretto l'agente a mano (agentOverride),
// e il gestionale ORA dice qualcosa di diverso da quello che diceva QUANDO hai corretto
// (agentBase). Non basta che l'override sia diverso dal gestionale — quello è sempre vero:
// conta che il gestionale sia CAMBIATO dopo la tua correzione.
function agentConflict(c){const ov=norm(c.agentOverride);if(!ov)return null;
 const base=norm(c.agentBase),now=norm(c.agent);
 if(base===''||base===now)return null;      // il gestionale non è cambiato: la tua scelta vale
 if(now===ov)return null;                    // il gestionale ora coincide con la tua: niente da rivedere
 return{tuo:ov,prima:base,ora:now}}
function agentConflicts(){return Object.values(project.clients).filter(c=>agentConflict(c))}
// Override fatti prima di questa funzione: non hanno agentBase, quindi non so cosa diceva il
// gestionale quando li hai corretti. Li allineo alla situazione attuale, così non compaiono
// come falsi conflitti. Da qui in poi, ogni cambiamento del gestionale verrà rilevato.
function migrateAgentBase(){let n=0;for(const c of Object.values(project.clients||{})){
 if(norm(c.agentOverride)&&c.agentBase===undefined){c.agentBase=norm(c.agent);n++}}return n}
function resolveAgent(c,keep){const now=norm(c.agent);
 if(keep==='gestionale'){c.agentOverride='';}          // prendi il valore nuovo del gestionale
 c.agentBase=now;                                       // in ogni caso: allineo la base, il conflitto si chiude
 save();render()}

// ---------- Export parziale per agente/regione e unione dei rientri ----------
const shareSel={agents:new Set(),regions:new Set()};
// Campi che l'agente lavora sul suo file e che vanno riportati indietro.
// Le vendite, gli ordini e l'anagrafica NON si toccano: quelli vengono dal gestionale.
const MERGE_FIELDS=[['bizType','tipo di attività'],['agentOverride','agente corretto'],['note','note'],['lat','coordinate'],['lng','coordinate'],['manualPosition','posizione manuale']];
function shareRegionsAvailable(){return [...new Set(Object.values(project.clients).map(c=>regionOf(provOf(c))).filter(Boolean))].sort()}
function renderShare(){
 const ag=$('#shareAgents'),rg=$('#shareRegions');if(!ag||!rg)return;
 const cntA={},cntR={};
 for(const c of Object.values(project.clients)){const a=agentOf(c)||'(senza agente)';cntA[a]=(cntA[a]||0)+1;const r=regionOf(provOf(c))||'(senza regione)';cntR[r]=(cntR[r]||0)+1}
 ag.innerHTML=Object.keys(cntA).sort().map(a=>`<label class="multi-item"><input type="checkbox" data-ag="${escapeHtml(a)}"${shareSel.agents.has(a)?' checked':''}> ${escapeHtml(a)} <span class="count">${cntA[a]}</span></label>`).join('');
 rg.innerHTML=Object.keys(cntR).sort().map(r=>`<label class="multi-item"><input type="checkbox" data-rg="${escapeHtml(r)}"${shareSel.regions.has(r)?' checked':''}> ${escapeHtml(r)} <span class="count">${cntR[r]}</span></label>`).join('');
 ag.querySelectorAll('input').forEach(i=>i.onchange=()=>{i.checked?shareSel.agents.add(i.dataset.ag):shareSel.agents.delete(i.dataset.ag);renderShare()});
 rg.querySelectorAll('input').forEach(i=>i.onchange=()=>{i.checked?shareSel.regions.add(i.dataset.rg):shareSel.regions.delete(i.dataset.rg);renderShare()});
 const n=shareClients().length;
 $('#shareStat').textContent=`${n} clienti nella selezione`+(n?'':' — non c\u2019\u00e8 nulla da esportare');
 $('#shareExport').disabled=!n}
function shareClients(){return Object.values(project.clients).filter(c=>{
 const a=agentOf(c)||'(senza agente)',r=regionOf(provOf(c))||'(senza regione)';
 return (!shareSel.agents.size||shareSel.agents.has(a))&&(!shareSel.regions.size||shareSel.regions.has(r))})}
function exportShare(){const cs=shareClients();if(!cs.length)return;
 const ids=new Set(cs.map(c=>c.id));
 const sub={...project,
  clients:Object.fromEntries(cs.map(c=>[c.id,c])),
  tour:(project.tour||[]).filter(i=>ids.has(i)),
  emailsOff:(project.emailsOff||[]).filter(k=>ids.has(String(k).split('|')[0])),
  imports:subsetImports(cs),
  subset:{agents:[...shareSel.agents],regions:[...shareSel.regions],clients:cs.length,date:new Date().toISOString(),from:'Maps APP '+APP_VERSION}};
 const nome=[...shareSel.agents,...shareSel.regions].join('-').replace(/[^\w\-]+/g,'_').slice(0,40)||'selezione';
 download(`maps-app_${nome}_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(sub,null,2));
 $('#status').textContent=`Esportati ${cs.length} clienti. L'agente lo apre con "Apri progetto"; al rientro usa "Unisci progetto".`}
function mergeProject(p){
 if(!p||!p.clients)return alert('File non valido: non sembra un progetto Maps APP.');
 const cambi=[],ignoti=[];let tocchi=0;
 for(const [id,inc] of Object.entries(p.clients)){
  const cur=project.clients[id];
  if(!cur){ignoti.push(inc.name||id);continue}
  const diff=[];
  for(const [f,lab] of MERGE_FIELDS){
   const a=inc[f]??'',b=cur[f]??'';
   if(String(a)!==String(b)&&!(f==='lat'||f==='lng'?!inc.manualPosition:false)){if(!diff.includes(lab))diff.push(lab)}}
  if(diff.length){cambi.push({id,name:cur.name,diff});tocchi++}}
 if(!tocchi&&!ignoti.length)return alert('Nessuna differenza: il file non contiene correzioni nuove.');
 const righe=cambi.slice(0,12).map(c=>`\u2022 ${c.name}: ${c.diff.join(', ')}`).join('\n');
 const testo=`Il file contiene ${Object.keys(p.clients).length} clienti`+(p.subset?` (${[...(p.subset.agents||[]),...(p.subset.regions||[])].join(', ')||'selezione'}, esportato il ${new Date(p.subset.date).toLocaleDateString('it-IT')})`:'')+`.\n\n`+
  `Correzioni da riportare: ${tocchi} clienti\n${righe}${cambi.length>12?`\n\u2026e altri ${cambi.length-12}`:''}\n\n`+
  (ignoti.length?`${ignoti.length} clienti del file non esistono qui e verranno ignorati.\n\n`:'')+
  `Vendite, ordini e anagrafica NON vengono toccati: arrivano dal gestionale.\n\nProcedo?`;
 if(!confirm(testo))return;
 for(const c of cambi){const inc=p.clients[c.id],cur=project.clients[c.id];
  for(const [f] of MERGE_FIELDS){if(f==='lat'||f==='lng'){if(inc.manualPosition)cur[f]=inc[f]}else cur[f]=inc[f]??''}}
 // esclusioni email: valgono le scelte dell'agente sui SUOI clienti
 const idsFile=new Set(Object.keys(p.clients));
 project.emailsOff=[...(project.emailsOff||[]).filter(k=>!idsFile.has(String(k).split('|')[0])),...(p.emailsOff||[])];
 save();render();
 alert(`Fatto: ${tocchi} clienti aggiornati.`+(ignoti.length?`\n${ignoti.length} ignorati perch\u00e9 non presenti nel progetto.`:''))}
// ---------- Filtro prodotti: selezione multipla ----------
// Il confronto normalizza tutto (via trattini, punti, spazi doppi) e pretende che TUTTE le
// parole cercate compaiano nella riga: così "051003670001 — PFA 50 PONTE" trova la riga
// "051003670001 PFA 50 PONTE FORBICE", che con il confronto letterale non trovava nulla.
const prodSel=[];
const prodNorm=t=>String(t??'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const prodTokens=t=>prodNorm(t).split(' ').filter(Boolean);
function lineHay(x){return prodNorm(`${x.article} ${x.description}`)}
// I dati hanno DUE patologie opposte, e il filtro deve reggerle entrambe:
//  1. stesso codice, descrizioni diverse (051003670001 = "PFA 50 PONTE FORBICE INC-PAV-LIVAUT"
//     e "PFA 50 PONTE A FORBICE INCASSO-PAV.") -> se cerco solo la descrizione perdo clienti;
//  2. stessa descrizione, codici diversi ("PUMA CE 1ph 230V 50-60Hz" sta sotto 001002080001
//     con 33 clienti e sotto 001002980001 con 2) -> se cerco solo il codice ne perdo la maggior parte.
// Quindi un suggerimento "CODICE — descrizione" vale per il codice OPPURE per la descrizione:
// chi sceglie una macchina dal menu vuole tutti quelli che hanno quella macchina.
function prodCode(q){const i=String(q).indexOf(' \u2014 ');return i>0?prodNorm(q.slice(0,i)):''}
function prodDesc(q){const i=String(q).indexOf(' \u2014 ');return i>0?q.slice(i+3):''}
// Come si confronta una parola cercata con la riga:
//  - se contiene cifre (codici, "535", "230V", "1ph") vale anche come pezzo di parola,
//    così "5100367" trova "051003670001" e "535" trova "535S";
//  - se è lunga (PUMA, FORBICE) idem;
//  - se è corta e senza cifre ("a", "ce", "gt", "pav") deve essere una parola INTERA:
//    altrimenti la "a" di "PONTE A FORBICE" sta dentro qualsiasi descrizione e il filtro
//    restituisce mezzo archivio.
function tokenIn(hay,words,t){const z=t.replace(/^0+/,'');
 const pezzo=()=>hay.includes(t)||(z&&z!==t&&hay.includes(z));
 return /\d/.test(t)||t.length>=4?pezzo():words.has(t)}
function tokensIn(hay,q){const words=new Set(hay.split(' '));return prodTokens(q).every(t=>tokenIn(hay,words,t))}
function lineMatches(x,q){const code=prodCode(q);
 if(code)return prodNorm(x.article)===code||tokensIn(prodNorm(x.description),prodDesc(q));
 return tokensIn(lineHay(x),q)}
function hasTransactionFilter(){return prodSel.length||norm($('#productSearch').value)||$('#yearFrom').value||$('#yearTo').value||$('#movementFilter').value!=='both'}
function clientLines(c){const source=$('#movementFilter').value,{from,to}=selectedYears();let lines=[];
 if(source!=='orders')lines.push(...(c.saleLines||[]).map(x=>({...x,kind:'sale'})));
 if(source!=='sales')lines.push(...(c.orderLines||[]).map(x=>({...x,kind:'order'})));
 return lines.filter(x=>{const y=lineYear(x);return y>=from&&y<=to})}
function matchingLines(c){const lines=clientLines(c);
 const q=norm($('#productSearch').value);
 const cerca=[...prodSel]; if(q&&!prodSel.includes(q))cerca.push(q);
 if(!cerca.length)return lines;
 return lines.filter(x=>cerca.some(p=>lineMatches(x,p)))}
function matchProducts(c){const q=norm($('#productSearch').value);
 const cerca=[...prodSel]; if(q&&!prodSel.includes(q))cerca.push(q);
 if(!cerca.length)return true;
 const lines=clientLines(c);
 // "tutti": il cliente deve avere una riga per ciascun prodotto scelto; altrimenti ne basta uno
 return $('#prodAll')?.checked&&cerca.length>1
  ? cerca.every(p=>lines.some(x=>lineMatches(x,p)))
  : lines.some(x=>cerca.some(p=>lineMatches(x,p)))}
function renderChips(){const box=$('#prodChips');if(!box)return;
 box.innerHTML=prodSel.map((p,i)=>`<span class="chip" title="${escapeHtml(p)}"><span>${escapeHtml(p)}</span><button type="button" data-i="${i}" aria-label="Togli">&times;</button></span>`).join('');
 box.querySelectorAll('button').forEach(b=>b.onclick=()=>{prodSel.splice(+b.dataset.i,1);renderChips();render()});
 const m=$('#prodModeBox');if(m)m.hidden=prodSel.length<2}
function addProd(){const v=norm($('#productSearch').value);if(!v)return;
 if(!prodSel.includes(v))prodSel.push(v);
 $('#productSearch').value='';renderChips();render()}
let agentReviewOnly=false;
let dragMode=false;   // trascinamento marker: spento, si sposta dalla scheda o attivando la modalità
function renderAgentReview(){const conf=agentConflicts();const pan=$('#agentReviewPanel');if(!pan)return;
 pan.hidden=conf.length===0;
 if(conf.length===0){agentReviewOnly=false;return}
 const el=$('#agentReviewCount');if(el)el.textContent=`(${conf.length})`;
 const info=$('#agentReviewInfo');
 if(info){const es=conf.slice(0,4).map(c=>{const cf=agentConflict(c);return `<div class="mail-info" style="margin-bottom:4px"><b>${escapeHtml(c.name||c.id)}</b>: tua «${escapeHtml(cf.tuo)}» \u2192 gestionale ora «${escapeHtml(cf.ora||'nessuno')}»</div>`}).join('');
  info.innerHTML=es+(conf.length>4?`<small class="muted">\u2026e altri ${conf.length-4}</small>`:'')}
 const b=$('#agentReviewShow');if(b)b.classList.toggle('primary',agentReviewOnly)}
function matchAgentReview(c){return !agentReviewOnly||!!agentConflict(c)}
async function hardResetApp(){
 try{await saveQueue}catch(e){}
 if(!confirm('Ripristinare l\u2019app?\n\nVengono svuotate le cache del programma e ricaricata l\u2019ultima versione dal sito. I tuoi dati (clienti, classificazioni, posizioni) NON vengono toccati: restano salvati nel dispositivo.\n\nProcedo?'))return;
 try{if('caches'in window){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}
  if('serviceWorker'in navigator){const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister()}}catch(e){}
 // ricarico bypassando ogni cache
 location.href=location.pathname+'?fresh='+Date.now()}
function showInstallGuide(){const d=$('#installGuide');if(d&&d.showModal){d.showModal()}else{alert('Per installare: usa l\u2019icona di installazione nella barra degli indirizzi (in alto a destra nel campo dell\u2019indirizzo), oppure menu \u22ee \u2192 Installa Maps APP.')}}
function statusText(){const x=project.imports;return ['clienti','ordini','vendite'].map(k=>x[k]?`${k}: ${x[k].rows} righe`:`${k}: non importato`).join(' · ')}
function selectedYears(){const from=num($('#yearFrom').value)||-Infinity,to=num($('#yearTo').value)||Infinity;return{from,to}}
function lineYear(line){if(line.year)return num(line.year);const m=String(line.date||'').match(/(\d{4})$/);return m?num(m[1]):0}


function filtered(){const q=norm($('#search').value).toLowerCase(),ag=$('#agentFilter').value;return Object.values(project.clients).filter(c=>(!q||[c.name,c.city,c.province,c.id].join(' ').toLowerCase().includes(q))&&(!ag||agentOf(c)===ag)&&matchAgentReview(c)&&(!geoSel.regions.size||geoSel.regions.has(regionOf(provOf(c))))&&(!geoSel.provinces.size||geoSel.provinces.has(provOf(c)))&&(!$('#onlyOrders').checked||c.orders>0)&&(!$('#onlySales').checked||c.sales>0)&&(!$('#onlyMissing').checked||c.lat==null)&&(!$('#statusFilter').value||clientStatus(c).status===$('#statusFilter').value)&&matchType(c)&&matchBehavior(c)&&matchAge(c)&&matchProducts(c)&&(!hasTransactionFilter()||matchingLines(c).length>0))}
function matchType(c){const v=$('#typeFilter')?.value;if(!v)return true;
 if(v==='__set')return !!bizOf(c); if(v==='__unset')return !bizOf(c);
 return bizOf(c)===v || (!bizOf(c)&&guessBiz(c)===v)}
function matchBehavior(c){const v=$('#behaviorFilter')?.value;return !v||behaviorOf(c).k===v}
function matchAge(c){const v=$('#ageFilter')?.value;if(!v)return true;const a=macAgeYears(c);if(a==null)return false;
 if(v==='lt3')return a<3; if(v==='lt5')return a<5; if(v==='ge5')return a>=5; if(v==='ge7')return a>=7; return true}
// Un suggerimento per MODELLO (descrizione), non per codice: lo stesso PUMA sta sotto 5 codici
// e proporli tutti costringerebbe a indovinare quale sia quello "giusto". Accanto, il numero
// di clienti che l'hanno comprato, così si vede subito se la voce scelta è quella grossa.
function updateProductSuggestions(){const q=prodNorm($('#productSearch').value),mod=new Map();
 for(const c of Object.values(project.clients))for(const x of [...(c.saleLines||[]),...(c.orderLines||[])]){
  const d=norm(x.description);if(!d&&!x.article)continue;
  const key=prodNorm(d)||prodNorm(x.article);
  if(!mod.has(key))mod.set(key,{label:d||x.article,cli:new Set()});
  mod.get(key).cli.add(c.id)}
 const out=[...mod.values()].filter(m=>!q||tokensIn(prodNorm(m.label),q))
  .sort((a,b)=>b.cli.size-a.cli.size).slice(0,250);
 $('#productSuggestions').innerHTML=out.map(m=>`<option value="${escapeHtml(m.label)}">${m.cli.size} client${m.cli.size===1?'e':'i'}</option>`).join('')}
function updateYears(){const years=new Set();for(const c of Object.values(project.clients))for(const x of [...(c.saleLines||[]),...(c.orderLines||[])]){const y=lineYear(x);if(y)years.add(y)}const vals=[...years].sort((a,b)=>b-a);for(const id of ['yearFrom','yearTo']){const el=$(`#${id}`),cur=el.value,label=id==='yearFrom'?'Da anno':'A anno';el.innerHTML=`<option value="">${label}</option>`+vals.map(y=>`<option value="${y}">${y}</option>`).join('');el.value=cur}}
function render(){computeRefYear();const all=Object.values(project.clients),view=filtered();fillSelect('#agentFilter',[...new Set(all.map(agentOf).filter(Boolean))]);{const sig=[...new Set(all.map(provOf).filter(Boolean))].sort().join(',')+'|'+[...geoSel.regions].join(',');if(sig!==_geoSig)renderGeoFilters(all);}updateYears();updateProductSuggestions();const visibleLines=view.flatMap(matchingLines);const filteredSales=visibleLines.filter(x=>x.kind==='sale').reduce((s,x)=>s+x.amount,0),filteredOrders=visibleLines.filter(x=>x.kind==='order').reduce((s,x)=>s+x.amount,0);$('#clientCount').textContent=view.length;$('#mappedCount').textContent=view.filter(c=>c.lat!=null).length;$('#ordersTotal').textContent=euro(hasTransactionFilter()?filteredOrders:view.reduce((s,c)=>s+c.orders,0));$('#salesTotal').textContent=euro(hasTransactionFilter()?filteredSales:view.reduce((s,c)=>s+c.sales,0));$('#status').textContent=statusText();renderList(view);renderMarkers(view);renderTour();renderMailPanel();renderBizPanel();renderAgentReview();renderStart();if($('#refInfo'))$('#refInfo').innerHTML=`Stato clienti calcolato su: ${escapeHtml(REF_LABEL)}. I clienti con ordini aperti non sono mai classificati dormienti.${hasClassData()?'':' <b style="color:#b45309">Per i filtri Tipo cliente ed Età macchina reimporta il file vendite.</b>'}`}
function fillSelect(sel,vals){const el=$(sel),cur=el.value,label=el.options[0].text;el.innerHTML=`<option value="">${label}</option>`+vals.sort().map(v=>`<option>${escapeHtml(v)}</option>`).join('');el.value=cur}
function renderList(items){$('#list').innerHTML=items.slice(0,400).map(c=>{const st=clientStatus(c),inTour=project.tour?.includes(c.id),lines=matchingLines(c),fs=lines.filter(x=>x.kind==='sale').reduce((s,x)=>s+x.amount,0),fo=lines.filter(x=>x.kind==='order').reduce((s,x)=>s+x.amount,0);return `<article class="client" data-id="${c.id}"><h3>${escapeHtml(c.name||c.id)}</h3><p>${escapeHtml([c.city,c.province,c.agent].filter(Boolean).join(' · '))}</p><div class="badges">${(hasTransactionFilter()?fo:c.orders)?`<span class="badge order">Ordini ${euro(hasTransactionFilter()?fo:c.orders)}</span>`:''}${(hasTransactionFilter()?fs:c.sales)?`<span class="badge sales">Vendite ${euro(hasTransactionFilter()?fs:c.sales)}</span>`:''}${hasTransactionFilter()?`<span class="badge">${lines.length} righe prodotto</span>`:''}${st.label?`<span class="badge ${st.status==='calo'?'risk':'sleep'}">${escapeHtml(st.label)}</span>`:''}${c.lat==null?'<span class="badge missing">Da geocodificare</span>':''}<button type="button" class="mini tour-add${inTour?' on':''}" data-tour="${c.id}">${inTour?'✓ Giro':'+ Giro'}</button></div></article>`}).join('')+(items.length>400?`<p style="padding:8px;opacity:.7"><small>Elenco limitato a 400 di ${items.length} clienti (la mappa li mostra tutti). Usa i filtri per restringere.</small></p>`:'');document.querySelectorAll('.client').forEach(x=>x.onclick=()=>openDetail(x.dataset.id));document.querySelectorAll('.tour-add').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleTour(b.dataset.tour)})}
function renderMarkers(items){if(!markers||typeof L==='undefined')return;markers.clearLayers();for(const c of items){if(c.lat==null)continue;const st=clientStatus(c);const cls=st.status==='calo'?'risk':st.status==='dormiente'?'sleep':c.orders>0?'order':isTop(c)?'top':'';const icon=L.divIcon({className:'',html:`<div class="marker-dot ${cls}"></div>`,iconSize:[18,18],iconAnchor:[9,9]});const m=L.marker([c.lat,c.lng],{icon,draggable:dragMode}).addTo(markers).bindTooltip(c.name||c.id);m.on('click',()=>{if(!dragMode)openDetail(c.id)});m.on('dragend',e=>{const p=e.target.getLatLng();if(!confirm(`Spostare «${c.name||c.id}» qui?\n\nLa posizione verrà salvata come manuale.`)){render();return}c.lat=p.lat;c.lng=p.lng;c.manualPosition=true;save()})}}
function openDetail(id){currentId=id;const c=project.clients[id];const years=Object.entries(c.saleYears||{}).sort((a,b)=>b[0]-a[0]).map(([y,v])=>`${y}: ${euro(v)}`).join('<br>')||'—';$('#detail').innerHTML=`<h2>${escapeHtml(c.name||c.id)}</h2><p>${escapeHtml([c.address,c.cap,c.city,c.province].filter(Boolean).join(', '))}</p><div class="detail-grid"><div class="detail-box"><b>${euro(c.orders)}</b><span>Ordini aperti</span></div><div class="detail-box"><b>${euro(c.sales)}</b><span>Vendite totali</span></div><div class="detail-box"><b>${escapeHtml(agentOf(c)||'—')}</b><span>Agente${c.agentOverride?' (corretto a mano)':''}</span></div><div class="detail-box"><b>${escapeHtml(bizLabel(c)||'da classificare')}</b><span>Tipo di attività${(()=>{const a=macAgeYears(c);return a!=null?` · macchina di ${a.toFixed(1)} anni`:''})()}</span></div><div class="detail-box"><b>${years}</b><span>Vendite per anno</span></div></div>${(()=>{const cf=agentConflict(c);return cf?`<div class="agent-review"><b>Agente da rivedere</b><div class="agent-review-row">La tua correzione: <b>${escapeHtml(cf.tuo)}</b></div><div class="agent-review-row">Il gestionale prima diceva <b>${escapeHtml(cf.prima||'nessuno')}</b>, <b>ora dice ${escapeHtml(cf.ora||'nessuno')}</b>.</div><div class="row" style="margin-top:8px"><button type="button" id="agentKeep" class="mini">Tieni «${escapeHtml(cf.tuo)}»</button><button type="button" id="agentTake" class="mini primary">Usa «${escapeHtml(cf.ora||'nessuno')}» dal gestionale</button></div></div>`:''})()}<div class="field"><label>Agente di riferimento</label><div class="row"><select id="detailAgent" style="flex:1"><option value="">— dal gestionale: ${escapeHtml(c.agent||'nessuno')} —</option>${agentList().map(a=>`<option value="${escapeHtml(a)}"${norm(c.agentOverride)===a?' selected':''}>${escapeHtml(a)}</option>`).join('')}</select><input id="detailAgentNew" placeholder="oppure scrivi un nome" value="${escapeHtml(agentList().includes(norm(c.agentOverride))?'':norm(c.agentOverride))}" style="flex:1"></div><small class="muted" style="display:block;margin-top:6px">Il gestionale assegna <b>${escapeHtml(c.agent||'nessun agente')}</b>. Qui puoi correggerlo: la correzione vince, resta nel progetto e sopravvive al reimport degli Excel.</small></div><div class="field"><label>Tipo di attività</label><div class="row"><select id="detailBiz" style="flex:1"><option value="">— da classificare —</option>${Object.entries(BIZ).map(([k,v])=>`<option value="${k}"${bizOf(c)===k?' selected':''}>${escapeHtml(v)}</option>`).join('')}</select><button type="button" id="detailBizWeb" class="ghost" title="Cerca l'azienda online per capire che mestiere fa">Cerca online</button></div><small id="detailBizHint" class="muted" style="display:block;margin-top:6px"></small></div><div class="field"><label>Coordinate</label><div class="row"><input id="lat" value="${c.lat??''}" placeholder="Latitudine"><input id="lng" value="${c.lng??''}" placeholder="Longitudine"></div></div><div class="field"><label>Note locali</label><textarea id="note">${escapeHtml(c.note||'')}</textarea></div><div class="detail-actions"><button type="button" id="tourToggle">${project.tour?.includes(c.id)?'− Rimuovi dal giro':'+ Aggiungi al giro'}</button><button type="button" id="saveDetail" class="primary">Salva</button><a class="button" target="_blank" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.lat!=null?`${c.lat},${c.lng}`:[c.address,c.city,c.province].join(' '))}">Naviga</a></div><p><small>${c.phones?.map(escapeHtml).join(' · ')||''}<br>${c.emails?.map(escapeHtml).join(' · ')||''}</small></p>`;$('#tourToggle').onclick=()=>{toggleTour(id);$('#detailDialog').close()};$('#saveDetail').onclick=()=>{const lat=parseFloat($('#lat').value),lng=parseFloat($('#lng').value);c.lat=Number.isFinite(lat)?lat:null;c.lng=Number.isFinite(lng)?lng:null;c.manualPosition=Number.isFinite(lat)&&Number.isFinite(lng);c.note=$('#note').value;save();$('#detailDialog').close()};
const bz=$('#detailBiz');
if(bz){bz.onchange=()=>{c.bizType=bz.value||'';save();fillBizHint(c);render()};fillBizHint(c)}
const ag=$('#detailAgent'),agn=$('#detailAgentNew');
if(ag&&agn){const applica=()=>{const v=norm(agn.value)||norm(ag.value);c.agentOverride=v&&v!==norm(c.agent)?v:'';c.agentBase=norm(c.agent);save();render();
  const box=$('#detail .detail-box:nth-child(3) b');if(box)box.textContent=agentOf(c)||'—'};
 ag.onchange=()=>{if(norm(ag.value))agn.value='';applica()};agn.onchange=applica;agn.oninput=()=>{if(norm(agn.value))ag.value=''}}
const ak2=$('#agentKeep'),at2=$('#agentTake');
if(ak2)ak2.onclick=()=>{resolveAgent(c,'tua');openDetail(c)};
if(at2)at2.onclick=()=>{resolveAgent(c,'gestionale');openDetail(c)};
const wb=$('#detailBizWeb');
if(wb)wb.onclick=()=>{const q=[c.name,c.city,c.province,'ATECO attività'].filter(Boolean).join(' ');
 window.open('https://www.google.com/search?q='+encodeURIComponent(q),'_blank','noopener')};
$('#detailDialog').showModal()}
async function geocodeMissing(){const list=filtered().filter(c=>c.lat==null&&c.address&&c.city);if(!list.length)return alert('Nessun cliente da geocodificare nel filtro corrente.');if(!confirm(`Geocodificare ${list.length} indirizzi?`))return;let done=0;for(const c of list){$('#status').textContent=`Geocodifica ${done+1}/${list.length}: ${c.name}`;try{const tries=[[c.address,c.cap,c.city,c.province,'Italia'],[c.cap,c.city,c.province,'Italia'],[c.city,c.province,'Italia']];for(const parts of tries){const q=parts.filter(Boolean).join(', ');if(!q)continue;const res=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(q)}`,{headers:{'Accept-Language':'it'}});const data=await res.json();if(data[0]){c.lat=Number(data[0].lat);c.lng=Number(data[0].lon);break}await new Promise(r=>setTimeout(r,1100))}}catch(e){console.warn(e)}done++;if(done%10===0)await persistProject();renderMarkers(filtered());await new Promise(r=>setTimeout(r,1100))}save();alert(`Geocodifica completata: ${done} indirizzi elaborati.`)}
function exportProject(){const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`maps-app-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)}
function fit(){if(!map)return alert('La mappa richiede una connessione Internet.');const pts=filtered().filter(c=>c.lat!=null).map(c=>[c.lat,c.lng]);if(pts.length)map.fitBounds(pts,{padding:[30,30]})}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
$('#excelInput').onchange=e=>importFiles([...e.target.files]);$('#projectInput').onchange=async e=>{
 const file=e.target.files&&e.target.files[0];
 e.target.value='';
 if(!file)return;
 if(loadFailed){alert('Non posso aprire un progetto: all\u2019avvio non sono riuscito a leggere l\u2019archivio locale.\n\nRicarica la pagina e riprova. Aprendo adesso rischi di perdere i dati gi\u00e0 presenti.');return}
 // 1) lettura e interpretazione del file: qui gli errori sono colpa del FILE
 let p;
 try{
  const testo=await file.text();
  p=JSON.parse(testo);
 }catch(err){alert('File non leggibile: '+(err&&err.message||err)+'\n\nControlla di aver scelto il file .json esportato da Maps APP.');return}
 let n;
 try{
  if(!p||!p.clients||typeof p.clients!=='object')throw new Error('non contiene l\u2019elenco clienti');
  n=Object.keys(p.clients).length;
  if(!n)throw new Error('l\u2019elenco clienti \u00e8 vuoto');
 }catch(err){alert('Progetto non valido: '+err.message+'.');return}
 const cur=Object.keys(project.clients||{}).length;
 if(p.subset&&cur>n){const chi=[...(p.subset.agents||[]),...(p.subset.regions||[])].join(', ')||'selezione';
  if(!confirm(`Attenzione: questo \u00e8 un progetto PARZIALE (${n} clienti \u2014 ${chi}).\n\nAprendolo sostituisci il progetto che hai adesso, che ne contiene ${cur}: gli altri ${cur-n} spariscono da questo dispositivo.\n\nSe volevi solo riportare le correzioni dell'agente, annulla e usa "Unisci progetto".\n\nAprire lo stesso?`))return}
 // 2) adozione e salvataggio: qui gli errori sono colpa dell'ARCHIVIO, e vanno detti chiaramente
 const precedente=project;
 try{
  adoptProject(p);
 }catch(err){project=precedente;alert('Progetto non valido: '+(err&&err.message||err));return}
 try{
  const salvati=await persistProject(true);
  project.updatedAt=new Date().toISOString();
  render();
  if(map)fit();
  $('#status').style.color='';$('#status').style.fontWeight='';
  await requestPersistentStorage();warnIfStorageVolatile();
  alert(`Progetto aperto e SALVATO su questo dispositivo: ${salvati} clienti.\n\nPuoi chiudere la app: alla riapertura ritrovi tutto.`);
 }catch(err){
  console.error(err);
  render();
  alert('ATTENZIONE: il progetto \u00e8 aperto sullo schermo ma NON \u00e8 stato salvato su questo dispositivo.\n\nMotivo: '+(err&&err.message||err)+'\n\nSe chiudi la app adesso perdi tutto. Cause tipiche: navigazione privata, spazio esaurito, oppure dati dei siti bloccati nelle impostazioni del browser.');
 }
};
$('#exportBtn').onclick=exportProject;
$('#resetAppBtn')&&($('#resetAppBtn').onclick=hardResetApp);
// Diagnostica archivio: serve per capire a distanza perche' un agente "perde tutto".
async function diagnostica(){
 const L=[];
 const std=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 L.push('Maps APP '+APP_VERSION);
 L.push('Modo: '+(std?'APP INSTALLATA (dati protetti)':'BROWSER \u2014 i dati possono essere cancellati dal sistema'));
 L.push('Clienti a schermo: '+Object.keys(project.clients||{}).length);
 try{
  const p=await readProject();
  L.push('Clienti in archivio: '+(p?Object.keys(p.clients||{}).length:'ARCHIVIO VUOTO'));
  L.push('Ultimo salvataggio: '+((p&&p.updatedAt)?new Date(p.updatedAt).toLocaleString('it-IT'):'mai'));
 }catch(e){L.push('ARCHIVIO NON LEGGIBILE: '+(e&&e.message||e))}
 try{const b=await readBackup();L.push('Copia di sicurezza: '+(b?Object.keys(b.clients||{}).length+' clienti':'assente'))}catch(e){L.push('Copia di sicurezza: non leggibile')}
 try{
  if(navigator.storage&&navigator.storage.persisted){
   const per=await navigator.storage.persisted();
   L.push('Dati protetti dal browser: '+(per?'SI':'NO \u2014 possono sparire'));
  }else L.push('Dati protetti dal browser: non dichiarato');
  if(navigator.storage&&navigator.storage.estimate){
   const e2=await navigator.storage.estimate();
   L.push('Spazio usato: '+Math.round((e2.usage||0)/1048576)+' MB su '+Math.round((e2.quota||0)/1048576)+' MB');
  }
 }catch(e){}
 L.push('Progetto agganciato al link: '+(urlProgetto()||'nessuno'));
 try{const v=localStorage.getItem('maps-app-sentinella');L.push('Ultimo salvataggio noto: '+(v||'mai'))}catch(e){L.push('localStorage non accessibile')}
 L.push('Service worker: '+(('serviceWorker'in navigator)?(navigator.serviceWorker.controller?'attivo':'non ancora attivo'):'non supportato'));
 L.push('Scritture in corso: '+pendingWrites+(loadFailed?' \u2014 SCRITTURE BLOCCATE (lettura fallita all\u2019avvio)':''));
 const testo=L.join('\n');
 if(navigator.clipboard&&navigator.clipboard.writeText){try{await navigator.clipboard.writeText(testo)}catch(e){}}
 alert(testo+'\n\n(copiato negli appunti: incollalo nel messaggio di segnalazione)');
}
$('#diagBtn')&&($('#diagBtn').onclick=diagnostica);

$('#installGuideClose')&&($('#installGuideClose').onclick=()=>$('#installGuide').close());
$('#prodAdd').onclick=addProd;
$('#productSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addProd()}});
$('#prodAll').onchange=render;
$('#shareBtn').onclick=()=>{renderShare();$('#shareDialog').showModal()};
$('#shareClose').onclick=()=>$('#shareDialog').close();
$('#shareExport').onclick=()=>{exportShare();$('#shareDialog').close()};
$('#shareAgAll').onclick=()=>{shareSel.agents=new Set(Object.values(project.clients).map(c=>agentOf(c)||'(senza agente)'));renderShare()};
$('#shareAgNone').onclick=()=>{shareSel.agents.clear();renderShare()};
$('#shareRegAll').onclick=()=>{shareSel.regions=new Set(Object.values(project.clients).map(c=>regionOf(provOf(c))||'(senza regione)'));renderShare()};
$('#shareRegNone').onclick=()=>{shareSel.regions.clear();renderShare()};
$('#mergeInput').onchange=async e=>{try{const p=JSON.parse(await e.target.files[0].text());mergeProject(p)}catch(err){alert('File non leggibile: '+err.message)}finally{e.target.value=''}};$('#fitBtn').onclick=fit;
$('#dragModeToggle').onchange=e=>{dragMode=e.target.checked;$('#status').textContent=dragMode?'Modalità spostamento ATTIVA: trascina un cliente per riposizionarlo. Il clic non apre più la scheda.':'Modalità spostamento disattivata.';render()};$('#geocodeBtn').onclick=geocodeMissing;$('#tourAddFiltered').onclick=tourAddFiltered;$('#tourClear').onclick=()=>{project.tour=[];invalidateRoute();save()};$('#tourOptimize').onclick=optimizeTour;$('#startGps').onclick=setStartGps;$('#startAddr').onchange=setStartAddr;$('#mailExport').onclick=exportMail;
$('#agentReviewShow').onclick=()=>{agentReviewOnly=!agentReviewOnly;renderAgentReview();render()};
$('#bizManage').onclick=()=>{bizTodoOnly=false;renderBizList();$('#bizDialog').showModal()};
$('#bizClose').onclick=()=>$('#bizDialog').close();
$('#bizOnlyTodo').onclick=()=>{bizTodoOnly=!bizTodoOnly;$('#bizOnlyTodo').classList.toggle('primary',bizTodoOnly);renderBizList()};
$('#bizAcceptAll').onclick=acceptAllGuesses;
$('#bizExport').onclick=exportClientsCsv;$('#mailCopy').onclick=copyMail;$('#mailManage').onclick=()=>{renderMailDialog();$('#mailDialog').showModal()};$('#mailClose').onclick=()=>$('#mailDialog').close();$('#mailAll').onclick=()=>mailBulk('all');$('#mailNone').onclick=()=>mailBulk('none');$('#mailNoPec').onclick=()=>mailBulk('nopec');['costConsumo','costPrezzo','costPedaggio','costQuota'].forEach(id=>{$('#'+id).onchange=()=>{project.costParams??={consumo:7,prezzo:1.90,pedaggio:0.095,quota:60};project.costParams.consumo=Number($('#costConsumo').value)||7;project.costParams.prezzo=Number($('#costPrezzo').value)||1.90;project.costParams.pedaggio=Number($('#costPedaggio').value)||0.095;project.costParams.quota=Math.min(100,Math.max(0,Number($('#costQuota').value)||0));save()}});['search','productSearch','agentFilter','statusFilter','typeFilter','behaviorFilter','ageFilter','movementFilter','yearFrom','yearTo','onlyOrders','onlySales','onlyMissing'].forEach(id=>$(`#${id}`).addEventListener(['search','productSearch'].includes(id)?'input':'change',render));const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
// Stato del pulsante installa/disinstalla, ricalcolato a ogni evento rilevante.
// - App aperta come finestra installata (standalone): mostro "Disinstalla" (istruzioni).
// - App nel browser e installabile: mostro "Installa".
// - App nel browser ma già installata (o non installabile): nascondo tutto.
let installed=false;
let updatePending=false;
function refreshInstallUI(){const b=$('#installBtn');if(!b)return;
  if(updatePending&&!isStandalone()){b.hidden=true;return}   // prima aggiorna, poi semmai installa
  if(isStandalone()){b.hidden=false;b.textContent='Disinstalla';b.dataset.mode='uninstall';return}
  if(deferredPrompt&&!installed){b.hidden=false;b.textContent='Installa';b.dataset.mode='install';return}
  if(installed){b.hidden=true;return}          // già installata: niente pulsante nel browser
  // iOS non emette beforeinstallprompt: se non è standalone, offro comunque le istruzioni
  if(isIOS()&&!isStandalone()){b.hidden=false;b.textContent='Installa';b.dataset.mode='install';return}
  b.hidden=true}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;installed=false;refreshInstallUI()});
window.addEventListener('appinstalled',()=>{deferredPrompt=null;installed=true;refreshInstallUI()});
// se l'utente disinstalla e torna nel browser, display-mode cambia: riallineo
window.matchMedia('(display-mode: standalone)').addEventListener?.('change',refreshInstallUI);
refreshInstallUI();

$('#installBtn').onclick=async()=>{
  if($('#installBtn').dataset.mode==='uninstall'){
    alert('Per disinstallare Maps APP:\n\n• Chrome/Edge (desktop): apri l’app, menu ⋮ in alto a destra → “Disinstalla Maps APP”. Oppure da chrome://apps, tasto destro sull’icona → Rimuovi.\n• Android: tieni premuta l’icona sulla schermata Home → Disinstalla (o Rimuovi).\n• iPhone/iPad: tieni premuta l’icona sulla schermata Home → Rimuovi app → Elimina.');
    return}
  if(deferredPrompt){try{deferredPrompt.prompt();const{outcome}=await deferredPrompt.userChoice;deferredPrompt=null;if(outcome==='accepted'){installed=true}refreshInstallUI();}catch(e){deferredPrompt=null;alert('La finestra di installazione non si è aperta. Usa l’icona di installazione nella barra degli indirizzi (a destra, un monitor con una freccia), oppure il menu ⋮ → “Installa Maps APP”.')}return}
  if(isIOS()){alert('Per installare su iPhone/iPad:\n\n1. Apri questa pagina in Safari\n2. Tocca il pulsante Condividi (quadrato con freccia)\n3. Scorri e tocca “Aggiungi a schermata Home”\n4. Conferma con “Aggiungi”');return}
  // Nessun prompt disponibile (già installata, oppure Chrome in pausa dopo annullamenti):
  // mostro la guida visiva all'icona nella barra degli indirizzi, che è sempre affidabile.
  if(isIOS())return; showInstallGuide()};
// Reload dopo un aggiornamento del service worker.
// Prima veniva eseguito SEMPRE: alla primissima visita clients.claim() fa scattare
// controllerchange e la pagina si ricaricava da sola, anche a met\u00e0 di un salvataggio.
let swReloaded=false,reloadWanted=false;
function drainReload(){if(reloadWanted&&pendingWrites===0&&!swReloaded){swReloaded=true;location.reload()}}
function armSwReload(){
 if(!('serviceWorker'in navigator))return;
 const avevaController=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!avevaController)return;          // prima installazione: nessun reload, non c'\u00e8 niente da aggiornare
  reloadWanted=true;drainReload()      // aggiornamento vero: ricarico, ma solo a scritture concluse
 })
}
(async()=>{await load();initMap();render();await requestPersistentStorage();const daLink=await caricaDaLink();if(!daLink)avvisaSeDatiCancellati();warnIfStorageVolatile();armSwReload();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js?v='+SW_EXPECTED).then(reg=>{setInterval(()=>reg.update().catch(()=>{}),60000);
 reg.addEventListener('updatefound',()=>{const w=reg.installing;if(!w)return;w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)showUpdateBanner()})});
 reg.update().catch(()=>{});setInterval(()=>reg.update().catch(()=>{}),60*60*1000);
 checkVersion()}).catch(e=>console.warn('SW',e));else setVerBadge('no SW')})();
