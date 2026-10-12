const state={
  files:[],duplicateGroups:[],folderGroups:[],opportunities:[],selectedOps:new Set(),
  profile:"normal",pendingProfile:"normal",quarantine:[],quarantineDestination:{handle:null,name:"",mode:"unknown"},quarantineExcludedPaths:new Set(),rootName:"",rootHandle:null,verifyRunning:false,
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
  if(isProtectedPath(f.path))return{type:"protect",label:"Area di sistema",reason:"Percorso delicato: DiskCare lo analizza ma non lo considera automaticamente eliminabile."};
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
    if(!f.size||isRecyclePath(f.path)||state.quarantineExcludedPaths.has(norm(f.path).toLowerCase()))continue;
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
  const previous=new Map((state.folderGroups||[]).map(g=>[g.a+"|||"+g.b,g]));
  state.folderGroups=kept.map((x,i)=>{
    const old=previous.get(x.a+"|||"+x.b);
    return {...x,id:"f"+i,primarySide:old?.primarySide||null,conflictChoices:old?.conflictChoices||{},copyOnlyA:old?.copyOnlyA||new Set(),copyOnlyB:old?.copyOnlyB||new Set()};
  });
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
  renderOpportunities();renderDuplicateGroups();renderFolderGroups();renderResiduals();renderReview();renderProtected();updateQ();updateGuidedExperience();
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
  updateGuidedExperience();
}
window.toggleOpportunity=id=>{state.selectedOps.has(id)?state.selectedOps.delete(id):state.selectedOps.add(id);renderOpportunities()};
window.openOpportunity=id=>{const o=state.opportunities.find(x=>x.id===id);if(!o)return;if(o.type==="folder")document.querySelector('[data-section="folders"]').click();else if(o.type==="duplicate")document.querySelector('[data-section="duplicates"]').click();else if(o.type==="residual")document.querySelector('[data-section="residuals"]').click();else document.querySelector('[data-section="review"]').click()};
$("selectSafeBtn").onclick=()=>{state.opportunities.filter(o=>o.status==="verified"&&o.risk==="low").forEach(o=>state.selectedOps.add(o.id));renderOpportunities()};
$("clearSelectionBtn").onclick=()=>{state.selectedOps.clear();renderOpportunities()};
$("openOppBtn").onclick=()=>document.querySelector('[data-section="opportunities"]').click();

function tableBadge(a){const cls=a.type==="quarantine"?"good":a.type;return "<span class=\"badge "+cls+"\">"+esc(a.label)+"</span>"}
function renderResiduals(){const items=state.files.filter(isResidualFile).sort((a,b)=>b.size-a.size);$("residualWrap").innerHTML=items.length?"<table><thead><tr><th>Tipo</th><th>File</th><th>Dimensione</th><th>Percorso</th><th>Azione</th></tr></thead><tbody>"+items.map(f=>"<tr><td><span class=\"badge residual\">Residuo sicuro</span></td><td>"+esc(f.name)+"</td><td>"+fmt(f.size)+"</td><td class=\"path\">"+esc(f.path)+"</td><td><button class=\"mini-btn good\" onclick=\"sendToQuarantine('"+f.id+"')\">Quarantena</button></td></tr>").join("")+"</tbody></table>":"<div class=\"empty-state\"><strong>Nessun residuo rilevato</strong></div>"}
function renderReview(){
  const items=diskcareReviewItems().sort((x,y)=>y.f.size-x.f.size);
  $("reviewWrap").innerHTML=items.length?"<div class=\"dc-review-list\">"+items.map(x=>"<article class=\"dc-review-item\"><div><strong>"+esc(x.f.name)+"</strong><small>"+fmt(x.f.size)+" • "+esc(x.f.path)+"</small><p>"+esc(x.a.reason)+"</p></div><div class=\"dc-review-actions\"><button class=\"mini-btn\">Tieni</button><button class=\"mini-btn\" onclick=\"prepareSingleMove('"+x.f.id+"')\">Sposta</button>"+(x.a.type==="quarantine"?"<button class=\"mini-btn danger\" onclick=\"sendToQuarantine('"+x.f.id+"')\">Metti in quarantena</button>":"<button class=\"mini-btn\" disabled>Controlla prima</button>")+"</div></article>").join("")+"</div>":"<div class=\"empty-state\"><strong>Nessun elemento da valutare</strong></div>";
}
window.prepareSingleMove=id=>{const f=state.files.find(x=>x.id===id);if(!f)return;alert("Anteprima guidata: per spostare questo elemento apri Copia e unisci e scegli la destinazione.")};
function renderProtected(){const items=state.files.filter(f=>isProtectedPath(f.path)).sort((a,b)=>b.size-a.size);$("protectedWrap").innerHTML=items.length?"<table><thead><tr><th>Stato</th><th>Nome</th><th>Dimensione</th><th>Percorso</th></tr></thead><tbody>"+items.map(f=>"<tr><td><span class=\"badge protect\">Area di sistema</span></td><td>"+esc(f.name)+"</td><td>"+fmt(f.size)+"</td><td class=\"path\">"+esc(f.path)+"</td></tr>").join("")+"</tbody></table>":"<div class=\"empty-state\"><strong>Nessuna area di sistema rilevata</strong></div>"}

