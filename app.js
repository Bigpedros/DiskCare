const state={
  files:[],duplicateGroups:[],folderGroups:[],opportunities:[],selectedOps:new Set(),
  profile:"normal",pendingProfile:"normal",quarantine:[],rootName:"",rootHandle:null,verifyRunning:false,
  transfer:{sourceType:null,fileHandles:[],folderHandle:null,destHandle:null},compare:{a:null,b:null,mapA:null,mapB:null,onlyA:[],onlyB:[],same:[],conflicts:[]}
};
const $=id=>document.getElementById(id);
const fmt=b=>{if(!b||b<1)return"0 B";const u=["B","KB","MB","GB","TB"];const i=Math.min(4,Math.floor(Math.log(b)/Math.log(1024)));return(b/1024**i).toFixed(i?1:0)+" "+u[i]};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=p=>String(p||"").replaceAll("\\","/").replace(/\/+/g,"/").replace(/\/$/,"");
const dirname=p=>{const x=norm(p),i=x.lastIndexOf("/");return i>0?x.slice(0,i):x};
const basename=p=>norm(p).split("/").pop()||norm(p);
const ext=n=>{const i=n.lastIndexOf(".");return i>=0?n.slice(i).toLowerCase():""};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const isMedia=e=>[".jpg",".jpeg",".png",".gif",".webp",".bmp",".mp3",".wav",".flac",".mp4",".mov",".avi",".mkv",".mpeg",".wmv"].includes(e);
const isDocument=e=>[".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".txt",".rtf",".odt",".dwg",".dxf",".psd",".ai",".aep"].includes(e);
const isArchive=e=>[".zip",".rar",".7z",".iso",".tar",".gz"].includes(e);
const isInstaller=e=>[".exe",".msi",".msix",".appx",".cab",".bin"].includes(e);

function isRecyclePath(path){return norm(path).toLowerCase().includes("/$recycle.bin/")}
function isProtectedPath(path){
  const p=norm(path).toLowerCase();
  return p.includes("/system volume information/")||p.endsWith("/system volume information")||
    p.includes("/windows/")||p.startsWith("c:/windows")||p.includes("/winsxs/")||
    p.includes("/program files/")||p.includes("/program files (x86)/")||p.includes("/programdata/")||
    p.endsWith("/pagefile.sys")||p.endsWith("/hiberfil.sys")||p.endsWith("/swapfile.sys");
}
function isResidualFile(f){
  const n=f.name.toLowerCase(),p=norm(f.path).toLowerCase();
  if([".ds_store","thumbs.db","desktop.ini","ehthumbs.db"].includes(n))return true;
  if(n.startsWith("~$")||n.endsWith(".tmp")||n.endsWith(".temp"))return true;
  return false;
}
function isRegenerableCache(f){
  const p=norm(f.path).toLowerCase();
  return p.includes("/adobe premiere pro video previews/")||p.includes("/adobe premiere pro audio previews/")||
    p.includes("/cacheclip/")||p.includes("/media cache/")||p.includes("/code cache/")||
    (p.includes("/cache/")&&f.old);
}
function advice(f){
  if(isRecyclePath(f.path))return{type:"check",label:"Cestino",reason:"Contenuto già eliminato dall'utente: può liberare spazio, ma va confermato."};
  if(isProtectedPath(f.path))return{type:"protect",label:"Non toccare",reason:"File o percorso di sistema protetto da DiskCare."};
  if(isResidualFile(f))return{type:"residual",label:"Residuo sicuro",reason:"Metadato o temporaneo di scarso valore."};
  if(isRegenerableCache(f))return{type:"quarantine",label:"Cache rigenerabile",reason:"Preview/cache applicativa normalmente rigenerabile; verificare che il progetto non sia in uso."};
  if(state.duplicateGroups.some(g=>g.files.some(x=>x.id===f.id)))return{type:"check",label:"Duplicato",reason:"Stesso nome e dimensione: richiede verifica del contenuto."};
  const e=ext(f.name);
  if(isInstaller(e)&&f.old)return{type:"quarantine",label:"Installer residuo",reason:"Installer vecchio: spesso resta dopo l'installazione."};
  if(isArchive(e)&&f.old&&f.size>200*1024*1024)return{type:"check",label:"Da verificare",reason:"Archivio vecchio e voluminoso: potrebbe essere un backup."};
  if((isMedia(e)||isDocument(e))&&f.old)return{type:"keep",label:"Conserva",reason:"L'età da sola non rende inutile un file personale."};
  if(f.size>1024*1024*1024&&f.old)return{type:"check",label:"Grande da valutare",reason:"File molto grande: verificare utilità senza considerarlo automaticamente recuperabile."};
  return{type:"keep",label:"Conserva",reason:"Nessun indicatore forte di inutilità."};
}

function buildDuplicateGroups(){
  const map={};
  for(const f of state.files){
    if(!f.size||isProtectedPath(f.path)||isRecyclePath(f.path))continue;
    const key=f.name.toLowerCase()+"|"+f.size;
    (map[key]??=[]).push(f);
  }
  state.duplicateGroups=Object.values(map).filter(g=>g.length>1).map((files,i)=>({
    id:"g"+i,files,verified:false,identical:null,verification:"not-run",keepId:files[0].id
  }));
}
function commonAncestors(path,depth=4){
  const d=dirname(path),parts=norm(d).split("/"),out=[];
  for(let up=0;up<Math.min(depth,parts.length-1);up++){
    const a=parts.slice(0,parts.length-up).join("/");
    if(a&&a.length>1)out.push(a);
  }
  return out;
}
function fileIsUnder(f,folder){
  const p=norm(f.path).toLowerCase(),d=norm(folder).toLowerCase();
  return p===d||p.startsWith(d+"/");
}
function relativeTo(f,folder){
  const p=norm(f.path),d=norm(folder);
  return p.toLowerCase().startsWith((d+"/").toLowerCase())?p.slice(d.length+1):basename(p);
}
function buildFolderGroups(){
  const candidates=new Map();
  for(const g of state.duplicateGroups){
    const files=g.files.slice(0,10);
    for(let i=0;i<files.length;i++)for(let j=i+1;j<files.length;j++){
      const A=commonAncestors(files[i].path,4),B=commonAncestors(files[j].path,4);
      for(const a of A)for(const b of B){
        if(a===b)continue;
        const pair=[a,b].sort(),key=pair[0]+"|||"+pair[1];
        if(!candidates.has(key))candidates.set(key,{a:pair[0],b:pair[1],matchedIds:new Set()});
        candidates.get(key).matchedIds.add(g.id);
      }
    }
  }
  const raw=[];
  for(const c of candidates.values()){
    if(c.matchedIds.size<2)continue;
    const filesA=state.files.filter(f=>fileIsUnder(f,c.a)),filesB=state.files.filter(f=>fileIsUnder(f,c.b));
    if(!filesA.length||!filesB.length)continue;
    const mapA=new Map(filesA.map(f=>[relativeTo(f,c.a).toLowerCase(),f])),mapB=new Map(filesB.map(f=>[relativeTo(f,c.b).toLowerCase(),f]));
    let same=0,sameBytes=0;const onlyA=[],onlyB=[],changed=[],pairs=[];
    for(const [r,fa] of mapA){
      if(!mapB.has(r)){onlyA.push(fa);continue}
      const fb=mapB.get(r);
      if(fa.size===fb.size){same++;sameBytes+=fa.size;pairs.push([fa,fb,r])}else changed.push([fa,fb,r]);
    }
    for(const [r,fb] of mapB)if(!mapA.has(r))onlyB.push(fb);
    const maxCount=Math.max(filesA.length,filesB.length),pct=maxCount?Math.round((same/maxCount)*1000)/10:0;
    if(same<2||pct<50)continue;
    raw.push({a:c.a,b:c.b,countA:filesA.length,countB:filesB.length,matches:same,bytes:sameBytes,pct,onlyA,onlyB,changed,pairs,verified:false,verification:"not-run",consolidated:false});
  }
  raw.sort((x,y)=>(y.bytes-x.bytes)||(y.matches-x.matches));
  const kept=[];
  for(const r of raw){
    const nested=kept.some(k=>((r.a.startsWith(k.a+"/")&&r.b.startsWith(k.b+"/"))||(r.a.startsWith(k.b+"/")&&r.b.startsWith(k.a+"/")))&&k.matches>=r.matches*.9);
    if(!nested)kept.push(r);
    if(kept.length>=40)break;
  }
  state.folderGroups=kept.map((x,i)=>({...x,id:"f"+i}));
}
function inAnyFolderGroup(f){
  return state.folderGroups.some(g=>fileIsUnder(f,g.a)||fileIsUnder(f,g.b));
}
function buildOpportunities(){
  const ops=[],claimed=new Set();
  for(const fg of state.folderGroups){
    const ids=new Set();
    state.duplicateGroups.forEach(g=>g.files.forEach(f=>{if(fileIsUnder(f,fg.a)||fileIsUnder(f,fg.b))ids.add(f.id)}));
    ids.forEach(id=>claimed.add(id));
    const verified=fg.verified&&fg.verification==="full";
    ops.push({id:"folder:"+fg.id,type:"folder",title:"Cartelle/alberi duplicati",subtitle:basename(fg.a)+" ↔ "+basename(fg.b),bytes:fg.bytes,status:verified?"verified":"potential",risk:fg.changed.length?"medium":"low",ref:fg.id});
  }
  for(const g of state.duplicateGroups){
    if(g.files.some(f=>claimed.has(f.id)))continue;
    const bytes=g.files[0].size*(g.files.length-1);
    g.files.forEach(f=>claimed.add(f.id));
    ops.push({id:"dup:"+g.id,type:"duplicate",title:"Duplicato: "+g.files[0].name,subtitle:g.files.length+" copie",bytes,status:g.verified&&g.identical?"verified":"potential",risk:"low",ref:g.id});
  }
  for(const f of state.files){
    if(claimed.has(f.id)||isProtectedPath(f.path))continue;
    if(isResidualFile(f)){ops.push({id:"res:"+f.id,type:"residual",title:"Residuo sicuro: "+f.name,subtitle:f.path,bytes:f.size,status:"verified",risk:"low",ref:f.id});claimed.add(f.id);continue}
    if(isRegenerableCache(f)){ops.push({id:"cache:"+f.id,type:"cache",title:"Cache/preview rigenerabile",subtitle:f.path,bytes:f.size,status:"potential",risk:"low",ref:f.id});claimed.add(f.id);continue}
    if(isRecyclePath(f.path)){ops.push({id:"bin:"+f.id,type:"recycle",title:"Cestino",subtitle:f.path,bytes:f.size,status:"potential",risk:"low",ref:f.id});claimed.add(f.id);continue}
    if(isInstaller(ext(f.name))&&f.old){ops.push({id:"inst:"+f.id,type:"installer",title:"Installer vecchio",subtitle:f.path,bytes:f.size,status:"potential",risk:"medium",ref:f.id});claimed.add(f.id)}
  }
  ops.sort((a,b)=>b.bytes-a.bytes);
  state.opportunities=ops;
  for(const id of Array.from(state.selectedOps))if(!ops.some(o=>o.id===id))state.selectedOps.delete(id);
}
function opportunityTotals(){
  let verified=0,potential=0,selected=0;
  state.opportunities.forEach(o=>{if(o.status==="verified")verified+=o.bytes;else potential+=o.bytes;if(state.selectedOps.has(o.id))selected+=o.bytes});
  return{verified,potential,selected};
}
function recalc(){
  buildDuplicateGroups();buildFolderGroups();buildOpportunities();
  const total=state.files.reduce((s,f)=>s+f.size,0),ads=state.files.map(advice),cnt=t=>ads.filter(a=>a.type===t).length,ot=opportunityTotals();
  $("spaceTotal").textContent=fmt(total);$("potentialRecover").textContent=fmt(ot.verified+ot.potential);
  $("dupBadge").textContent=state.duplicateGroups.length;$("folderBadge").textContent=state.folderGroups.length;$("residualBadge").textContent=cnt("residual");$("reviewBadge").textContent=cnt("check");$("protectBadge").textContent=cnt("protect");$("oppBadge").textContent=state.opportunities.length;
  renderOpportunities();renderDuplicateGroups();renderFolderGroups();renderResiduals();renderReview();renderProtected();updateQ();
}
function renderOpportunities(){
  const ot=opportunityTotals();
  $("oppVerified").textContent=fmt(ot.verified);
  $("oppPotential").textContent=fmt(ot.potential);
  $("oppSelected").textContent=fmt(ot.selected);
  $("oppCount").textContent=state.opportunities.length;
  $("potentialRecover").textContent=fmt(ot.verified+ot.potential);

  const folderSet=new Set();
  state.files.forEach(f=>{const d=dirname(f.path);if(d)folderSet.add(d.toLowerCase())});
  const duplicateCopies=state.duplicateGroups.reduce((s,g)=>s+Math.max(0,g.files.length-1),0);
  const recoverTotal=ot.verified+ot.potential;

  const category=(types)=>state.opportunities.filter(o=>types.includes(o.type));
  const sumBytes=items=>items.reduce((s,o)=>s+o.bytes,0);
  const dup=category(["duplicate"]);
  const folders=category(["folder"]);
  const caches=category(["cache"]);
  const safe=state.opportunities.filter(o=>o.status==="verified"&&o.risk==="low");
  const review=state.opportunities.filter(o=>o.status!=="verified"&&!["duplicate","folder","cache"].includes(o.type));

  if($("inventoryFiles"))$("inventoryFiles").textContent=state.files.length.toLocaleString("it-IT");
  if($("inventoryFolders"))$("inventoryFolders").textContent=folderSet.size.toLocaleString("it-IT");
  if($("inventoryDuplicates"))$("inventoryDuplicates").textContent=duplicateCopies.toLocaleString("it-IT");
  if($("inventoryRecover"))$("inventoryRecover").textContent=fmt(recoverTotal);

  if($("catDupCount"))$("catDupCount").textContent=duplicateCopies.toLocaleString("it-IT");
  if($("catDupBytes"))$("catDupBytes").textContent=fmt(sumBytes(dup));
  if($("catFolderCount"))$("catFolderCount").textContent=state.folderGroups.length.toLocaleString("it-IT");
  if($("catFolderBytes"))$("catFolderBytes").textContent=fmt(sumBytes(folders));
  if($("catCacheCount"))$("catCacheCount").textContent=caches.length.toLocaleString("it-IT");
  if($("catCacheBytes"))$("catCacheBytes").textContent=fmt(sumBytes(caches));
  if($("catSafeCount"))$("catSafeCount").textContent=safe.length.toLocaleString("it-IT");
  if($("catSafeBytes"))$("catSafeBytes").textContent=fmt(sumBytes(safe));
  if($("catReviewCount"))$("catReviewCount").textContent=review.length.toLocaleString("it-IT");
  if($("catReviewBytes"))$("catReviewBytes").textContent=fmt(sumBytes(review));

  const card=o=>{
    const checked=state.selectedOps.has(o.id),status=o.status==="verified"?"<span class=\"badge verified\">Già controllato</span>":"<span class=\"badge potential\">Da controllare</span>";
    const risk="<span class=\"risk "+o.risk+"\">Rischio "+(o.risk==="low"?"basso":o.risk==="medium"?"medio":"alto")+"</span>";
    return "<div class=\"opportunity-card\"><div>"+status+"<div>"+risk+"</div></div><div><div class=\"opp-title\">"+esc(o.title)+"</div><div class=\"opp-sub\">"+esc(o.subtitle)+"</div></div><div class=\"opp-space\">"+fmt(o.bytes)+"</div><div class=\"action-row\"><button class=\"mini-btn "+(checked?"good":"")+"\" onclick=\"toggleOpportunity('"+o.id+"')\">"+(checked?"Selezionato":"Seleziona")+"</button><button class=\"mini-btn\" onclick=\"openOpportunity('"+o.id+"')\">Apri</button></div></div>";
  };
  $("opportunityWrap").innerHTML=state.opportunities.length?state.opportunities.map(card).join(""):"<div class=\"empty-state\"><strong>Nessun dettaglio disponibile</strong></div>";
}
window.toggleOpportunity=id=>{state.selectedOps.has(id)?state.selectedOps.delete(id):state.selectedOps.add(id);renderOpportunities()};
window.openOpportunity=id=>{const o=state.opportunities.find(x=>x.id===id);if(!o)return;if(o.type==="folder")document.querySelector('[data-section="folders"]').click();else if(o.type==="duplicate")document.querySelector('[data-section="duplicates"]').click();else if(o.type==="residual")document.querySelector('[data-section="residuals"]').click();else document.querySelector('[data-section="review"]').click()};
$("selectSafeBtn").onclick=()=>{state.opportunities.filter(o=>o.status==="verified"&&o.risk==="low").forEach(o=>state.selectedOps.add(o.id));renderOpportunities()};
$("clearSelectionBtn").onclick=()=>{state.selectedOps.clear();renderOpportunities()};
$("openOppBtn").onclick=()=>document.querySelector('[data-section="opportunities"]').click();

function tableBadge(a){const cls=a.type==="quarantine"?"good":a.type;return "<span class=\"badge "+cls+"\">"+esc(a.label)+"</span>"}
function renderResiduals(){const items=state.files.filter(isResidualFile).sort((a,b)=>b.size-a.size);$("residualWrap").innerHTML=items.length?"<table><thead><tr><th>Tipo</th><th>File</th><th>Dimensione</th><th>Percorso</th><th>Azione</th></tr></thead><tbody>"+items.map(f=>"<tr><td><span class=\"badge residual\">Residuo sicuro</span></td><td>"+esc(f.name)+"</td><td>"+fmt(f.size)+"</td><td class=\"path\">"+esc(f.path)+"</td><td><button class=\"mini-btn good\" onclick=\"sendToQuarantine('"+f.id+"')\">Quarantena</button></td></tr>").join("")+"</tbody></table>":"<div class=\"empty-state\"><strong>Nessun residuo rilevato</strong></div>"}
function renderReview(){const items=state.files.map(f=>({f,a:advice(f)})).filter(x=>["check","quarantine"].includes(x.a.type)).sort((x,y)=>y.f.size-x.f.size);$("reviewWrap").innerHTML=items.length?"<table><thead><tr><th>Consiglio</th><th>Nome</th><th>Dimensione</th><th>Motivazione</th><th>Azione</th></tr></thead><tbody>"+items.map(x=>"<tr><td>"+tableBadge(x.a)+"</td><td>"+esc(x.f.name)+"<div class=\"path\">"+esc(x.f.path)+"</div></td><td>"+fmt(x.f.size)+"</td><td class=\"reason\">"+esc(x.a.reason)+"</td><td>"+(x.a.type==="quarantine"?"<button class=\"mini-btn good\" onclick=\"sendToQuarantine('"+x.f.id+"')\">Quarantena</button>":"—")+"</td></tr>").join("")+"</tbody></table>":"<div class=\"empty-state\"><strong>Nessun dato</strong></div>"}
function renderProtected(){const items=state.files.filter(f=>isProtectedPath(f.path)).sort((a,b)=>b.size-a.size);$("protectedWrap").innerHTML=items.length?"<table><thead><tr><th>Stato</th><th>Nome</th><th>Dimensione</th><th>Percorso</th></tr></thead><tbody>"+items.map(f=>"<tr><td><span class=\"badge protect\">Non toccare</span></td><td>"+esc(f.name)+"</td><td>"+fmt(f.size)+"</td><td class=\"path\">"+esc(f.path)+"</td></tr>").join("")+"</tbody></table>":"<div class=\"empty-state\"><strong>Nessun elemento protetto</strong></div>"}

async function hashFile(f){
  if(f.demoHash)return"demo:"+f.demoHash;
  if(!f.fileObj)return null;
  if(f.fileObj.size>512*1024*1024)return null;
  const buf=await f.fileObj.arrayBuffer(),dig=await crypto.subtle.digest("SHA-256",buf);
  return Array.from(new Uint8Array(dig)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function verifyGroup(id){
  const g=state.duplicateGroups.find(x=>x.id===id);if(!g)return;
  const hashes=[];
  for(const f of g.files){const h=await hashFile(f);if(!h){g.verified=false;g.identical=null;g.verification="size-only";renderDuplicateGroups();buildOpportunities();renderOpportunities();return}hashes.push(h)}
  g.identical=hashes.every(h=>h===hashes[0]);g.verified=true;g.verification="full";buildOpportunities();renderOpportunities();renderDuplicateGroups();
}
window.verifyGroup=verifyGroup;
function duplicateGroupsForFolder(fg){
  return state.duplicateGroups.filter(g=>g.files.some(f=>fileIsUnder(f,fg.a))&&g.files.some(f=>fileIsUnder(f,fg.b)));
}
function folderGroupFullyVerified(fg){
  const gs=duplicateGroupsForFolder(fg);
  return gs.length>0&&gs.every(g=>g.verified&&g.identical);
}
function pathParts(path){return norm(path).split("/").filter(Boolean)}
function commonPathInfo(a,b){
  const A=pathParts(a),B=pathParts(b);let i=0;
  while(i<A.length&&i<B.length&&A[i].toLowerCase()===B[i].toLowerCase())i++;
  return{common:A.slice(0,i),branchA:A.slice(i),branchB:B.slice(i)};
}
function cleanFolderName(name){
  return String(name||"").toLowerCase().replace(/\b(copy|copia|backup|bak|old|vecchio|nuovo|new)\b/g,"").replace(/[^a-z0-9àèéìòù]+/g," ").replace(/\s+/g," ").trim();
}
function folderNameSimilarity(a,b){
  const A=new Set(cleanFolderName(a).split(" ").filter(Boolean)),B=new Set(cleanFolderName(b).split(" ").filter(Boolean));
  if(!A.size||!B.size)return 0;
  let same=0;A.forEach(x=>{if(B.has(x))same++});
  return same/Math.max(A.size,B.size);
}
function folderRelationship(fg){
  const p=commonPathInfo(fg.a,fg.b),sameDrive=pathParts(fg.a)[0]?.toLowerCase()===pathParts(fg.b)[0]?.toLowerCase();
  const nameSim=folderNameSimilarity(basename(fg.a),basename(fg.b));
  const noConflicts=fg.changed.length===0;
  let label="Relazione non chiara",confidence="bassa",reason="Le cartelle condividono alcuni contenuti, ma non abbastanza elementi per dedurre con sicurezza perché esistano entrambe.";
  if(fg.pct>=90&&noConflicts&&(nameSim>=.5||p.common.length>=2)){
    label="Stesso progetto — molto probabile";confidence="alta";
    reason="La maggior parte dei contenuti coincide, non risultano conflitti e i nomi o il percorso indicano una forte relazione.";
  }else if(fg.pct>=75&&noConflicts){
    label="Possibile duplicato riorganizzato";confidence="medio-alta";
    reason="I contenuti coincidono in larga parte, ma la struttura dei percorsi è diversa: potrebbe essere una copia o una riorganizzazione dello stesso progetto.";
  }else if(fg.pct>=60&&fg.changed.length<=2){
    label="Possibile stesso progetto";confidence="media";
    reason="Esiste una sovrapposizione significativa, ma alcune differenze richiedono una verifica prima di considerarle copie dello stesso progetto.";
  }else if(!sameDrive&&fg.pct<70){
    label="Possibili progetti o archivi diversi";confidence="media";
    reason="Le cartelle si trovano su rami o dischi diversi e condividono solo parte dei contenuti.";
  }
  return{...p,label,confidence,reason};
}
function relativeFromScanRoot(path){
  const p=norm(path),root=norm(state.rootName);
  if(root&&p.toLowerCase()===root.toLowerCase())return"";
  if(root&&p.toLowerCase().startsWith((root+"/").toLowerCase()))return p.slice(root.length+1);
  return p.replace(/^\/+/, "");
}
function renderPathTree(fg){
  const r=folderRelationship(fg);
  const rootLabel=state.rootName||pathParts(fg.a)[0]||"Radice analizzata";
  const A=pathParts(relativeFromScanRoot(fg.a)),B=pathParts(relativeFromScanRoot(fg.b));
  const branch=(parts,side)=>"<div class=\"tree-route\"><span class=\"tree-badge\">"+side+"</span>"+(parts.length?parts.map((p,i)=>"<div class=\"tree-line\" style=\"--depth:"+i+"\"><span>└─</span><b>"+esc(p)+"</b></div>").join(""):"<div class=\"tree-line\"><span>└─</span><b>"+esc(rootLabel)+"</b></div>")+"</div>";
  return "<div class=\"folder-tree-column\">"+
    "<span class=\"eyebrow\">POSIZIONE NELL'ALBERO</span>"+
    "<div class=\"tree-root\"><span>Radice analizzata</span><strong>"+esc(rootLabel)+"</strong></div>"+
    "<div class=\"tree-routes\">"+branch(A,"A")+branch(B,"B")+"</div>"+
    "<div class=\"tree-relation\"><strong>"+esc(r.label)+"</strong><span>Confidenza "+esc(r.confidence)+"</span><p>"+esc(r.reason)+"</p></div>"+
  "</div>";
}
function renderExclusiveFiles(fg,side){
  const items=side==="A"?fg.onlyA:fg.onlyB;
  const other=side==="A"?"B":"A";
  return "<div class=\"exclusive-list\"><div class=\"exclusive-head\"><strong>Solo nella cartella "+side+"</strong><span>"+items.length+" file che non esistono nella cartella "+other+"</span></div>"+
    (items.length?items.map(f=>"<div class=\"exclusive-file\"><span>"+esc(f.name)+"</span><small>"+esc(f.path)+"</small><b>"+fmt(f.size)+"</b></div>").join(""):"<div class=\"exclusive-empty\">Nessun file esclusivo.</div>")+
  "</div>";
}
function renderFolderDuplicateCard(fg){
  const gs=duplicateGroupsForFolder(fg);
  const verified=folderGroupFullyVerified(fg);
  const keep=fg.keepSide||null;
  const details=gs.map(g=>{
    const a=g.files.find(f=>fileIsUnder(f,fg.a)),b=g.files.find(f=>fileIsUnder(f,fg.b));
    return "<div class=\"folder-file-row\"><div><strong>"+esc(g.files[0].name)+"</strong><small>"+esc(a?a.path:"")+" ↔ "+esc(b?b.path:"")+"</small></div><span>"+fmt(g.files[0].size)+"</span></div>";
  }).join("");
  const aNote=fg.onlyA.length?("Contiene "+fg.onlyA.length+" file che "+(fg.onlyA.length===1?"non esiste":"non esistono")+" nella cartella B."):"Tutti i suoi file risultano presenti anche nella cartella B.";
  const bNote=fg.onlyB.length?("Contiene "+fg.onlyB.length+" file che "+(fg.onlyB.length===1?"non esiste":"non esistono")+" nella cartella A."):"Tutti i suoi file risultano presenti anche nella cartella A.";
  return "<article class=\"duplicate-folder-card\">"+
    "<div class=\"duplicate-folder-head\"><div><span class=\"eyebrow\">COPPIA DI CARTELLE</span><h3>"+esc(basename(fg.a))+" ↔ "+esc(basename(fg.b))+"</h3><p>"+fg.matches+" file in comune • "+fmt(fg.bytes)+" duplicati potenziali</p></div><span class=\"folder-verify-state\">"+(verified?"Identici verificati":"Da verificare")+"</span></div>"+
    "<div class=\"folder-comparison-grid\">"+
      "<div class=\"folder-choice folder-column "+(keep==="A"?"selected-folder":"")+"\"><span>Cartella A</span><strong>"+esc(fg.a)+"</strong><small>"+fg.countA+" file</small><p>"+esc(aNote)+"</p><button class=\"btn ghost\" onclick=\"chooseFolderKeep('"+fg.id+"','A')\">Mantieni A</button></div>"+
      "<div class=\"folder-choice folder-column "+(keep==="B"?"selected-folder":"")+"\"><span>Cartella B</span><strong>"+esc(fg.b)+"</strong><small>"+fg.countB+" file</small><p>"+esc(bNote)+"</p><button class=\"btn ghost\" onclick=\"chooseFolderKeep('"+fg.id+"','B')\">Mantieni B</button></div>"+
      renderPathTree(fg)+
    "</div>"+
    "<div class=\"duplicate-folder-stats readable-stats\">"+
      "<div><span>Presenti in entrambe</span><b>"+fg.matches+"</b></div>"+
      "<div><span>Solo nella cartella A</span><b>"+fg.onlyA.length+"</b>"+(fg.onlyA.length?"<button class=\"stat-link\" onclick=\"toggleExclusiveFiles('"+fg.id+"','A')\">Mostra quale</button>":"")+"</div>"+
      "<div><span>Solo nella cartella B</span><b>"+fg.onlyB.length+"</b>"+(fg.onlyB.length?"<button class=\"stat-link\" onclick=\"toggleExclusiveFiles('"+fg.id+"','B')\">Mostra quale</button>":"")+"</div>"+
      "<div><span>File diversi da controllare</span><b>"+fg.changed.length+"</b></div>"+
      "<div><span>Copie duplicate</span><b>"+gs.length+"</b></div>"+
      "<div><span>Spazio duplicato</span><b>"+fmt(fg.bytes)+"</b></div>"+
    "</div>"+
    "<div class=\"exclusive-files-panel\" id=\"exclusiveFiles-"+fg.id+"\" hidden></div>"+
    "<div class=\"folder-actions-block\"><span>Azioni principali</span><div class=\"duplicate-folder-actions primary-folder-actions\">"+
      "<button class=\"mini-btn good\" onclick=\"consolidateFolder('"+fg.id+"','BtoA')\">Unisci in A</button>"+
      "<button class=\"mini-btn good\" onclick=\"consolidateFolder('"+fg.id+"','AtoB')\">Unisci in B</button>"+
      (keep?"<button class=\"mini-btn danger\" onclick=\"quarantineFolderDuplicates('"+fg.id+"')\">Quarantena copie escluse</button>":"")+
    "</div></div>"+
    "<div class=\"folder-actions-block secondary-actions\"><span>Altre azioni</span><div class=\"duplicate-folder-actions\">"+
      "<button class=\"mini-btn\" onclick=\"toggleFolderDuplicateDetails('"+fg.id+"')\">Mostra tutti i file</button>"+
      "<button class=\"mini-btn\" onclick=\"prepareFolderMove('"+fg.id+"','A')\">Sposta A</button>"+
      "<button class=\"mini-btn\" onclick=\"prepareFolderMove('"+fg.id+"','B')\">Sposta B</button>"+
      "<button class=\"mini-btn\" onclick=\"clearFolderChoice('"+fg.id+"')\">Non fare nulla</button>"+
    "</div></div>"+
    (!keep?"<div class=\"folder-action-note\">Scegli quale cartella vuoi conservare solo se intendi intervenire. Nessun file viene rimosso automaticamente.</div>":"")+
    "<div class=\"folder-duplicate-details\" id=\"folderDupDetails-"+fg.id+"\" hidden>"+(details||"<div class=\"empty-state\"><strong>Nessun dettaglio file</strong></div>")+"</div>"+
  "</article>";
}
window.toggleExclusiveFiles=(id,side)=>{
  const fg=state.folderGroups.find(x=>x.id===id),el=$("exclusiveFiles-"+id);if(!fg||!el)return;
  const next=el.dataset.side===side&&!el.hidden;
  if(next){el.hidden=true;el.dataset.side="";return}
  el.innerHTML=renderExclusiveFiles(fg,side);el.dataset.side=side;el.hidden=false;
};
window.clearFolderChoice=id=>{const fg=state.folderGroups.find(x=>x.id===id);if(!fg)return;fg.keepSide=null;renderDuplicateGroups()};
function renderDuplicateGroups(){
  const groupedIds=new Set();
  state.folderGroups.forEach(fg=>duplicateGroupsForFolder(fg).forEach(g=>groupedIds.add(g.id)));
  const loose=state.duplicateGroups.filter(g=>!groupedIds.has(g.id)).slice().sort((a,b)=>(b.files[0].size*(b.files.length-1))-(a.files[0].size*(a.files.length-1)));

  $("duplicateFolderGroupsWrap").innerHTML=state.folderGroups.length?state.folderGroups.map(renderFolderDuplicateCard).join(""):"<div class=\"empty-state\"><strong>Nessuna coppia di cartelle duplicate o simili</strong></div>";
  $("duplicateGroupsWrap").innerHTML=loose.length?loose.map(g=>{
    const rec=g.files[0].size*(g.files.length-1),status=g.verified?(g.identical?"Identici verificati":"Contenuti diversi"):(g.verification==="size-only"?"Verifica completa non disponibile per file molto grandi":"Da verificare");
    return "<article class=\"duplicate-group\"><div class=\"dup-head\"><div><strong>"+esc(g.files[0].name)+"</strong><span> • "+g.files.length+" copie • recuperabili "+fmt(rec)+"</span></div><span>"+esc(status)+"</span></div><div class=\"dup-files\">"+g.files.map(f=>"<div class=\"dup-file\"><input class=\"radio\" type=\"radio\" name=\"keep-"+g.id+"\" "+(g.keepId===f.id?"checked":"")+" onchange=\"setKeep('"+g.id+"','"+f.id+"')\"><div><div class=\"dup-name\">"+esc(f.name)+"</div><div class=\"dup-path\">"+esc(f.path)+"</div></div><div>"+fmt(f.size)+"</div><div class=\"dup-actions\"><button class=\"mini-btn\" onclick=\"verifyGroup('"+g.id+"')\">Verifica contenuto</button></div></div>").join("")+"</div></article>";
  }).join(""):"<div class=\"empty-state\"><strong>Nessun duplicato sparso: i duplicati trovati sono già raggruppati per cartella.</strong></div>";
}
window.setKeep=(gid,fid)=>{const g=state.duplicateGroups.find(x=>x.id===gid);if(g)g.keepId=fid};
window.toggleFolderDuplicateDetails=id=>{const el=$("folderDupDetails-"+id);if(el)el.hidden=!el.hidden};
window.chooseFolderKeep=(id,side)=>{
  const fg=state.folderGroups.find(x=>x.id===id);if(!fg)return;
  fg.keepSide=side;
  duplicateGroupsForFolder(fg).forEach(g=>{
    const chosen=g.files.find(f=>fileIsUnder(f,side==="A"?fg.a:fg.b));
    if(chosen)g.keepId=chosen.id;
  });
  renderDuplicateGroups();
};
window.quarantineFolderDuplicates=id=>{
  const fg=state.folderGroups.find(x=>x.id===id);if(!fg||!fg.keepSide)return;
  const gs=duplicateGroupsForFolder(fg);
  if(!gs.length)return;
  if(!gs.every(g=>g.verified&&g.identical)){alert("Prima verifica i duplicati: DiskCare non mette in quarantena copie non confermate come identiche.");return}
  const keepFolder=fg.keepSide==="A"?fg.a:fg.b;
  let n=0;
  gs.forEach(g=>g.files.forEach(f=>{if(!fileIsUnder(f,keepFolder)&&!state.quarantine.some(q=>q.sourceId===f.id)){sendToQuarantine(f.id);n++}}));
  alert(n+" copie verificate sono state aggiunte alla Quarantena DiskCare. Gli originali scelti restano invariati.");
  renderDuplicateGroups();
};
window.prepareFolderMove=async(id,side)=>{
  const fg=state.folderGroups.find(x=>x.id===id);if(!fg)return;
  if(!state.rootHandle){alert("Per preparare lo spostamento devi aver analizzato una cartella reale, non i dati demo.");return}
  try{
    const path=side==="A"?fg.a:fg.b;
    const h=await getDirHandleForFolder(path,false);
    state.transfer.sourceType="folder";state.transfer.folderHandle=h;state.transfer.fileHandles=[];
    document.querySelector('[data-section="transfer"]').click();
    setTransferMode("copy");
    $("transferModeTitle").textContent="Sposta o copia una cartella";
    $("transferSourceLabel").textContent=basename(path);
    $("transferSourceMeta").textContent=path;
    $("transferStatus").textContent="Origine pronta. Scegli la destinazione, poi Copia oppure Sposta in sicurezza.";
  }catch(e){alert("Impossibile preparare la cartella: "+e.message)}
};
async function prepareDuplicateScan(){
  if(state.files.length>0&&state.duplicateGroups.length>=0)return true;
  if(!window.showDirectoryPicker){
    alert("Per cercare i duplicati usa Chrome o Edge aggiornato.");
    return false;
  }
  try{
    $("verifyPhase").textContent="Scegli una cartella";
    $("verifyText").textContent="Seleziona il disco o la cartella in cui vuoi cercare i duplicati.";
    $("verifyProgress").style.width="0%";$("verifyProgress").parentElement.dataset.progress="0%";
    $("verifyProgress").parentElement.dataset.progress="0%";
    const dir=await showDirectoryPicker({mode:"readwrite"});
    state.rootName=dir.name;
    state.rootHandle=dir;
    $("verifyPhase").textContent="Analisi in corso";
    $("verifyText").textContent="DiskCare sta cercando file con stesso nome e dimensione…";
    const tr={count:0,start:Date.now()};
    state.files=await walk(dir,dir.name,tr);
    $("verifyProgress").style.width="45%";$("verifyProgress").parentElement.dataset.progress="45%";
    $("verifyProgress").parentElement.dataset.progress="45%";
    buildDuplicateGroups();
    buildFolderGroups();
    buildOpportunities();
    recalc();
    updateHomeAfterScan((Date.now()-tr.start)/1000);
    renderDuplicateGroups();
    return true;
  }catch(e){
    if(e.name==="AbortError"){
      $("verifyPhase").textContent="Non avviata";
      $("verifyText").textContent="Nessuna cartella selezionata.";
      return false;
    }
    $("verifyPhase").textContent="Interrotta";
    $("verifyText").textContent="Analisi interrotta: "+e.message;
    return false;
  }
}

$("verifyAllBtn").onclick=async()=>{
  if(state.verifyRunning)return;
  const ready=await prepareDuplicateScan();
  if(!ready)return;

  if(state.duplicateGroups.length===0){
    $("verifyPhase").textContent="Nessun duplicato trovato";
    $("verifyText").textContent="Nel percorso analizzato non sono stati trovati gruppi di file duplicati.";
    $("verifyProgress").style.width="100%";$("verifyProgress").parentElement.dataset.progress="100%";
    $("verifyProgress").parentElement.dataset.progress="100%";
    renderDuplicateGroups();
    return;
  }

  state.verifyRunning=true;
  $("verifyPhase").textContent="Verifica in corso";
  $("verifyText").textContent="Confronto del contenuto dei file duplicati…";
  for(let i=0;i<state.duplicateGroups.length;i++){
    await verifyGroup(state.duplicateGroups[i].id);
    const p=Math.round((i+1)/state.duplicateGroups.length*100);
    $("verifyProgress").style.width=p+"%";$("verifyProgress").parentElement.dataset.progress=p+"%";
    $("verifyProgress").parentElement.dataset.progress=p+"%";
    $("verifyText").textContent=(i+1)+" / "+state.duplicateGroups.length+" gruppi verificati";
  }
  $("verifyPhase").textContent="Verifica completata";
  $("verifyText").textContent=state.duplicateGroups.length+" gruppi controllati.";
  state.verifyRunning=false;
  buildOpportunities();
  renderOpportunities();
};

async function verifyFolderGroup(id){
  const g=state.folderGroups.find(x=>x.id===id);if(!g)return;
  for(const pair of g.pairs){const a=await hashFile(pair[0]),b=await hashFile(pair[1]);if(!a||!b){g.verified=false;g.verification="size-only";renderFolderGroups();return}if(a!==b){g.verified=false;g.verification="mismatch";renderFolderGroups();return}}
  g.verified=true;g.verification="full";buildOpportunities();renderOpportunities();renderFolderGroups();
}
window.verifyFolderGroup=verifyFolderGroup;
function renderFolderGroups(){
  $("folderGroupsWrap").innerHTML=state.folderGroups.length?state.folderGroups.map(g=>{
    const status=g.verified?"Verificata":g.verification==="size-only"?"Richiede desktop per hash grandi":g.verification==="mismatch"?"Differenze di contenuto":"Da verificare";
    return "<article class=\"folder-card\"><div class=\"folder-head\"><div><strong>"+fmt(g.bytes)+" potenzialmente recuperabili</strong><span> • "+g.pct+"% struttura comune</span></div><span>"+esc(status)+"</span></div><div class=\"folder-body\"><div class=\"folder-compare\"><div class=\"folder-path\">A: "+esc(g.a)+"</div><div class=\"versus\">VS</div><div class=\"folder-path\">B: "+esc(g.b)+"</div></div><div class=\"folder-stats\"><div class=\"folder-stat\"><span>File A</span><b>"+g.countA+"</b></div><div class=\"folder-stat\"><span>File B</span><b>"+g.countB+"</b></div><div class=\"folder-stat\"><span>Uguali</span><b>"+g.matches+"</b></div><div class=\"folder-stat\"><span>Solo A</span><b>"+g.onlyA.length+"</b></div><div class=\"folder-stat\"><span>Solo B</span><b>"+g.onlyB.length+"</b></div><div class=\"folder-stat\"><span>Conflitti</span><b>"+g.changed.length+"</b></div></div><div class=\"folder-actions\"><button class=\"mini-btn\" onclick=\"verifyFolderGroup('"+g.id+"')\">Verifica struttura</button><button class=\"mini-btn good\" onclick=\"consolidateFolder('"+g.id+"','AtoB')\">Copia mancanti A → B</button><button class=\"mini-btn good\" onclick=\"consolidateFolder('"+g.id+"','BtoA')\">Copia mancanti B → A</button></div></div></article>";
  }).join(""):"<div class=\"empty-state\"><strong>Nessuna cartella candidata</strong></div>";
}

async function getDirHandleForFolder(folderPath,create){
  if(!state.rootHandle)throw new Error("Scansione senza permesso cartella");
  let rel=norm(folderPath);const root=norm(state.rootName);
  if(rel.toLowerCase()===root.toLowerCase())return state.rootHandle;
  if(rel.toLowerCase().startsWith(root.toLowerCase()+"/"))rel=rel.slice(root.length+1);
  let h=state.rootHandle;
  for(const part of rel.split("/").filter(Boolean))h=await h.getDirectoryHandle(part,{create:!!create});
  return h;
}
async function ensureNestedDir(base,relativeDir){
  let h=base;
  for(const part of norm(relativeDir).split("/").filter(Boolean))h=await h.getDirectoryHandle(part,{create:true});
  return h;
}
async function copyFileObjectToDir(fileObj,destDir,name){
  const fh=await destDir.getFileHandle(name,{create:true}),w=await fh.createWritable();await w.write(fileObj);await w.close();return fh;
}
async function verifyFileObjects(a,b){
  if(a.size!==b.size)return false;
  if(a.size>512*1024*1024)return null;
  const ah=await crypto.subtle.digest("SHA-256",await a.arrayBuffer()),bh=await crypto.subtle.digest("SHA-256",await b.arrayBuffer());
  const A=new Uint8Array(ah),B=new Uint8Array(bh);if(A.length!==B.length)return false;for(let i=0;i<A.length;i++)if(A[i]!==B[i])return false;return true;
}
window.consolidateFolder=async(id,dir)=>{
  const g=state.folderGroups.find(x=>x.id===id);if(!g)return;
  if(!state.rootHandle){alert("Per consolidare realmente devi prima effettuare una scansione autorizzata, non la demo.");return}
  const sourceFolder=dir==="AtoB"?g.a:g.b,destFolder=dir==="AtoB"?g.b:g.a,missing=dir==="AtoB"?g.onlyA:g.onlyB;
  if(g.changed.length){alert("Sono presenti "+g.changed.length+" conflitti: DiskCare non sovrascriverà automaticamente i file diversi.");}
  try{
    const destBase=await getDirHandleForFolder(destFolder,true);
    for(const f of missing){
      const rel=relativeTo(f,sourceFolder),parts=norm(rel).split("/"),name=parts.pop(),sub=parts.join("/");
      const dd=await ensureNestedDir(destBase,sub),srcFile=f.fileObj||await f.handle.getFile(),dh=await copyFileObjectToDir(srcFile,dd,name),dstFile=await dh.getFile();
      const ok=await verifyFileObjects(srcFile,dstFile);if(ok===false)throw new Error("Verifica fallita per "+name);if(ok===null)throw new Error("File >512 MB copiato ma non verificabile integralmente nella PWA: origine mantenuta.");
    }
    g.consolidated=true;alert("Consolidamento completato. I file mancanti sono stati copiati e verificati quando possibile. Nessuna origine è stata eliminata.");
  }catch(e){alert("Consolidamento interrotto: "+e.message)}
};

function sendToQuarantine(id){
  const f=state.files.find(x=>x.id===id);if(!f||state.quarantine.some(q=>q.sourceId===id))return;
  state.quarantine.push({id:crypto.randomUUID(),sourceId:id,name:f.name,size:f.size,originalPath:f.path,when:new Date().toLocaleString("it-IT")});updateQ();
}
window.sendToQuarantine=sendToQuarantine;
function updateQ(){
  const bytes=state.quarantine.reduce((s,q)=>s+q.size,0);$("qBadge").textContent=state.quarantine.length;$("qCount").textContent=state.quarantine.length;$("qSpace").textContent=fmt(bytes);$("qOps").textContent=state.quarantine.length;$("qCompactText").textContent=state.quarantine.length+" file • "+fmt(bytes)+" • tutto ripristinabile";renderQ();
}
function renderQ(){const q=($("qSearch")?.value||"").toLowerCase(),items=state.quarantine.filter(x=>(x.name+" "+x.originalPath).toLowerCase().includes(q));$("qTableWrap").innerHTML=items.length?"<table><thead><tr><th>File</th><th>Spazio</th><th>Origine</th><th>Azione</th></tr></thead><tbody>"+items.map(x=>"<tr><td>"+esc(x.name)+"</td><td>"+fmt(x.size)+"</td><td class=\"path\">"+esc(x.originalPath)+"</td><td><button class=\"mini-btn\" onclick=\"restoreItem('"+x.id+"')\">Ripristina</button></td></tr>").join("")+"</tbody></table>":"<div class=\"empty-state\"><strong>Quarantena vuota</strong></div>"}
window.restoreItem=id=>{state.quarantine=state.quarantine.filter(x=>x.id!==id);updateQ()};

function updateHomeAfterScan(elapsedSeconds=0){
  const root=state.rootName||"Percorso autorizzato";
  const folders=new Set();
  state.files.forEach(f=>{const d=dirname(f.path);if(d)folders.add(d.toLowerCase())});
  const totalBytes=state.files.reduce((s,f)=>s+f.size,0);
  const ot=opportunityTotals();
  const byType=t=>state.opportunities.filter(o=>o.type===t);
  const bytesOf=arr=>arr.reduce((s,o)=>s+o.bytes,0);
  const dupOps=byType("duplicate"),folderOps=byType("folder"),cacheOps=byType("cache");
  const reviewItems=state.files.map(f=>advice(f)).filter(a=>a.type==="check").length;
  const keepItems=state.files.map(f=>advice(f)).filter(a=>a.type==="keep").length;
  const protectedItems=state.files.filter(f=>isProtectedPath(f.path)).length;

  $("overview").classList.add("has-results");
  $("homeTitle").textContent="Analisi completata";
  $("homeSubtitle").textContent="DiskCare ha organizzato i risultati per mostrarti subito cosa occupa spazio e cosa puoi controllare.";
  $("scanScopeText").textContent="Percorso autorizzato: "+root;
  $("homeScanRoot").textContent=root;
  $("homeFileCount").textContent=state.files.length.toLocaleString("it-IT");
  $("homeFolderCount").textContent=folders.size.toLocaleString("it-IT");
  $("spaceTotal").textContent=fmt(totalBytes);
  $("potentialRecover").textContent=fmt(ot.verified+ot.potential);
  $("homeDupGroups").textContent=state.duplicateGroups.length.toLocaleString("it-IT")+" gruppi";
  $("homeDupBytes").textContent=fmt(bytesOf(dupOps))+" recuperabili";
  $("homeFolderGroups").textContent=state.folderGroups.length.toLocaleString("it-IT")+" gruppi";
  $("homeFolderBytes").textContent=fmt(bytesOf(folderOps))+" recuperabili";
  $("homeCacheCount").textContent=cacheOps.length.toLocaleString("it-IT")+" elementi";
  $("homeCacheBytes").textContent=fmt(bytesOf(cacheOps))+" recuperabili";
  $("homeReviewCount").textContent=reviewItems.toLocaleString("it-IT")+" elementi";
  $("homeKeepText").textContent=keepItems.toLocaleString("it-IT")+" file non richiedono interventi";
  $("homeProtectedText").textContent=protectedItems.toLocaleString("it-IT")+" file protetti";
  const sec=Math.max(0,Math.round(elapsedSeconds));
  const elapsed=String(Math.floor(sec/60)).padStart(2,"0")+":"+String(sec%60).padStart(2,"0");
  $("statusText").textContent="Analisi completata: "+state.files.length.toLocaleString("it-IT")+" file e "+folders.size.toLocaleString("it-IT")+" cartelle.";
  $("metricElapsed").textContent=elapsed;
}
function setProgress(p,phase,no,status,speed=0,elapsed="00:00",eta="—"){$("progressBar").style.width=p+"%";$("progressBar").parentElement.dataset.progress=Math.round(p)+"%";$("phaseName").textContent=phase;$("metricPhase").textContent=no;$("statusText").textContent=status;$("metricSpeed").textContent=speed;$("metricElapsed").textContent=elapsed;$("metricEta").textContent=eta}
function showSection(sec){document.querySelectorAll(".view").forEach(v=>v.classList.remove("active-view"));(document.getElementById(sec)||$("overview")).classList.add("active-view");window.scrollTo({top:0,left:0,behavior:"instant"})}
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));b.classList.add("active");showSection(b.dataset.section)});
$("openQuarantine").onclick=()=>document.querySelector('[data-section="quarantine"]').click();

