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
function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function persistProject(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(project,DB_KEY);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function readProject(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readonly');const req=tx.objectStore(DB_STORE).get(DB_KEY);req.onsuccess=()=>{db.close();resolve(req.result)};req.onerror=()=>{db.close();reject(req.error)}})}
async function save(){project.updatedAt=new Date().toISOString();try{await persistProject()}catch(e){console.error('IndexedDB',e);throw e}render()}
async function load(){try{let p=await readProject();if(!p){const legacy=localStorage.getItem(LEGACY_KEY);if(legacy){p=JSON.parse(legacy);project=p;await persistProject();localStorage.removeItem(LEGACY_KEY)}}if(p?.clients){project=p;project.tour??=[];project.tourStart??=null;project.emailsOff??=[];project.tourStartLabel??='';for(const c of Object.values(project.clients)){c.orderLines??=[];c.saleLines??=[];c.saleYears??={}}const before=Object.keys(project.clients).length;migrateClients();if(Object.keys(project.clients).length!==before)await persistProject()}}catch(e){console.warn(e)}}
function migrateClients(){const merged={};for(const[k,c]of Object.entries(project.clients)){const id=canonId(k)||k;if(!merged[id]){merged[id]={...c,id};continue}const t=merged[id];t.name=t.name||c.name;t.address=t.address||c.address;t.city=t.city||c.city;t.cap=t.cap||c.cap;t.province=t.province||c.province;t.agent=t.agent||c.agent;t.agentCode=t.agentCode||c.agentCode;t.abc=t.abc||c.abc;t.payment=t.payment||c.payment;t.note=[t.note,c.note].filter(Boolean).join('\n');t.orders=(t.orders||0)+(c.orders||0);t.sales=(t.sales||0)+(c.sales||0);t.orderLines=[...(t.orderLines||[]),...(c.orderLines||[])];t.saleLines=[...(t.saleLines||[]),...(c.saleLines||[])];for(const[y,v]of Object.entries(c.saleYears||{}))t.saleYears[y]=(t.saleYears[y]||0)+v;t.emails=[...new Set([...(t.emails||[]),...(c.emails||[])])];t.phones=[...new Set([...(t.phones||[]),...(c.phones||[])])];if(t.lat==null&&c.lat!=null){t.lat=c.lat;t.lng=c.lng;t.manualPosition=c.manualPosition}}project.clients=merged}
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
  const clients=Object.keys(project.clients).length;
  const mapped=Object.values(project.clients).filter(c=>c.lat!=null&&c.lng!=null).length;
  status.textContent=`${clients} clienti caricati · ${mapped} mappati`;
  let msg=`Importazione terminata. File riconosciuti: ${imported}. Clienti caricati: ${clients}.`;
  if(clients>0&&mapped===0)msg+='\n\nIl file clienti non contiene coordinate geografiche. Per vedere i marker usa “Geocodifica mancanti”.';
  if(errors.length)msg+=`\n\nAvvisi:\n${errors.join('\n')}`;
  alert(msg);
  $('#excelInput').value='';
}

function ensure(id,name=''){id=canonId(id);if(!id||id==='00000')return null;return project.clients[id]??={id,name,emails:[],phones:[],orders:0,sales:0,orderLines:[],saleLines:[],saleYears:{},note:'',lat:null,lng:null,manualPosition:false}}
function importClients(rows){const seen=new Set();for(const r of rows){const id=canonId(r['CLIENTE']);if(!id||id==='00000')continue;const rs=norm(r['RAGIONE SOCIALE 1']||r['RAGIONE SOCIALE']);const c=ensure(id,rs);c.name=rs||c.name;c.address=norm(r['INDIRIZZO']);c.city=norm(r['CITTA']||r['LOCALITA']||r['COMUNE']);c.cap=norm(r['CAP']).padStart(5,'0');c.province=norm(r['PROVINCIA']);c.agentCode=norm(r['AGENTE']);c.agent=norm(r['DESCRIZIONE ELEMENTO_2']||r['DESCRIZIONE ELEMENTO_1']||r['DESCRIZIONE ELEMENTO']);c.abc=norm(r['CLASSE ABC']);c.payment=norm(r['DESCRIZIONE ELEMENTO']);[r['NR.TELEFONICO'],r['NR.CELLULARE']].map(norm).filter(Boolean).forEach(x=>{if(!c.phones.includes(x))c.phones.push(x)});for(const em of splitEmails(r['EMAIL']))if(!c.emails.some(x=>x.toLowerCase()===em))c.emails.push(em);seen.add(id)}project.imports.clientiCount=seen.size}
function importOrders(rows){for(const c of Object.values(project.clients)){c.orders=0;c.orderLines=[]}for(const r of rows){const c=ensure(r['CLIENTE'],r['CLIENTE_1']);if(!c)continue;const amount=num(r['IMPORTO INEVASO']);c.name=c.name||norm(r['CLIENTE_1']);c.orders+=amount;c.orderLines.push({order:norm(r['NUM.']),date:excelDate(r['DATA CREAZIONE']),delivery:excelDate(r['DATA CONSEGNA']),year:norm(r['ANNO']),article:norm(r['ARTICOLO']),description:norm(r['DESCRIZIONE']),qty:num(r['QTA INEVASA']),amount})}}
function importSales(rows){for(const c of Object.values(project.clients)){c.sales=0;c.saleYears={};c.saleLines=[]}for(const r of rows){const c=ensure(r['CLIENTE'],r['RAGIONE SOCIALE 1']);if(!c)continue;const amount=num(r['IMPORTO CONSEGNATO']);const year=norm(r['ANNO SPEDIZIONE']);c.name=c.name||norm(r['RAGIONE SOCIALE 1']);c.sales+=amount;c.saleYears[year]=(c.saleYears[year]||0)+amount;c.saleLines.push({shipment:norm(r['NUMERO SPEDIZIONE']),date:excelDate(r['DATA SPEDIZIONE']),year,article:norm(r['ARTICOLO']),description:norm(r['DESCRIZIONE']),qty:num(r['QTA CONSEGNATA']),amount})}}
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
const head=['EMAIL','RAGIONE SOCIALE','CODICE CLIENTE','CITTA','PROVINCIA','REGIONE','AGENTE','CLASSE ABC','STATO','VENDITE','ORDINI APERTI'];
const body=rows.map(({c,em})=>[em,c.name,c.id,c.city||'',c.province||'',regionOf(provOf(c)),c.agent||'',c.abc||'',clientStatus(c).status||'',Math.round(c.sales||0),Math.round(c.orders||0)].map(csvCell).join(','));
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
function computeRefYear(force){const sig=`${Object.keys(project.clients).length}|${project.updatedAt||''}`;if(!force&&sig===STATS_SIG&&WIN.size)return;STATS_SIG=sig;let y=0,maxT=0;const all=Object.values(project.clients);
for(const c of all){for(const k of Object.keys(c.saleYears||{})){const n=num(k);if(n>y)y=n}for(const l of c.saleLines||[]){const t=parseDMY(l.date);if(t&&t>maxT&&t<=Date.now()+DAY)maxT=t}}
REF_YEAR=y;REF_END=maxT||Date.now();const w1=REF_END-365*DAY,w2=REF_END-730*DAY;
WIN.clear();
for(const c of all){let a=0,b=0,last=0,dated=false;
for(const l of c.saleLines||[]){const t=parseDMY(l.date);if(!t)continue;dated=true;if(t>last)last=t;const v=num(l.amount);if(t>w1)a+=v;else if(t>w2)b+=v}
WIN.set(c.id,{a,b,last,dated})}
REF_LABEL=maxT?`12 mesi al ${new Date(REF_END).toLocaleDateString('it-IT')}`:`anno ${REF_YEAR}`}
function monthsSince(t){return t?Math.max(0,Math.round((REF_END-t)/(30.44*DAY))):null}
function clientStatus(c){const w=WIN.get(c.id);const hasOpen=(c.orders||0)>0;const sales=c.sales||0;
let cur,prev,dated=!!(w&&w.dated);
if(dated){cur=w.a;prev=w.b}
else{const thisYear=new Date().getUTCFullYear();const ref=REF_YEAR>=thisYear?REF_YEAR-1:REF_YEAR;if(!ref)return{status:'',label:''};
 cur=(c.saleYears?.[ref]||0)+(REF_YEAR>=thisYear?(c.saleYears?.[REF_YEAR]||0):0);prev=c.saleYears?.[ref-1]||0}
if(sales>0&&cur===0&&!hasOpen){const m=dated?monthsSince(w.last):null;return{status:'dormiente',label:m?`Dormiente da ${m} mesi`:'Dormiente'}}
if(cur>0&&prev>0&&cur<prev*0.6)return{status:'calo',label:`In calo ${Math.round((cur-prev)/prev*100)}%${dated?' (12 mesi)':''}`};
if(sales>0||hasOpen)return{status:'attivo',label:''};
return{status:'',label:''}}
const APP_VERSION='v12.0';
function setVerBadge(txt,cls){const el=$('#verBadge');if(!el)return;el.textContent=txt;el.className='ver'+(cls?' '+cls:'')}
function showUpdateBanner(){if($('#updBanner'))return;const d=document.createElement('div');d.id='updBanner';d.className='upd-banner';
 d.innerHTML=`<span>È disponibile una versione più recente di Maps APP.</span><button type="button" id="updNow">Aggiorna ora</button>`;
 document.body.appendChild(d);$('#updNow').onclick=async()=>{if('serviceWorker'in navigator){const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister()}location.reload(true)};
 setVerBadge(APP_VERSION+' · aggiornamento pronto','stale')}
const SW_EXPECTED='maps-app-v12-0-version-badge';
async function checkVersion(){setVerBadge(APP_VERSION);
 try{const res=await fetch('sw.js?ts='+Date.now(),{cache:'no-store'});const m=/const CACHE='([^']+)'/.exec(await res.text());
  if(m&&m[1]!==SW_EXPECTED)setVerBadge(APP_VERSION+' \u2022 sul server: '+m[1].replace('maps-app-',''),'stale')}catch(e){}}