let previewObjectUrl=null;
function closePreview(){
  const modal=$("previewModal"),body=$("previewBody"),media=$("previewMediaControls");
  const player=body?.querySelector("video,audio");
  if(player){try{player.pause();player.currentTime=0}catch(e){}}
  if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=null}
  if(body)body.innerHTML='<div class="preview-empty">Nessun file aperto.</div>';
  if(media)media.hidden=true;
  if(modal)modal.hidden=true;
}
function activePreviewMedia(){return $("previewBody")?.querySelector("video,audio")||null}
function previewKind(file,name){
  const e=ext(name),t=(file.type||"").toLowerCase();
  if(t.startsWith("video/")||[".mp4",".webm",".ogg",".mov",".m4v"].includes(e))return"video";
  if(t.startsWith("audio/")||[".mp3",".wav",".ogg",".m4a",".aac",".flac"].includes(e))return"audio";
  if(t.startsWith("image/")||[".jpg",".jpeg",".png",".gif",".webp",".bmp",".svg"].includes(e))return"image";
  if(t==="application/pdf"||e===".pdf")return"pdf";
  if(t.startsWith("text/")||[".txt",".csv",".json",".xml",".log",".md"].includes(e))return"text";
  return"unsupported";
}
window.previewFile=async id=>{
  const f=state.files.find(x=>x.id===id);if(!f)return;
  const modal=$("previewModal"),body=$("previewBody"),controls=$("previewMediaControls");
  $("previewTitle").textContent=f.name;
  $("previewMeta").textContent=fmt(f.size)+" • "+f.path;
  body.innerHTML='<div class="preview-loading">Apertura anteprima…</div>';
  controls.hidden=true;modal.hidden=false;
  try{
    const file=f.fileObj||(f.handle?await f.handle.getFile():null);
    if(!file){body.innerHTML='<div class="preview-empty"><strong>Anteprima non disponibile.</strong><span>Questo elemento non dispone di un file leggibile nella sessione corrente.</span></div>';return}
    if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
    const kind=previewKind(file,f.name);
    if(kind==="text"){
      const txt=await file.text();
      body.innerHTML="<pre class=\"preview-text\">"+esc(txt.slice(0,500000))+(txt.length>500000?"\n\n[Anteprima limitata ai primi 500.000 caratteri]":"")+"</pre>";
      return;
    }
    previewObjectUrl=URL.createObjectURL(file);
    if(kind==="image"){
      body.innerHTML="<div class=\"preview-image-wrap\"><img src=\""+previewObjectUrl+"\" alt=\"Anteprima "+esc(f.name)+"\"></div>";return;
    }
    if(kind==="pdf"){
      body.innerHTML="<iframe class=\"preview-pdf\" src=\""+previewObjectUrl+"#toolbar=0&navpanes=0\" title=\"Anteprima PDF\"></iframe>";return;
    }
    if(kind==="video"){
      body.innerHTML="<video class=\"preview-player\" src=\""+previewObjectUrl+"\" controls preload=\"metadata\"></video>";controls.hidden=false;return;
    }
    if(kind==="audio"){
      body.innerHTML="<div class=\"preview-audio-wrap\"><div class=\"preview-audio-icon\">♪</div><audio class=\"preview-player audio\" src=\""+previewObjectUrl+"\" controls preload=\"metadata\"></audio></div>";controls.hidden=false;return;
    }
    body.innerHTML='<div class="preview-empty"><strong>Anteprima non disponibile per questo formato.</strong><span>Puoi comunque confrontare nome, percorso, dimensione e stato di verifica senza modificare il file.</span></div>';
  }catch(e){
    body.innerHTML='<div class="preview-empty"><strong>Impossibile aprire l\'anteprima.</strong><span>'+esc(e.message||"Errore di lettura")+'</span></div>';
  }
};
$("previewCloseBtn").onclick=closePreview;$("previewCloseFooter").onclick=closePreview;$("previewBackdrop").onclick=closePreview;
$("previewPlayBtn").onclick=()=>{const p=activePreviewMedia();if(!p)return;if(p.paused){p.play();$("previewPlayBtn").textContent="❚❚ Pausa"}else{p.pause();$("previewPlayBtn").textContent="▶ Play"}};
$("previewStopBtn").onclick=()=>{const p=activePreviewMedia();if(!p)return;p.pause();p.currentTime=0;$("previewPlayBtn").textContent="▶ Play"};
$("previewRewindBtn").onclick=()=>{const p=activePreviewMedia();if(p)p.currentTime=Math.max(0,(p.currentTime||0)-10)};
$("previewForwardBtn").onclick=()=>{const p=activePreviewMedia();if(p)p.currentTime=Math.min(Number.isFinite(p.duration)?p.duration:(p.currentTime||0)+10,(p.currentTime||0)+10)};
$("previewRate").onchange=()=>{const p=activePreviewMedia();if(p)p.playbackRate=Number($("previewRate").value)||1};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("previewModal").hidden)closePreview()});

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
    const verifyAction=!g.verified&&g.verification!=="size-only"?"<button class=\"mini-btn\" onclick=\"verifyGroup('"+g.id+"')\">Verifica contenuto</button>":"";
    const verifiedMark=g.verified&&g.identical?"<span class=\"dup-verified-mark\">✓ Identici verificati</span>":g.verified&&!g.identical?"<span class=\"dup-warning-mark\">⚠ Contenuti diversi</span>":"<span class=\"dup-status-text\">"+esc(status)+"</span>";
    const fileRows=g.files.map((f,i)=>{
      const chosen=g.keepId===f.id,label=String.fromCharCode(65+i);
      const quarantineAction=g.verified&&g.identical&&!chosen?"<button class=\"mini-btn danger-soft\" onclick=\"quarantineDuplicateFile('"+g.id+"','"+f.id+"')\">Quarantena</button>":"";
      return "<div class=\"dup-file actionable "+(chosen?"dup-file-kept":"")+"\">"+
        "<span class=\"dup-copy-label\">"+label+"</span>"+
        "<div><div class=\"dup-name\">"+esc(f.name)+(chosen?" <span class=\"keep-mark\">• da conservare</span>":"")+"</div><div class=\"dup-path\">"+esc(f.path)+"</div></div>"+
        "<div class=\"dup-size\">"+fmt(f.size)+"</div>"+
        "<div class=\"dup-actions\">"+
          "<button class=\"mini-btn\" onclick=\"previewFile('"+f.id+"')\">Preview</button>"+
          "<button class=\"mini-btn "+(chosen?"good":"")+"\" onclick=\"chooseDuplicateKeep('"+g.id+"','"+f.id+"')\">"+(chosen?"Mantieni questa ✓":"Mantieni questa")+"</button>"+
          "<button class=\"mini-btn\" onclick=\"moveDuplicateFile('"+g.id+"','"+f.id+"')\">Sposta</button>"+
          quarantineAction+
        "</div></div>";
    }).join("");
    const footer=g.keepId
      ?"<div class=\"dup-resolution-bar\"><div><strong>Copia da conservare scelta.</strong><span>"+(g.verified&&g.identical?"Puoi mettere tutte le altre copie verificate in quarantena con un solo comando.":"Prima completa la verifica del gruppo per rimuovere copie.")+"</span></div><div class=\"dup-resolution-actions\">"+(g.verified&&g.identical?"<button class=\"mini-btn danger-soft\" onclick=\"quarantineDuplicateOthers('"+g.id+"')\">Quarantena tutte le altre</button>":"")+"<button class=\"mini-btn\" onclick=\"clearDuplicateKeep('"+g.id+"')\">Annulla scelta</button></div></div>"
      :"";
    return "<article class=\"duplicate-group\"><div class=\"dup-head\"><div><strong>"+esc(g.files[0].name)+"</strong><span> • "+g.files.length+" copie • recuperabili "+fmt(rec)+"</span></div><div class=\"dup-head-actions\">"+verifiedMark+verifyAction+"</div></div><div class=\"dup-files\">"+fileRows+"</div>"+footer+"</article>";
  }).join(""):"<div class=\"empty-state\"><strong>Nessun duplicato sparso: i duplicati trovati sono già raggruppati per cartella.</strong></div>";
}
window.chooseDuplicateKeep=(gid,fid)=>{const g=state.duplicateGroups.find(x=>x.id===gid);if(!g)return;g.keepId=fid;renderDuplicateGroups()};
window.clearDuplicateKeep=gid=>{const g=state.duplicateGroups.find(x=>x.id===gid);if(!g)return;g.keepId=null;renderDuplicateGroups()};
window.setKeep=(gid,fid)=>window.chooseDuplicateKeep(gid,fid);