async function walk(handle,path,tracker){
  const out=[];
  for await(const [name,entry] of handle.entries()){
    const p=path+"/"+name;
    if(entry.kind==="file"){
      try{
        const file=await entry.getFile(),yrs=(Date.now()-file.lastModified)/(365.25*86400000);
        out.push({id:crypto.randomUUID(),name:file.name,size:file.size,modified:new Date(file.lastModified).toLocaleDateString("it-IT"),path:p,old:yrs>2,fileObj:file,handle:entry});
        tracker.count++;
        if(tracker.count%200===0){const sec=Math.max(1,(Date.now()-tracker.start)/1000),spd=Math.round(tracker.count/sec);setProgress(25,"Indicizzazione","2 / 7",tracker.count.toLocaleString("it-IT")+" file indicizzati",spd,String(Math.floor(sec/60)).padStart(2,"0")+":"+String(Math.floor(sec%60)).padStart(2,"0"),"calcolo…");await sleep(0)}
      }catch(e){}
    }else out.push(...await walk(entry,p,tracker));
  }
  return out;
}
$("scanBtn").onclick=async()=>{
  if(!window.showDirectoryPicker){alert("Usa Chrome o Edge aggiornato.");return}
  try{
    setProgress(5,"Preparazione","1 / 7","Scegli una cartella da analizzare…");
    const dir=await showDirectoryPicker({mode:"readwrite"});state.rootName=dir.name;state.rootHandle=dir;
    const tr={count:0,start:Date.now()};state.files=await walk(dir,dir.name,tr);
    setProgress(50,"Classificazione","3 / 7","Classificazione prudente…");await sleep(30);
    setProgress(63,"Duplicati","4 / 7","Raggruppamento duplicati…");buildDuplicateGroups();await sleep(30);
    setProgress(78,"Cartelle","5 / 7","Aggregazione alberi…");buildFolderGroups();await sleep(30);
    setProgress(90,"Spazio recuperabile","6 / 7","Calcolo opportunità senza doppi conteggi…");buildOpportunities();recalc();
    const elapsedTotal=(Date.now()-tr.start)/1000;setProgress(100,"Completata","7 / 7","Scansione completata.");updateHomeAfterScan(elapsedTotal);
  }catch(e){if(e.name!=="AbortError")setProgress(0,"Interrotta","0 / 7","Scansione interrotta: "+e.message)}
};