function statusText(){const x=project.imports;return ['clienti','ordini','vendite'].map(k=>x[k]?`${k}: ${x[k].rows} righe`:`${k}: non importato`).join(' · ')}
function selectedYears(){const from=num($('#yearFrom').value)||-Infinity,to=num($('#yearTo').value)||Infinity;return{from,to}}
function lineYear(line){if(line.year)return num(line.year);const m=String(line.date||'').match(/(\d{4})$/);return m?num(m[1]):0}
function matchingLines(c){const q=norm($('#productSearch').value).toLowerCase(),source=$('#movementFilter').value,{from,to}=selectedYears();let lines=[];if(source!=='orders')lines.push(...(c.saleLines||[]).map(x=>({...x,kind:'sale'})));if(source!=='sales')lines.push(...(c.orderLines||[]).map(x=>({...x,kind:'order'})));const qz=q.replace(/^0+/,'');return lines.filter(x=>{const y=lineYear(x);const hay=`${x.article} ${x.description}`.toLowerCase();return(!q||hay.includes(q)||(qz&&qz!==q&&hay.includes(qz)))&&y>=from&&y<=to})}
function hasTransactionFilter(){return norm($('#productSearch').value)||$('#yearFrom').value||$('#yearTo').value||$('#movementFilter').value!=='both'}
function filtered(){const q=norm($('#search').value).toLowerCase(),ag=$('#agentFilter').value;return Object.values(project.clients).filter(c=>(!q||[c.name,c.city,c.province,c.id].join(' ').toLowerCase().includes(q))&&(!ag||c.agent===ag)&&(!geoSel.regions.size||geoSel.regions.has(regionOf(provOf(c))))&&(!geoSel.provinces.size||geoSel.provinces.has(provOf(c)))&&(!$('#onlyOrders').checked||c.orders>0)&&(!$('#onlySales').checked||c.sales>0)&&(!$('#onlyMissing').checked||c.lat==null)&&(!$('#statusFilter').value||clientStatus(c).status===$('#statusFilter').value)&&(!hasTransactionFilter()||matchingLines(c).length>0))}
function updateProductSuggestions(){const q=norm($('#productSearch').value).toLowerCase(),seen=new Map();for(const c of Object.values(project.clients))for(const x of [...(c.saleLines||[]),...(c.orderLines||[])]){const label=[x.article,x.description].filter(Boolean).join(' — ');if(label&&(!q||label.toLowerCase().includes(q)))seen.set(label,label)}$('#productSuggestions').innerHTML=[...seen.values()].slice(0,250).map(v=>`<option value="${escapeHtml(v)}"></option>`).join('')}
function updateYears(){const years=new Set();for(const c of Object.values(project.clients))for(const x of [...(c.saleLines||[]),...(c.orderLines||[])]){const y=lineYear(x);if(y)years.add(y)}const vals=[...years].sort((a,b)=>b-a);for(const id of ['yearFrom','yearTo']){const el=$(`#${id}`),cur=el.value,label=id==='yearFrom'?'Da anno':'A anno';el.innerHTML=`<option value="">${label}</option>`+vals.map(y=>`<option value="${y}">${y}</option>`).join('');el.value=cur}}
function render(){computeRefYear();const all=Object.values(project.clients),view=filtered();fillSelect('#agentFilter',[...new Set(all.map(c=>c.agent).filter(Boolean))]);{const sig=[...new Set(all.map(provOf).filter(Boolean))].sort().join(',')+'|'+[...geoSel.regions].join(',');if(sig!==_geoSig)renderGeoFilters(all);}updateYears();updateProductSuggestions();const visibleLines=view.flatMap(matchingLines);const filteredSales=visibleLines.filter(x=>x.kind==='sale').reduce((s,x)=>s+x.amount,0),filteredOrders=visibleLines.filter(x=>x.kind==='order').reduce((s,x)=>s+x.amount,0);$('#clientCount').textContent=view.length;$('#mappedCount').textContent=view.filter(c=>c.lat!=null).length;$('#ordersTotal').textContent=euro(hasTransactionFilter()?filteredOrders:view.reduce((s,c)=>s+c.orders,0));$('#salesTotal').textContent=euro(hasTransactionFilter()?filteredSales:view.reduce((s,c)=>s+c.sales,0));$('#status').textContent=statusText();renderList(view);renderMarkers(view);renderTour();renderMailPanel();renderStart();if($('#refInfo'))$('#refInfo').textContent=`Stato clienti calcolato su: ${REF_LABEL}. I clienti con ordini aperti non sono mai classificati dormienti.`}
function fillSelect(sel,vals){const el=$(sel),cur=el.value,label=el.options[0].text;el.innerHTML=`<option value="">${label}</option>`+vals.sort().map(v=>`<option>${escapeHtml(v)}</option>`).join('');el.value=cur}
function renderList(items){$('#list').innerHTML=items.slice(0,400).map(c=>{const st=clientStatus(c),inTour=project.tour?.includes(c.id),lines=matchingLines(c),fs=lines.filter(x=>x.kind==='sale').reduce((s,x)=>s+x.amount,0),fo=lines.filter(x=>x.kind==='order').reduce((s,x)=>s+x.amount,0);return `<article class="client" data-id="${c.id}"><h3>${escapeHtml(c.name||c.id)}</h3><p>${escapeHtml([c.city,c.province,c.agent].filter(Boolean).join(' · '))}</p><div class="badges">${(hasTransactionFilter()?fo:c.orders)?`<span class="badge order">Ordini ${euro(hasTransactionFilter()?fo:c.orders)}</span>`:''}${(hasTransactionFilter()?fs:c.sales)?`<span class="badge sales">Vendite ${euro(hasTransactionFilter()?fs:c.sales)}</span>`:''}${hasTransactionFilter()?`<span class="badge">${lines.length} righe prodotto</span>`:''}${st.label?`<span class="badge ${st.status==='calo'?'risk':'sleep'}">${escapeHtml(st.label)}</span>`:''}${c.lat==null?'<span class="badge missing">Da geocodificare</span>':''}<button type="button" class="mini tour-add${inTour?' on':''}" data-tour="${c.id}">${inTour?'✓ Giro':'+ Giro'}</button></div></article>`}).join('')+(items.length>400?`<p style="padding:8px;opacity:.7"><small>Elenco limitato a 400 di ${items.length} clienti (la mappa li mostra tutti). Usa i filtri per restringere.</small></p>`:'');document.querySelectorAll('.client').forEach(x=>x.onclick=()=>openDetail(x.dataset.id));document.querySelectorAll('.tour-add').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleTour(b.dataset.tour)})}
function renderMarkers(items){if(!markers||typeof L==='undefined')return;markers.clearLayers();for(const c of items){if(c.lat==null)continue;const st=clientStatus(c);const cls=st.status==='calo'?'risk':st.status==='dormiente'?'sleep':c.orders>0?'order':c.sales>50000?'top':'';const icon=L.divIcon({className:'',html:`<div class="marker-dot ${cls}"></div>`,iconSize:[18,18],iconAnchor:[9,9]});const m=L.marker([c.lat,c.lng],{icon,draggable:true}).addTo(markers).bindTooltip(c.name||c.id);m.on('click',()=>openDetail(c.id));m.on('dragend',e=>{const p=e.target.getLatLng();c.lat=p.lat;c.lng=p.lng;c.manualPosition=true;save()})}}
function openDetail(id){currentId=id;const c=project.clients[id];const years=Object.entries(c.saleYears||{}).sort((a,b)=>b[0]-a[0]).map(([y,v])=>`${y}: ${euro(v)}`).join('<br>')||'—';$('#detail').innerHTML=`<h2>${escapeHtml(c.name||c.id)}</h2><p>${escapeHtml([c.address,c.cap,c.city,c.province].filter(Boolean).join(', '))}</p><div class="detail-grid"><div class="detail-box"><b>${euro(c.orders)}</b><span>Ordini aperti</span></div><div class="detail-box"><b>${euro(c.sales)}</b><span>Vendite totali</span></div><div class="detail-box"><b>${escapeHtml(c.agent||'—')}</b><span>Agente</span></div><div class="detail-box"><b>${years}</b><span>Vendite per anno</span></div></div><div class="field"><label>Coordinate</label><div class="row"><input id="lat" value="${c.lat??''}" placeholder="Latitudine"><input id="lng" value="${c.lng??''}" placeholder="Longitudine"></div></div><div class="field"><label>Note locali</label><textarea id="note">${escapeHtml(c.note||'')}</textarea></div><div class="detail-actions"><button type="button" id="tourToggle">${project.tour?.includes(c.id)?'− Rimuovi dal giro':'+ Aggiungi al giro'}</button><button type="button" id="saveDetail" class="primary">Salva</button><a class="button" target="_blank" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.lat!=null?`${c.lat},${c.lng}`:[c.address,c.city,c.province].join(' '))}">Naviga</a></div><p><small>${c.phones?.map(escapeHtml).join(' · ')||''}<br>${c.emails?.map(escapeHtml).join(' · ')||''}</small></p>`;$('#tourToggle').onclick=()=>{toggleTour(id);$('#detailDialog').close()};$('#saveDetail').onclick=()=>{const lat=parseFloat($('#lat').value),lng=parseFloat($('#lng').value);c.lat=Number.isFinite(lat)?lat:null;c.lng=Number.isFinite(lng)?lng:null;c.manualPosition=Number.isFinite(lat)&&Number.isFinite(lng);c.note=$('#note').value;save();$('#detailDialog').close()};$('#detailDialog').showModal()}
async function geocodeMissing(){const list=filtered().filter(c=>c.lat==null&&c.address&&c.city);if(!list.length)return alert('Nessun cliente da geocodificare nel filtro corrente.');if(!confirm(`Geocodificare ${list.length} indirizzi?`))return;let done=0;for(const c of list){$('#status').textContent=`Geocodifica ${done+1}/${list.length}: ${c.name}`;try{const tries=[[c.address,c.cap,c.city,c.province,'Italia'],[c.cap,c.city,c.province,'Italia'],[c.city,c.province,'Italia']];for(const parts of tries){const q=parts.filter(Boolean).join(', ');if(!q)continue;const res=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(q)}`,{headers:{'Accept-Language':'it'}});const data=await res.json();if(data[0]){c.lat=Number(data[0].lat);c.lng=Number(data[0].lon);break}await new Promise(r=>setTimeout(r,1100))}}catch(e){console.warn(e)}done++;if(done%10===0)await persistProject();renderMarkers(filtered());await new Promise(r=>setTimeout(r,1100))}save();alert(`Geocodifica completata: ${done} indirizzi elaborati.`)}
function exportProject(){const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`maps-app-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)}
function fit(){if(!map)return alert('La mappa richiede una connessione Internet.');const pts=filtered().filter(c=>c.lat!=null).map(c=>[c.lat,c.lng]);if(pts.length)map.fitBounds(pts,{padding:[30,30]})}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
$('#excelInput').onchange=e=>importFiles([...e.target.files]);$('#projectInput').onchange=async e=>{try{const p=JSON.parse(await e.target.files[0].text());if(!p.clients)throw 0;project=p;await save();fit()}catch{alert('Progetto non valido')}};$('#exportBtn').onclick=exportProject;$('#fitBtn').onclick=fit;$('#geocodeBtn').onclick=geocodeMissing;$('#tourAddFiltered').onclick=tourAddFiltered;$('#tourClear').onclick=()=>{project.tour=[];invalidateRoute();save()};$('#tourOptimize').onclick=optimizeTour;$('#startGps').onclick=setStartGps;$('#startAddr').onchange=setStartAddr;$('#mailExport').onclick=exportMail;$('#mailCopy').onclick=copyMail;$('#mailManage').onclick=()=>{renderMailDialog();$('#mailDialog').showModal()};$('#mailClose').onclick=()=>$('#mailDialog').close();$('#mailAll').onclick=()=>mailBulk('all');$('#mailNone').onclick=()=>mailBulk('none');$('#mailNoPec').onclick=()=>mailBulk('nopec');['costConsumo','costPrezzo','costPedaggio','costQuota'].forEach(id=>{$('#'+id).onchange=()=>{project.costParams??={consumo:7,prezzo:1.90,pedaggio:0.095,quota:60};project.costParams.consumo=Number($('#costConsumo').value)||7;project.costParams.prezzo=Number($('#costPrezzo').value)||1.90;project.costParams.pedaggio=Number($('#costPedaggio').value)||0.095;project.costParams.quota=Math.min(100,Math.max(0,Number($('#costQuota').value)||0));save()}});['search','productSearch','agentFilter','statusFilter','movementFilter','yearFrom','yearTo','onlyOrders','onlySales','onlyMissing'].forEach(id=>$(`#${id}`).addEventListener(['search','productSearch'].includes(id)?'input':'change',render));const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').hidden=false});
window.addEventListener('appinstalled',()=>{deferredPrompt=null;$('#installBtn').hidden=true});
if(!isStandalone())$('#installBtn').hidden=false;
$('#installBtn').onclick=async()=>{
  if(deferredPrompt){deferredPrompt.prompt();const{outcome}=await deferredPrompt.userChoice;deferredPrompt=null;if(outcome==='accepted')$('#installBtn').hidden=true;return}
  if(isIOS()){alert('Per installare su iPhone/iPad:\n\n1. Apri questa pagina in Safari\n2. Tocca il pulsante Condividi (quadrato con freccia)\n3. Scorri e tocca “Aggiungi a schermata Home”\n4. Conferma con “Aggiungi”');return}
  alert('Per installare l’app:\n\n• Chrome/Edge: menu ⋮ → “Installa Maps APP” (o icona di installazione nella barra degli indirizzi)\n• Firefox: non supporta l’installazione PWA su desktop\n\nNota: serve HTTPS (o localhost). Se la voce non compare, ricarica la pagina e riprova.')};
(async()=>{await load();initMap();render();if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').then(reg=>{
 reg.addEventListener('updatefound',()=>{const w=reg.installing;if(!w)return;w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)showUpdateBanner()})});
 reg.update().catch(()=>{});setInterval(()=>reg.update().catch(()=>{}),60*60*1000);
 checkVersion()}).catch(e=>console.warn('SW',e));else setVerBadge('no SW')})();