window.quarantineDuplicateFile=async(gid,fid)=>{
  const g=state.duplicateGroups.find(x=>x.id===gid);if(!g)return;
  if(!(g.verified&&g.identical)){alert("Prima verifica il contenuto del gruppo.");return}
  if(g.keepId===fid){alert("Questa è la copia scelta da conservare.");return}
  const ok=await sendToQuarantine(fid);
  if(ok){recalc();alert("La copia è stata aggiunta alla Quarantena DiskCare.")}
};
window.quarantineDuplicateOthers=async gid=>{
  const g=state.duplicateGroups.find(x=>x.id===gid);if(!g||!g.keepId)return;
  if(!(g.verified&&g.identical)){alert("Prima verifica il contenuto del gruppo.");return}
  if(!await ensureQuarantineDestination())return;
  let n=0;
  for(const f of g.files){
    if(f.id!==g.keepId&&!state.quarantineExcludedPaths.has(norm(f.path).toLowerCase())){
      const ok=await sendToQuarantine(f.id);if(ok)n++;
    }
  }
  recalc();
  alert(n+" copie sono state aggiunte alla Quarantena DiskCare.");
};
window.moveDuplicateFile=async(gid,fid)=>{
  const g=state.duplicateGroups.find(x=>x.id===gid),f=state.files.find(x=>x.id===fid);if(!g||!f)return;
  if(!window.showDirectoryPicker){alert("Per spostare il file usa Chrome o Edge aggiornato.");return}
  if(!f.handle&&!f.fileObj){alert("Il file non è disponibile per uno spostamento reale in questa sessione.");return}
  try{
    const dest=await showDirectoryPicker({mode:"readwrite"});
    let exists=false;
    try{await dest.getFileHandle(f.name);exists=true}catch(e){}
    if(exists){alert("Nella destinazione esiste già un file con lo stesso nome. DiskCare non sovrascrive file in silenzio: scegli un'altra destinazione.");return}
    const src=f.fileObj||await f.handle.getFile();
    const dh=await copyFileObjectToDir(src,dest,f.name),dst=await dh.getFile();
    const verified=await verifyFileObjects(src,dst);
    if(verified!==true){
      alert(verified===null?"Il file è stato copiato, ma la PWA non può completare l'hash integrale per questo file molto grande. L'origine viene mantenuta.":"Verifica fallita: l'origine viene mantenuta.");
      return;
    }
    let removed=false;
    if(state.rootHandle){
      try{
        const parent=await getDirHandleForFolder(dirname(f.path),false);
        await parent.removeEntry(f.name);
        removed=true;
      }catch(e){}
    }
    f.fileObj=dst;f.handle=dh;f.path=(dest.name||"Destinazione")+"/"+f.name;
    recalc();
    if(removed)alert("File spostato e verificato. La copia origine è stata rimossa.");
    else alert("Copia verificata nella nuova destinazione. Il browser non ha consentito la rimozione automatica dell'origine, che è stata mantenuta.");
  }catch(e){if(e.name!=="AbortError")alert("Spostamento non completato: "+e.message)}
};
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
window.quarantineFolderDuplicates=async id=>{
  const fg=state.folderGroups.find(x=>x.id===id);if(!fg||!fg.keepSide)return;
  const gs=duplicateGroupsForFolder(fg);
  if(!gs.length)return;
  if(!gs.every(g=>g.verified&&g.identical)){alert("Prima verifica i duplicati: DiskCare non mette in quarantena copie non confermate come identiche.");return}
  if(!await ensureQuarantineDestination())return;
  const keepFolder=fg.keepSide==="A"?fg.a:fg.b;
  let n=0;
  for(const g of gs){
    for(const f of g.files){
      if(!fileIsUnder(f,keepFolder)&&!state.quarantineExcludedPaths.has(norm(f.path).toLowerCase())){
        const ok=await sendToQuarantine(f.id);if(ok)n++;
      }
    }
  }
  recalc();
  alert(n+" copie verificate sono state aggiunte alla Quarantena DiskCare. La coppia risolta non viene più mostrata tra i duplicati attivi.");
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
  const confirmed=[],hashConflicts=[],fixedConflicts=g.changed.filter(x=>x[3]!=="hash-mismatch");
  let bytes=0;
  for(const pair of g.pairs){
    const a=await hashFile(pair[0]),b=await hashFile(pair[1]);
    if(!a||!b){g.verified=false;g.verification="size-only";renderFolderGroups();return}
    if(a===b){confirmed.push(pair);bytes+=pair[0].size}
    else hashConflicts.push([pair[0],pair[1],pair[2],"hash-mismatch"]);
  }
  g.pairs=confirmed;g.changed=[...fixedConflicts,...hashConflicts];g.matches=confirmed.length;g.bytes=bytes;
  const maxCount=Math.max(g.countA,g.countB);g.pct=maxCount?Math.round((g.matches/maxCount)*1000)/10:0;
  g.verified=true;g.verification="full";
  buildOpportunities();renderOpportunities();renderFolderGroups();updateGuidedExperience();
}
window.verifyFolderGroup=verifyFolderGroup;
function folderPhysicalCount(g){return g.countA+g.countB}
function folderComparedPairs(g){return g.matches+g.changed.length}
function renderFolderDifferenceRows(g){
  const onlyA=g.onlyA.map((f,i)=>"<div class=\"folder-diff-row\"><span class=\"diff-badge only-a\">Solo A</span><div><strong>"+esc(f.name)+"</strong><small>"+esc(f.path)+"</small></div><b>"+fmt(f.size)+"</b><div class=\"folder-diff-actions\"><button class=\"mini-btn\" onclick=\"previewFile('"+f.id+"')\">Preview</button><label><input type=\"checkbox\" onchange=\"setFolderMissingChoice('"+g.id+"','A',"+i+",this.checked)\" "+(g.copyOnlyA?.has(i)?"checked":"")+"> Copia in B</label></div></div>").join("");
  const onlyB=g.onlyB.map((f,i)=>"<div class=\"folder-diff-row\"><span class=\"diff-badge only-b\">Solo B</span><div><strong>"+esc(f.name)+"</strong><small>"+esc(f.path)+"</small></div><b>"+fmt(f.size)+"</b><div class=\"folder-diff-actions\"><button class=\"mini-btn\" onclick=\"previewFile('"+f.id+"')\">Preview</button><label><input type=\"checkbox\" onchange=\"setFolderMissingChoice('"+g.id+"','B',"+i+",this.checked)\" "+(g.copyOnlyB?.has(i)?"checked":"")+"> Copia in A</label></div></div>").join("");
  const conflicts=g.changed.map((pair,i)=>{
    const [a,b,r,why]=pair,choice=g.conflictChoices?.[i]||"";
    return "<div class=\"folder-conflict-card\"><div class=\"folder-conflict-title\"><div><span class=\"diff-badge conflict\">File diverso</span><strong>"+esc(r||a.name)+"</strong><small>"+(why==="hash-mismatch"?"Stessa dimensione, contenuto diverso":"Dimensione diversa")+"</small></div></div>"+
      "<div class=\"folder-conflict-sides\">"+
        "<div class=\"conflict-side "+(choice==="A"?"chosen":"")+"\"><b>A</b><span>"+esc(a.name)+"</span><small>"+fmt(a.size)+" • "+esc(a.path)+"</small><div><button class=\"mini-btn\" onclick=\"previewFile('"+a.id+"')\">Preview A</button><button class=\"mini-btn "+(choice==="A"?"good":"")+"\" onclick=\"chooseFolderConflict('"+g.id+"',"+i+",'A')\">Usa A</button></div></div>"+
        "<div class=\"conflict-side "+(choice==="B"?"chosen":"")+"\"><b>B</b><span>"+esc(b.name)+"</span><small>"+fmt(b.size)+" • "+esc(b.path)+"</small><div><button class=\"mini-btn\" onclick=\"previewFile('"+b.id+"')\">Preview B</button><button class=\"mini-btn "+(choice==="B"?"good":"")+"\" onclick=\"chooseFolderConflict('"+g.id+"',"+i+",'B')\">Usa B</button></div></div>"+
      "</div></div>";
  }).join("");
  return onlyA+onlyB+conflicts||"<div class=\"empty-state\"><strong>Nessuna differenza da risolvere</strong></div>";
}
function renderFolderGroups(){
  $("folderGroupsWrap").innerHTML=state.folderGroups.length?state.folderGroups.map(g=>{
    g.copyOnlyA??=new Set();g.copyOnlyB??=new Set();g.conflictChoices??={};g.primarySide??=null;
    const status=g.verified?"Verificata":g.verification==="size-only"?"Verifica completa non disponibile per alcuni file grandi":g.verification==="mismatch"?"Differenze di contenuto":"Da verificare";
    const pairCount=folderComparedPairs(g),physical=folderPhysicalCount(g);
    const explanation=physical+" file fisici in totale: "+pairCount+" coppie corrispondenti confrontate, di cui "+g.matches+" identiche e "+g.changed.length+" diverse. "+g.onlyA.length+" file esistono solo in A e "+g.onlyB.length+" solo in B.";
    const verifyButton=!g.verified&&g.verification!=="size-only"?"<button class=\"mini-btn\" onclick=\"verifyFolderGroup('"+g.id+"')\">Verifica contenuto</button>":"";
    const primaryActions="<button class=\"mini-btn "+(g.primarySide==="A"?"good":"")+"\" onclick=\"chooseFolderPrimary('"+g.id+"','A')\">Mantieni A come principale"+(g.primarySide==="A"?" ✓":"")+"</button><button class=\"mini-btn "+(g.primarySide==="B"?"good":"")+"\" onclick=\"chooseFolderPrimary('"+g.id+"','B')\">Mantieni B come principale"+(g.primarySide==="B"?" ✓":"")+"</button>";
    const copyA=g.onlyA.length?"<button class=\"mini-btn good\" onclick=\"consolidateFolder('"+g.id+"','AtoB')\">Copia tutti i mancanti A → B ("+g.onlyA.length+")</button>":"";
    const copyB=g.onlyB.length?"<button class=\"mini-btn good\" onclick=\"consolidateFolder('"+g.id+"','BtoA')\">Copia tutti i mancanti B → A ("+g.onlyB.length+")</button>":"";
    const resolve=g.primarySide?"<button class=\"mini-btn primary-folder-action\" onclick=\"applyFolderResolution('"+g.id+"')\">Crea cartella unica in "+g.primarySide+"</button>":"";
    return "<article class=\"folder-card folder-card-guided\">"+
      "<div class=\"folder-head\"><div><strong>"+fmt(g.bytes)+" di contenuti identici</strong><span> • "+g.pct+"% struttura comune</span></div><span>"+esc(status)+"</span></div>"+
      "<div class=\"folder-body\">"+
        "<div class=\"folder-compare\"><div class=\"folder-path "+(g.primarySide==="A"?"folder-primary":"")+"\"><span>A</span>"+esc(g.a)+"</div><div class=\"versus\">VS</div><div class=\"folder-path "+(g.primarySide==="B"?"folder-primary":"")+"\"><span>B</span>"+esc(g.b)+"</div></div>"+
        "<div class=\"folder-explanation\"><strong>Cosa significa questo confronto?</strong><span>"+esc(explanation)+"</span></div>"+
        "<div class=\"folder-stats readable-folder-stats\">"+
          "<div class=\"folder-stat\"><span>File in A</span><b>"+g.countA+"</b></div><div class=\"folder-stat\"><span>File in B</span><b>"+g.countB+"</b></div>"+
          "<div class=\"folder-stat good-stat\"><span>Coppie identiche</span><b>"+g.matches+"</b></div><div class=\"folder-stat\"><span>Solo in A</span><b>"+g.onlyA.length+"</b></div>"+
          "<div class=\"folder-stat\"><span>Solo in B</span><b>"+g.onlyB.length+"</b></div><div class=\"folder-stat conflict-stat\"><span>Coppie diverse</span><b>"+g.changed.length+"</b>"+(g.changed.length?"<button class=\"stat-link\" onclick=\"toggleFolderDifferences('"+g.id+"')\">Mostra quali</button>":"")+"</div>"+
        "</div>"+
        "<div class=\"folder-actions folder-main-actions\">"+verifyButton+primaryActions+resolve+"</div>"+
        ((g.onlyA.length||g.onlyB.length)?"<div class=\"folder-actions folder-copy-actions\">"+copyA+copyB+"<button class=\"mini-btn\" onclick=\"toggleFolderDifferences('"+g.id+"')\">Scegli singoli file</button></div>":"")+
        "<div class=\"folder-differences-panel\" id=\"folderDifferences-"+g.id+"\" hidden><div class=\"folder-differences-head\"><strong>Differenze da decidere</strong><span>Usa Preview per controllare il contenuto. Le scelte servono per creare una cartella principale completa senza modificare l'altra in silenzio.</span></div>"+renderFolderDifferenceRows(g)+"</div>"+
      "</div></article>";
  }).join(""):"<div class=\"empty-state\"><strong>Nessuna cartella candidata</strong></div>";
}
window.toggleFolderDifferences=id=>{const el=$("folderDifferences-"+id);if(el)el.hidden=!el.hidden};
window.chooseFolderPrimary=(id,side)=>{const g=state.folderGroups.find(x=>x.id===id);if(!g)return;g.primarySide=side;renderFolderGroups()};
window.chooseFolderConflict=(id,index,side)=>{const g=state.folderGroups.find(x=>x.id===id);if(!g)return;g.conflictChoices??={};g.conflictChoices[index]=side;renderFolderGroups();const el=$("folderDifferences-"+id);if(el)el.hidden=false};
window.setFolderMissingChoice=(id,side,index,checked)=>{const g=state.folderGroups.find(x=>x.id===id);if(!g)return;const key=side==="A"?"copyOnlyA":"copyOnlyB";g[key]??=new Set();checked?g[key].add(index):g[key].delete(index)};
async function copyFolderFileInto(sourceFile,sourceFolder,destFolder){
  const rel=relativeTo(sourceFile,sourceFolder),parts=norm(rel).split("/"),name=parts.pop(),sub=parts.join("/");
  const destBase=await getDirHandleForFolder(destFolder,true),dd=await ensureNestedDir(destBase,sub),src=sourceFile.fileObj||await sourceFile.handle.getFile(),dh=await copyFileObjectToDir(src,dd,name),dst=await dh.getFile();
  const ok=await verifyFileObjects(src,dst);if(ok!==true)throw new Error(ok===null?"File copiato ma verifica completa non disponibile per "+name:"Verifica fallita per "+name);
}
window.applyFolderResolution=async id=>{
  const g=state.folderGroups.find(x=>x.id===id);if(!g||!g.primarySide)return;
  if(!state.rootHandle){alert("Per consolidare realmente devi prima effettuare una scansione autorizzata.");return}
  const primary=g.primarySide,sourceFolder=primary==="A"?g.b:g.a,destFolder=primary==="A"?g.a:g.b,missing=primary==="A"?g.onlyB:g.onlyA;
  const unresolved=g.changed.filter((_,i)=>!g.conflictChoices?.[i]);
  if(unresolved.length){alert("Ci sono "+unresolved.length+" file diversi ancora da decidere. Apri “Mostra quali” e scegli Usa A oppure Usa B.");const el=$("folderDifferences-"+id);if(el)el.hidden=false;return}
  try{
    for(const f of missing)await copyFolderFileInto(f,sourceFolder,destFolder);
    for(let i=0;i<g.changed.length;i++){
      const [a,b]=g.changed[i],choice=g.conflictChoices[i];
      if(choice===primary)continue;
      const src=choice==="A"?a:b,srcFolder=choice==="A"?g.a:g.b;
      await copyFolderFileInto(src,srcFolder,destFolder);
    }
    g.consolidated=true;
    alert("Cartella principale "+primary+" completata e verificata. L'altra cartella non è stata eliminata: puoi controllarla e decidere in seguito se metterla in quarantena.");
    recalc();
  }catch(e){alert("Consolidamento interrotto: "+e.message)}
};

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