$("demoBtn").onclick=()=>{
  const GB=1024**3,MB=1024**2;
  state.rootName="E:";state.rootHandle=null;
  state.files=[
    {id:"p1",name:"Rendered-preview.mov",size:30.34*GB,path:"E:/Progetto/Adobe Premiere Pro Video Previews/Rendered-preview.mov",old:true,demoHash:"PREVIEW"},
    {id:"f1",name:"juggernautXL_v8Rundiffusion.safetensors",size:6.776*GB,path:"E:/Fooocus_win64_2-5-0/Fooocus/models/checkpoints/juggernautXL_v8Rundiffusion.safetensors",old:true,demoHash:"MODEL"},
    {id:"f2",name:"config.json",size:220*1024,path:"E:/Fooocus_win64_2-5-0/Fooocus/models/checkpoints/config.json",old:true,demoHash:"CFG"},
    {id:"f3",name:"notes.txt",size:12000,path:"E:/Fooocus_win64_2-5-0/Fooocus/models/checkpoints/notes.txt",old:true,demoHash:"NOTE"},
    {id:"g1",name:"juggernautXL_v8Rundiffusion.safetensors",size:6.776*GB,path:"E:/Fooocus_win64_2-5-0 (copy)/Fooocus/models/checkpoints/juggernautXL_v8Rundiffusion.safetensors",old:true,demoHash:"MODEL"},
    {id:"g2",name:"config.json",size:220*1024,path:"E:/Fooocus_win64_2-5-0 (copy)/Fooocus/models/checkpoints/config.json",old:true,demoHash:"CFG"},
    {id:"g3",name:"notes.txt",size:12000,path:"E:/Fooocus_win64_2-5-0 (copy)/Fooocus/models/checkpoints/notes.txt",old:true,demoHash:"NOTE"},
    {id:"v1",name:"2026-06-18 18-37-50.mp4",size:14.025*GB,path:"E:/Videos/2026-06-18 18-37-50.mp4",old:false},
    {id:"sys1",name:"hiberfil.sys",size:13.876*GB,path:"C:/hiberfil.sys",old:false},
    {id:"sys2",name:"pagefile.sys",size:7.662*GB,path:"C:/pagefile.sys",old:false},
    {id:"i1",name:"installer.exe",size:707.24*MB,path:"E:/Downloads/installer.exe",old:true},
    {id:"r1",name:".DS_Store",size:6144,path:"E:/Foto/.DS_Store",old:true},
    {id:"b1",name:"old_backup.zip",size:1.2*GB,path:"E:/$Recycle.Bin/old_backup.zip",old:true}
  ];
  recalc();setProgress(100,"Completata","7 / 7","Demo completata.");updateHomeAfterScan(1);
};