function saveQuarantineState(){
  const meta=state.quarantine.map(({id,sourceId,name,size,originalPath,when,destinationName,freesSpace})=>({id,sourceId,name,size,originalPath,when,destinationName,freesSpace}));
  localStorage.setItem("diskcare.quarantineItems",JSON.stringify(meta));
  localStorage.setItem("diskcare.quarantineDestination",JSON.stringify({name:state.quarantineDestination.name,mode:state.quarantineDestination.mode}));
}
function loadQuarantineState(){
  try{
    const items=JSON.parse(localStorage.getItem("diskcare.quarantineItems")||"[]");
    if(Array.isArray(items))state.quarantine=items;
    state.quarantineExcludedPaths=new Set(state.quarantine.map(q=>norm(q.originalPath).toLowerCase()));
    const d=JSON.parse(localStorage.getItem("diskcare.quarantineDestination")||"{}");
    if(d&&typeof d==="object"){state.quarantineDestination.name=d.name||"";state.quarantineDestination.mode=d.mode||"unknown"}
  }catch(e){}
}
function quarantineModeLabel(mode){
  return mode==="other"?"Altro disco — libera spazio":mode==="same"?"Stesso disco — non libera spazio":"Da confermare";
}
function renderQuarantineDestination(){
  const d=state.quarantineDestination;
  $("qDestinationName").textContent=d.name||"Nessuna destinazione scelta";
  $("qDestinationMode").textContent=d.name?quarantineModeLabel(d.mode):"Scegli prima una cartella o un disco.";
  $("markOtherDiskBtn").disabled=!d.name;$("markSameDiskBtn").disabled=!d.name;
  $("markOtherDiskBtn").classList.toggle("selected",d.mode==="other");
  $("markSameDiskBtn").classList.toggle("selected",d.mode==="same");
  $("qDestSummary").textContent=d.name?(d.mode==="other"?"Altro disco":d.mode==="same"?"Stesso disco":"Da confermare"):"Non scelta";
}
async function chooseQuarantineDestination(){
  if(!window.showDirectoryPicker){alert("Per scegliere la quarantena usa Chrome o Edge aggiornato.");return false}
  try{
    const h=await showDirectoryPicker({mode:"readwrite"});
    state.quarantineDestination.handle=h;state.quarantineDestination.name=h.name;state.quarantineDestination.mode="unknown";
    saveQuarantineState();renderQuarantineDestination();updateQ();
    const other=confirm("La destinazione scelta si trova su un disco fisico diverso da quello che stai pulendo?\n\nOK = sì, altro disco\nAnnulla = no, stesso disco");
    state.quarantineDestination.mode=other?"other":"same";
    saveQuarantineState();renderQuarantineDestination();updateQ();
    return true;
  }catch(e){return false}
}
async function ensureQuarantineDestination(){
  if(!state.quarantineDestination.name)return await chooseQuarantineDestination();
  if(state.quarantineDestination.mode==="unknown"){
    alert("Indica se la destinazione della quarantena si trova sullo stesso disco o su un altro disco.");
    document.querySelector('[data-section="quarantine"]').click();
    return false;
  }
  if(state.quarantineDestination.mode==="same"){
    const ok=confirm("La quarantena è sullo stesso disco: questa operazione NON libererà spazio sul disco origine. Vuoi continuare comunque?");
    if(!ok){document.querySelector('[data-section="quarantine"]').click();return false}
  }
  return true;
}
async function sendToQuarantine(id){
  const f=state.files.find(x=>x.id===id);if(!f||state.quarantine.some(q=>norm(q.originalPath).toLowerCase()===norm(f.path).toLowerCase()))return false;
  if(!await ensureQuarantineDestination())return false;
  const freesSpace=state.quarantineDestination.mode==="other";
  state.quarantine.push({id:crypto.randomUUID(),sourceId:id,name:f.name,size:f.size,originalPath:f.path,when:new Date().toLocaleString("it-IT"),destinationName:state.quarantineDestination.name,freesSpace});
  state.quarantineExcludedPaths.add(norm(f.path).toLowerCase());
  saveQuarantineState();updateQ();
  return true;
}
window.sendToQuarantine=sendToQuarantine;
function updateQ(){
  const bytes=state.quarantine.reduce((sum,q)=>sum+q.size,0),freed=state.quarantine.reduce((sum,q)=>sum+(q.freesSpace?q.size:0),0);
  $("qBadge").textContent=state.quarantine.length;$("qCount").textContent=state.quarantine.length;$("qSpace").textContent=fmt(bytes);$("qFreedSpace").textContent=fmt(freed);$("qCompactText").textContent=state.quarantine.length+" file • "+fmt(bytes)+" • tutto ripristinabile";
  $("qSpaceMessage").innerHTML="<strong>Spazio "+(state.quarantineDestination.mode==="other"?"previsto da liberare":"liberato")+" sul disco origine: "+fmt(freed)+"</strong><span>"+(state.quarantineDestination.mode==="other"?"La destinazione è indicata come disco diverso: questi file non verranno più conteggiati tra i duplicati attivi.":state.quarantineDestination.mode==="same"?"La quarantena è sullo stesso disco: spostare i file non riduce lo spazio occupato complessivo.":"Scegli e classifica la destinazione della quarantena prima di considerare recuperato lo spazio.")+"</span>";
  renderQuarantineDestination();renderQ();
}
function renderQ(){
  const q=($("qSearch")?.value||"").toLowerCase(),items=state.quarantine.filter(x=>(x.name+" "+x.originalPath+" "+(x.destinationName||"")).toLowerCase().includes(q));
  $("qTableWrap").innerHTML=items.length?"<table><thead><tr><th>File</th><th>Spazio</th><th>Origine</th><th>Destinazione</th><th>Effetto</th><th>Azione</th></tr></thead><tbody>"+items.map(x=>"<tr><td>"+esc(x.name)+"</td><td>"+fmt(x.size)+"</td><td class=\"path\">"+esc(x.originalPath)+"</td><td>"+esc(x.destinationName||"—")+"</td><td>"+(x.freesSpace?"Libera spazio sull'origine":"Non libera spazio")+"</td><td><button class=\"mini-btn\" onclick=\"restoreItem('"+x.id+"')\">Ripristina</button></td></tr>").join("")+"</tbody></table>":"<div class=\"empty-state\"><strong>Quarantena vuota</strong></div>";
}
window.restoreItem=id=>{
  const item=state.quarantine.find(x=>x.id===id);if(!item)return;
  state.quarantine=state.quarantine.filter(x=>x.id!==id);
  state.quarantineExcludedPaths.delete(norm(item.originalPath).toLowerCase());
  saveQuarantineState();updateQ();recalc();
};
$("pickQuarantineDestBtn").onclick=chooseQuarantineDestination;
$("markOtherDiskBtn").onclick=()=>{state.quarantineDestination.mode="other";saveQuarantineState();renderQuarantineDestination();updateQ()};
$("markSameDiskBtn").onclick=()=>{state.quarantineDestination.mode="same";saveQuarantineState();renderQuarantineDestination();updateQ()};