function profileLabel(p){return p==="light"?"Minimo":p==="fast"?"Massimo":"Medio"}
function profilePillLabel(p){return p==="light"?"minimo":p==="fast"?"massimo":"medio"}
function markPerformanceDirty(){const dirty=state.pendingProfile!==state.profile;$("performanceSavedState").textContent=dirty?"Da salvare":"Salvato";$("performanceSavedLabel").textContent=profileLabel(state.pendingProfile);$("performanceSavedText").textContent=dirty?"Hai cambiato profilo. Premi Salva impostazione.":"La scelta salvata verrà riutilizzata alla prossima apertura."}
function applyProfileUI(p){document.querySelectorAll("[data-profile]").forEach(x=>x.classList.toggle("selected",x.dataset.profile===p));$("profilePill").textContent="Profilo "+profilePillLabel(p)}
function loadSavedPerformance(){const saved=localStorage.getItem("diskcare.performanceProfile"),valid=["light","normal","fast"].includes(saved)?saved:"normal";state.profile=valid;state.pendingProfile=valid;applyProfileUI(valid);markPerformanceDirty()}
document.querySelectorAll("[data-profile]").forEach(b=>b.onclick=()=>{state.pendingProfile=b.dataset.profile;applyProfileUI(state.pendingProfile);markPerformanceDirty()});
$("savePerformanceBtn").onclick=()=>{state.profile=state.pendingProfile;localStorage.setItem("diskcare.performanceProfile",state.profile);markPerformanceDirty();$("performanceSavedText").textContent="Profilo "+profileLabel(state.profile)+" salvato."};
$("resetPerformanceBtn").onclick=()=>{state.pendingProfile="normal";applyProfileUI("normal");markPerformanceDirty()};

function applyTheme(theme){const valid=["payblue","dark","soft","graphite","ocean","warm"],t=valid.includes(theme)?theme:"payblue";document.body.dataset.theme=t;document.querySelectorAll("[data-theme-choice]").forEach(b=>b.classList.toggle("selected",b.dataset.themeChoice===t));const st=$("themeSavedState");if(st)st.textContent="Salvato";return t}
function loadSavedTheme(){const saved=localStorage.getItem("diskcare.theme")||"payblue";applyTheme(saved)}
document.querySelectorAll("[data-theme-choice]").forEach(b=>b.onclick=()=>{const t=applyTheme(b.dataset.themeChoice);localStorage.setItem("diskcare.theme",t)});

function setTransferMode(mode){
  $("transferStart").style.display=mode?"none":"grid";
  $("compareWorkspace").classList.toggle("active-transfer-panel",mode==="compare");
  $("transferWorkspace").classList.toggle("active-transfer-panel",mode==="copy");
}
function resetTransferMode(){
  setTransferMode(null);
  $("compareResults").hidden=true;$("compareSummary").hidden=true;$("compareMergeActions").hidden=true;
}
$("changeTransferMode").onclick=resetTransferMode;
$("changeTransferMode2").onclick=resetTransferMode;

async function chooseCompareFolder(which){
  if(!window.showDirectoryPicker){alert("Per confrontare cartelle usa Chrome o Edge aggiornato.");return}
  try{
    const h=await showDirectoryPicker({mode:"readwrite"});
    state.compare[which]=h;
    $(which==="a"?"compareALabel":"compareBLabel").textContent=h.name;
    $("runFolderCompare").disabled=!(state.compare.a&&state.compare.b);
    $("compareStatus").textContent=state.compare.a&&state.compare.b?"Le due cartelle sono pronte per il confronto.":"Seleziona anche l'altra cartella.";
  }catch(e){}
}
$("pickCompareA").onclick=()=>chooseCompareFolder("a");
$("pickCompareB").onclick=()=>chooseCompareFolder("b");