function diskcareFileCategory(f){
  const e=ext(f.name);
  if(isProtectedPath(f.path))return"system";
  if([".doc",".docx",".xls",".xlsx",".ppt",".pptx",".pdf",".txt",".rtf",".odt",".dwg",".dxf"].includes(e))return"docs";
  if([".jpg",".jpeg",".png",".gif",".webp",".bmp",".heic",".tif",".tiff",".psd",".ai"].includes(e))return"photos";
  if([".mp4",".mov",".avi",".mkv",".mpeg",".wmv",".m4v"].includes(e))return"video";
  if([".exe",".msi",".msix",".appx",".dll",".sys",".safetensors"].includes(e))return"programs";
  if([".zip",".rar",".7z",".iso",".tar",".gz",".bak"].includes(e))return"archives";
  return"other";
}
function diskcareCategoryTotals(){
  const out={system:0,docs:0,photos:0,video:0,programs:0,archives:0,other:0};
  state.files.forEach(f=>out[diskcareFileCategory(f)]+=f.size||0);
  return out;
}
function diskcareMoveCandidates(){
  return state.files.filter(f=>!isProtectedPath(f.path)&&f.size>=500*1024*1024&&!state.quarantineExcludedPaths.has(norm(f.path).toLowerCase()));
}
function diskcareReviewItems(){
  return state.files.map(f=>({f,a:advice(f)})).filter(x=>["check","quarantine"].includes(x.a.type));
}
function setTextIf(id,value){const el=$(id);if(el)el.textContent=value}
function updateGuidedExperience(){
  const cats=diskcareCategoryTotals(),total=Object.values(cats).reduce((a,b)=>a+b,0);
  const colors={system:"#64748b",docs:"#3b82f6",photos:"#35b979",video:"#ef5350",programs:"#8557df",archives:"#f2b01e",other:"#a8b5c4"};
  const order=["system","docs","photos","video","programs","archives","other"];let acc=0,parts=[];
  order.forEach(k=>{const p=total?cats[k]/total*100:0;parts.push(colors[k]+" "+acc.toFixed(2)+"% "+(acc+p).toFixed(2)+"%");acc+=p});
  const donut=$("diskDonut");if(donut)donut.style.background="conic-gradient("+parts.join(",")+")";
  setTextIf("diskUsed",fmt(total));setTextIf("diskFree",state.rootHandle?"Spazio libero non disponibile nella PWA":"Anteprima dati demo");setTextIf("diskPct",total?"Distribuzione di "+fmt(total)+" analizzati":"Nessun dato");
  [["catSystemHome","system"],["catDocsHome","docs"],["catPhotosHome","photos"],["catVideoHome","video"],["catProgramsHome","programs"],["catArchivesHome","archives"],["catOtherHome","other"]].forEach(([id,k])=>setTextIf(id,fmt(cats[k])));
  setTextIf("homeDiskLabel","Unità "+(state.rootName||"analizzata"));

  const dupBytes=state.duplicateGroups.reduce((s,g)=>s+(g.files[0]?.size||0)*Math.max(0,g.files.length-1),0);
  const folderBytes=state.folderGroups.reduce((s,g)=>s+(g.bytes||0),0);
  const moves=diskcareMoveCandidates(),moveBytes=moves.reduce((s,f)=>s+f.size,0);
  const reviews=diskcareReviewItems(),reviewBytes=reviews.reduce((s,x)=>s+x.f.size,0);
  setTextIf("homeMoveBytes",fmt(moveBytes));setTextIf("homeReviewBytes",fmt(reviewBytes));
  setTextIf("guideDupBytes",fmt(dupBytes));setTextIf("guideFolderBytes",fmt(folderBytes));setTextIf("guideMoveBytes",fmt(moveBytes));setTextIf("guideReviewBytes",fmt(reviewBytes));

  const choices=[["Copie duplicate",dupBytes],["Cartelle simili",folderBytes],["File spostabili",moveBytes],["Elementi da valutare",reviewBytes]].sort((a,b)=>b[1]-a[1]);
  const main=choices[0]||["Nessun problema rilevante",0];
  setTextIf("homeMainProblem",main[0]+": "+fmt(main[1]));setTextIf("recoverMainProblem",main[0]);
  setTextIf("homeMainProblemText",main[1]?"È l'area con il maggiore impatto potenziale sullo spazio.":"Non risultano opportunità importanti.");
  setTextIf("homeAdvice",dupBytes?"Controlla prima i duplicati, poi valuta lo spostamento dei file più pesanti.":"Parti dalle opportunità a rischio più basso.");
  setTextIf("homeDiagnosis",total?"DiskCare ha analizzato "+state.files.length.toLocaleString("it-IT")+" file. Le categorie più pesanti sono ordinate nel grafico; le copie duplicate sono mostrate separatamente per evitare doppi conteggi.":"Nessun dato disponibile.");

  setTextIf("recoverRecTitle",dupBytes?"Copie duplicate trovate":"Opportunità ordinate per sicurezza");
  setTextIf("recoverRecText",dupBytes?"Abbiamo trovato "+fmt(dupBytes)+" di copie duplicate potenziali. È il punto più semplice da controllare senza perdere contenuti importanti.":"DiskCare non ha trovato duplicati rilevanti: passa alle altre opportunità.");
  setTextIf("recoverRecBytes",fmt(dupBytes));setTextIf("recoverRecCount",state.duplicateGroups.length+" gruppi");

  const verified=state.duplicateGroups.filter(g=>g.verified&&g.identical),verifiedBytes=verified.reduce((s,g)=>s+(g.files[0]?.size||0)*Math.max(0,g.files.length-1),0);
  const pendingBytes=Math.max(0,dupBytes-verifiedBytes);
  setTextIf("dupCopiesMetric",state.duplicateGroups.reduce((s,g)=>s+Math.max(0,g.files.length-1),0).toLocaleString("it-IT"));
  setTextIf("dupBytesMetric",fmt(dupBytes));setTextIf("dupVerifiedMetric",verified.length.toLocaleString("it-IT"));setTextIf("dupVerifiedBytes",fmt(verifiedBytes));setTextIf("dupGroupMetric",state.duplicateGroups.length+" gruppi");setTextIf("dupGuideVerified",fmt(verifiedBytes));setTextIf("dupGuidePending",fmt(pendingBytes));setTextIf("dupGuideFolders",fmt(folderBytes));setTextIf("dupGuideReview",fmt(reviewBytes));

  setTextIf("folderPairsMetric",state.folderGroups.length.toLocaleString("it-IT"));setTextIf("folderBytesMetric",fmt(folderBytes));
  const likely=state.folderGroups.filter(g=>g.pct>=75&&g.changed.length===0);
  setTextIf("folderLikelyMetric",likely.length.toLocaleString("it-IT"));setTextIf("folderRecBytes",fmt(likely.reduce((s,g)=>s+g.bytes,0)));setTextIf("folderRecCount",likely.length+" coppie");
  const bucket=(fn)=>state.folderGroups.filter(fn).reduce((s,g)=>s+g.bytes,0);
  setTextIf("folderSameBytes",fmt(bucket(g=>g.pct>=90&&!g.changed.length)));setTextIf("folderReorgBytes",fmt(bucket(g=>g.pct>=75&&g.pct<90&&!g.changed.length)));setTextIf("folderCareBytes",fmt(bucket(g=>g.pct>=60&&(g.changed.length||g.pct<75))));setTextIf("folderUnknownBytes",fmt(bucket(g=>g.pct<60)));

  setTextIf("moveBytesMetric",fmt(moveBytes));setTextIf("moveCountMetric",moves.length.toLocaleString("it-IT"));setTextIf("moveRecBytes",fmt(moveBytes));setTextIf("moveRecCount",moves.length+" elementi");
  const mv=(cat)=>moves.filter(f=>diskcareFileCategory(f)===cat).reduce((s,f)=>s+f.size,0);
  setTextIf("moveVideoBytes",fmt(mv("video")+mv("archives")));setTextIf("moveProjectsBytes",fmt(moves.filter(f=>/progett|project|lavor/i.test(f.path)).reduce((s,f)=>s+f.size,0)));setTextIf("moveBackupBytes",fmt(moves.filter(f=>/backup|bak/i.test(f.path)).reduce((s,f)=>s+f.size,0)));setTextIf("moveOtherBytes",fmt(moves.filter(f=>!["video","archives"].includes(diskcareFileCategory(f))).reduce((s,f)=>s+f.size,0)));

  setTextIf("reviewCountMetric",reviews.length.toLocaleString("it-IT"));setTextIf("reviewBytesMetric",fmt(reviewBytes));setTextIf("reviewAmbiguousMetric",reviews.filter(x=>x.a.type==="check").length.toLocaleString("it-IT"));setTextIf("reviewRecBytes",fmt(reviewBytes));setTextIf("reviewRecCount",reviews.length+" elementi");
  const rsum=(pred)=>reviews.filter(x=>pred(x.f)).reduce((s,x)=>s+x.f.size,0);
  setTextIf("reviewDownloadBytes",fmt(rsum(f=>/download/i.test(f.path))));setTextIf("reviewInstallerBytes",fmt(rsum(f=>isInstaller(ext(f.name)))));setTextIf("reviewBackupBytes",fmt(rsum(f=>/backup|bak/i.test(f.path)||isArchive(ext(f.name)))));setTextIf("reviewDocsBytes",fmt(rsum(f=>isDocument(ext(f.name)))));
}

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
  $("homeProtectedText").textContent=protectedItems.toLocaleString("it-IT")+" elementi in aree di sistema";
  const sec=Math.max(0,Math.round(elapsedSeconds));
  const elapsed=String(Math.floor(sec/60)).padStart(2,"0")+":"+String(sec%60).padStart(2,"0");
  $("statusText").textContent="Analisi completata: "+state.files.length.toLocaleString("it-IT")+" file e "+folders.size.toLocaleString("it-IT")+" cartelle.";
  $("metricElapsed").textContent=elapsed;
  updateGuidedExperience();
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