async function inventoryDir(handle,prefix="",map=new Map()){
  for await(const [name,entry] of handle.entries()){
    const rel=prefix?prefix+"/"+name:name;
    if(entry.kind==="directory")await inventoryDir(entry,rel,map);
    else{
      try{const file=await entry.getFile();map.set(norm(rel).toLowerCase(),{rel,handle:entry,file,size:file.size,name:file.name})}catch(e){}
    }
  }
  return map;
}
async function compareTwoFolders(){
  if(!state.compare.a||!state.compare.b)return;
  $("runFolderCompare").disabled=true;$("compareTitle").textContent="Confronto in corso…";$("compareStatus").textContent="DiskCare sta leggendo le due cartelle.";
  const [A,B]=await Promise.all([inventoryDir(state.compare.a),inventoryDir(state.compare.b)]);
  state.compare.mapA=A;state.compare.mapB=B;state.compare.onlyA=[];state.compare.onlyB=[];state.compare.same=[];state.compare.conflicts=[];
  const keys=new Set([...A.keys(),...B.keys()]);
  for(const key of keys){
    const a=A.get(key),b=B.get(key);
    if(a&&!b){state.compare.onlyA.push(a);continue}
    if(b&&!a){state.compare.onlyB.push(b);continue}
    if(a&&b){
      if(a.size!==b.size){state.compare.conflicts.push({a,b,reason:"dimensione diversa"});continue}
      const same=await verifyFileObjects(a.file,b.file);
      if(same===true)state.compare.same.push({a,b});
      else if(same===false)state.compare.conflicts.push({a,b,reason:"contenuto diverso"});
      else state.compare.conflicts.push({a,b,reason:"file grande: verifica completa non disponibile nella PWA"});
    }
  }
  $("compareSame").textContent=state.compare.same.length.toLocaleString("it-IT");
  $("compareOnlyA").textContent=state.compare.onlyA.length.toLocaleString("it-IT");
  $("compareOnlyB").textContent=state.compare.onlyB.length.toLocaleString("it-IT");
  $("compareConflicts").textContent=state.compare.conflicts.length.toLocaleString("it-IT");
  $("compareResults").hidden=false;$("compareSummary").hidden=false;$("compareMergeActions").hidden=false;
  $("compareTitle").textContent="Confronto completato";
  $("compareStatus").textContent="Ora puoi copiare solo ciò che manca. I file diversi non verranno sovrascritti.";
  const recoverA=state.compare.onlyB.reduce((s,x)=>s+x.size,0),recoverB=state.compare.onlyA.reduce((s,x)=>s+x.size,0);
  $("compareSummary").innerHTML="<strong>"+esc(state.compare.a.name)+" ↔ "+esc(state.compare.b.name)+"</strong><br>"+
    state.compare.same.length+" file identici • "+state.compare.conflicts.length+" conflitti da controllare.<br>"+
    "Da A verso B mancano "+state.compare.onlyA.length+" file ("+fmt(recoverB)+"). Da B verso A mancano "+state.compare.onlyB.length+" file ("+fmt(recoverA)+").";
  $("runFolderCompare").disabled=false;
}
$("runFolderCompare").onclick=compareTwoFolders;

async function destinationForRelative(root,rel){
  const parts=norm(rel).split("/"),name=parts.pop();let dir=root;
  for(const p of parts)dir=await dir.getDirectoryHandle(p,{create:true});
  return{dir,name};
}
async function copyMissingList(list,destRoot,label){
  if(!list.length){alert("Non ci sono file mancanti da copiare "+label+".");return}
  let done=0;
  for(const item of list){
    const target=await destinationForRelative(destRoot,item.rel);
    let existing=false;try{await target.dir.getFileHandle(target.name);existing=true}catch(e){}
    if(existing)continue;
    const dh=await copyFileObjectToDir(item.file,target.dir,target.name),dst=await dh.getFile();
    const ok=await verifyFileObjects(item.file,dst);
    if(ok!==true)throw new Error("Copia eseguita ma verifica non completa per "+item.rel+". L'origine è stata mantenuta.");
    done++;
  }
  alert(done+" file copiati e verificati. Nessun file esistente è stato sovrascritto.");
  await compareTwoFolders();
}
$("mergeAtoB").onclick=async()=>{try{await copyMissingList(state.compare.onlyA,state.compare.b,"da A a B")}catch(e){alert(e.message)}};
$("mergeBtoA").onclick=async()=>{try{await copyMissingList(state.compare.onlyB,state.compare.a,"da B a A")}catch(e){alert(e.message)}};
$("resetCompare").onclick=()=>{state.compare={a:null,b:null,mapA:null,mapB:null,onlyA:[],onlyB:[],same:[],conflicts:[]};$("compareALabel").textContent="Non selezionata";$("compareBLabel").textContent="Non selezionata";$("runFolderCompare").disabled=true;$("compareResults").hidden=true;$("compareSummary").hidden=true;$("compareMergeActions").hidden=true;$("compareTitle").textContent="Scegli le due cartelle";$("compareStatus").textContent="DiskCare confronterà la struttura prima di proporti qualsiasi operazione."};