$("changeDiskBtn").onclick=()=>$("scanBtn").click();
$("homeShowDetails").onclick=()=>{const d=$("homeDetails");if(d)d.open=!d.open};
$("whyRecommendation").onclick=()=>alert("DiskCare ordina i suggerimenti considerando spazio recuperabile, affidabilità della verifica e semplicità dell'operazione.");
$("startSafeDuplicates").onclick=()=>{const b=$("verifyAllBtn");if(b)b.click()};
$("verifyAllBtnMirror").onclick=()=>{const b=$("verifyAllBtn");if(b)b.click()};
$("startMoveGuided").onclick=()=>{const b=$("startCopyFolder");if(b)b.click()};
["moveOpenVideo","moveOpenProjects","moveOpenBackup","moveOpenOther"].forEach(id=>{const e=$(id);if(e)e.onclick=()=>{const b=$("startCopyFolder");if(b)b.click()}});

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
$("qSearch").oninput=renderQ;$("restoreAllBtn").onclick=()=>{state.quarantine=[];state.quarantineExcludedPaths.clear();saveQuarantineState();updateQ();recalc()};$("purgeAllBtn").onclick=()=>{if(state.quarantine.length&&confirm("Eliminare definitivamente la quarantena simulata?")){state.quarantine=[];state.quarantineExcludedPaths.clear();saveQuarantineState();updateQ();recalc()}};
loadSavedTheme();loadSavedPerformance();loadQuarantineState();updateQ();