$("startCompareFolders").onclick=()=>{setTransferMode("compare");chooseCompareFolder("a")};
$("startCopyFolder").onclick=()=>{setTransferMode("copy");$("transferModeTitle").textContent="Copia una cartella completa";$("pickFolderBtn").click()};
$("startCopyFiles").onclick=()=>{setTransferMode("copy");$("transferModeTitle").textContent="Copia file selezionati";$("pickFilesBtn").click()};

function transferLog(msg){const box=$("transferLog");box.textContent+=(box.textContent?"\n":"")+msg;box.scrollTop=box.scrollHeight}
function setTransferProgress(p,msg){$("transferProgress").style.width=p+"%";$("transferProgress").parentElement.dataset.progress=Math.round(p)+"%";$("transferStatus").textContent=msg}
$("pickFilesBtn").onclick=async()=>{if(!window.showOpenFilePicker){alert("Browser non compatibile.");return}try{const hs=await showOpenFilePicker({multiple:true});state.transfer.sourceType="files";state.transfer.fileHandles=hs;state.transfer.folderHandle=null;let bytes=0;for(const h of hs)bytes+=(await h.getFile()).size;$("transferSourceLabel").textContent=hs.length+" file selezionati";$("transferSourceMeta").textContent=fmt(bytes)+" totali"}catch(e){}};
$("pickFolderBtn").onclick=async()=>{if(!window.showDirectoryPicker){alert("Browser non compatibile.");return}try{const h=await showDirectoryPicker({mode:"readwrite"});state.transfer.sourceType="folder";state.transfer.folderHandle=h;state.transfer.fileHandles=[];$("transferSourceLabel").textContent=h.name;$("transferSourceMeta").textContent="Cartella autorizzata in lettura/scrittura"}catch(e){}};
$("pickDestBtn").onclick=async()=>{if(!window.showDirectoryPicker){alert("Browser non compatibile.");return}try{const h=await showDirectoryPicker({mode:"readwrite"});state.transfer.destHandle=h;$("transferDestLabel").textContent=h.name;$("transferDestMeta").textContent="Destinazione autorizzata in scrittura"}catch(e){}};
$("clearTransferBtn").onclick=()=>{state.transfer={sourceType:null,fileHandles:[],folderHandle:null,destHandle:null};$("transferSourceLabel").textContent="Nessuna origine";$("transferSourceMeta").textContent="Scegli uno o più file oppure una cartella.";$("transferDestLabel").textContent="Nessuna destinazione";$("transferDestMeta").textContent="La destinazione deve essere autorizzata in scrittura.";$("transferLog").textContent="";setTransferProgress(0,"Pronto.")};

async function copyOneHandle(srcHandle,destDir){
  const src=await srcHandle.getFile();
  let existing=null;try{existing=await destDir.getFileHandle(src.name);const ef=await existing.getFile();if(ef.size===src.size){const same=await verifyFileObjects(src,ef);if(same===true){transferLog("Già presente e identico: "+src.name);return{copied:false,verified:true,existing:true}}throw new Error("Conflitto: "+src.name+" esiste già con contenuto diverso.")}}catch(e){if(e.name!=="NotFoundError"&&String(e.message||"").startsWith("Conflitto"))throw e}
  const dh=await copyFileObjectToDir(src,destDir,src.name),dst=await dh.getFile();
  const doVerify=$("verifyAfterCopy").checked,verified=doVerify?await verifyFileObjects(src,dst):true;
  if(verified===false)throw new Error("Verifica fallita: "+src.name);
  if(verified===null)transferLog("Copiato ma hash completo non eseguito (>512 MB): "+src.name);else transferLog("Copiato"+(doVerify?" e verificato":"")+": "+src.name);
  return{copied:true,verified};
}
async function copyFolderRecursive(srcDir,dstDir,counter){
  for await(const [name,entry] of srcDir.entries()){
    if(entry.kind==="directory"){const nd=await dstDir.getDirectoryHandle(name,{create:true});await copyFolderRecursive(entry,nd,counter)}
    else{const r=await copyOneHandle(entry,dstDir);counter.done++;setTransferProgress(Math.min(95,counter.done),"Trasferiti "+counter.done+" file…");if(r.verified===null)counter.unverified++}
  }
}
async function clearFolderContents(dir){
  const names=[];for await(const [name] of dir.entries())names.push(name);
  for(const name of names)await dir.removeEntry(name,{recursive:true});
}
async function runTransfer(move){
  const t=state.transfer;if(!t.sourceType||!t.destHandle){alert("Seleziona origine e destinazione.");return}
  $("transferLog").textContent="";setTransferProgress(2,move?"Spostamento sicuro in preparazione…":"Copia in preparazione…");
  try{
    if(t.sourceType==="files"){
      let allVerified=true;
      for(let i=0;i<t.fileHandles.length;i++){const h=t.fileHandles[i],r=await copyOneHandle(h,t.destHandle);if(r.verified!==true)allVerified=false;setTransferProgress(Math.round((i+1)/t.fileHandles.length*90),"File "+(i+1)+" / "+t.fileHandles.length)}
      if(move){
        let moved=0;
        if(allVerified){for(const h of t.fileHandles){if(typeof h.move==="function"){await h.move(t.destHandle);moved++}}}
        if(moved===t.fileHandles.length)transferLog("Origini rimosse dopo verifica.");else transferLog("La PWA non può rimuovere in modo affidabile tutti i file scelti singolarmente: copie verificate mantenendo le origini.");
      }
    }else{
      const target=$("preserveFolderName").checked?await t.destHandle.getDirectoryHandle(t.folderHandle.name,{create:true}):t.destHandle,counter={done:0,unverified:0};
      await copyFolderRecursive(t.folderHandle,target,counter);
      if(move&&counter.unverified===0){await clearFolderContents(t.folderHandle);transferLog("Contenuto origine rimosso dopo copia/verifica. La cartella origine vuota può restare visibile.");}
      else if(move&&counter.unverified>0)transferLog("Origine mantenuta: almeno un file grande non ha ricevuto verifica SHA-256 completa nella PWA.");
    }
    setTransferProgress(100,move?"Operazione di spostamento completata in sicurezza.":"Copia completata.");
  }catch(e){setTransferProgress(0,"Operazione interrotta.");transferLog("ERRORE: "+e.message);alert(e.message)}
}
$("copyBtn").onclick=()=>runTransfer(false);$("moveBtn").onclick=()=>runTransfer(true);

$("quarantineResidualsBtn").onclick=()=>{state.files.filter(isResidualFile).forEach(f=>sendToQuarantine(f.id))};
$("qSearch").oninput=renderQ;$("restoreAllBtn").onclick=()=>{state.quarantine=[];updateQ()};$("purgeAllBtn").onclick=()=>{if(state.quarantine.length&&confirm("Eliminare definitivamente la quarantena simulata?")){state.quarantine=[];updateQ()}};
loadSavedTheme();loadSavedPerformance();updateQ();