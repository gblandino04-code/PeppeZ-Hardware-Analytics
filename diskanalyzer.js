// Analizzatore Spazio Disco in stile WinDirStat (1 disco alla volta: Albero Cartelle/File, Estensioni, File più Grandi, File Duplicati)
// + Strumenti Avanzati Opzionali Windows Optimizer
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto"),cp=require("child_process");

const run=(cmd,args,opt)=>new Promise(r=>cp.execFile(cmd,args,Object.assign({windowsHide:true,timeout:120000,maxBuffer:8*1024*1024},opt||{}),(err,out,stderr)=>r({err,out:String(out||""),stderr:String(stderr||"")})));
const runPs=(script,timeout=45000)=>run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",`[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'; ${script}`],{timeout});

const CLUSTER_SIZE=4096;
const roundCluster=bytes=>bytes<=0?0:Math.ceil(bytes/CLUSTER_SIZE)*CLUSTER_SIZE;

function fmtBytes(b){
 if(b==null||isNaN(b)||b<0)return"0 B";
 if(b<1024)return`${b} Bytes`;
 if(b<1048576)return`${(b/1024).toFixed(1).replace(".",",")} KB`;
 if(b<1073741824)return`${(b/1048576).toFixed(1).replace(".",",")} MB`;
 return`${(b/1073741824).toFixed(1).replace(".",",")} GB`;
}

function fmtDate(ms){
 if(!ms)return"--";
 const d=new Date(ms);
 if(isNaN(d.getTime()))return"--";
 return d.toLocaleDateString("it-IT",{day:"2-digit",month:"2-digit",year:"numeric"});
}

// Descrizioni e colori per le estensioni più comuni (stile colonna destra di WinDirStat)
const EXT_META={
 ".ucas":["File UCAS (Unreal Engine Archive)","#2563eb"],
 ".pak":["File PAK (Archivio Gioco)","#9333ea"],
 ".utoc":["File UTOC (Indice Unreal Engine)","#3b82f6"],
 ".dll":["Estensione dell'applicazione (DLL)","#1d4ed8"],
 ".exe":["Applicazione Windows (EXE)","#16a34a"],
 ".sys":["File di sistema Windows (SYS)","#ca8a04"],
 ".msi":["Pacchetto Windows Installer","#0d9488"],
 ".cab":["Archivio Cabinet Windows","#0284c7"],
 ".mp4":["File Video MP4","#d97706"],
 ".mkv":["File Video Matroska","#ea580c"],
 ".avi":["File Video AVI","#f59e0b"],
 ".mov":["File Video QuickTime","#b45309"],
 ".mp3":["File Audio MP3","#db2777"],
 ".wav":["File Audio WAV","#e11d48"],
 ".ogg":["File Audio OGG","#be123c"],
 ".zip":["Cartella compressa ZIP","#0891b2"],
 ".7z":["Archivio compresso 7-Zip","#06b6d4"],
 ".rar":["Archivio compresso WinRAR","#0e7490"],
 ".tar":["Archivio TAR","#155e75"],
 ".gz":["Archivio GZip","#164e63"],
 ".iso":["Immagine Disco Ottico ISO","#7c3aed"],
 ".vhd":["Disco Rigido Virtuale","#6d28d9"],
 ".vhdx":["Disco Rigido Virtuale Hyper-V","#5b21b6"],
 ".vmdk":["Disco Virtuale VMware","#4c1d95"],
 ".bk2":["File Video Bink 2 (BK2)","#a21caf"],
 ".nvph":["File Cache Shader NVIDIA","#15803d"],
 ".bin":["File Dati Binario (BIN)","#0f766e"],
 ".dat":["File Dati (DAT)","#334155"],
 ".db":["File Database","#475569"],
 ".sqlite":["Database SQLite","#64748b"],
 ".log":["File Registro Eventi (LOG)","#94a3b8"],
 ".tmp":["File Temporaneo","#dc2626"],
 ".dmp":["Dump di Memoria / Crash","#ef4444"],
 ".json":["File Dati JSON","#0284c7"],
 ".xml":["Documento XML","#0369a1"],
 ".txt":["Documento di testo","#64748b"],
 ".pdf":["Documento Adobe PDF","#dc2626"],
 ".png":["Immagine PNG","#ec4899"],
 ".jpg":["Immagine JPEG","#f43f5e"],
 ".jpeg":["Immagine JPEG","#f43f5e"],
 ".webp":["Immagine WebP","#d946ef"],
 ".dds":["Texture DirectDraw Surface","#8b5cf6"],
 ".jar":["Executable Jar File (Java)","#10b981"],
 ".js":["File JavaScript","#eab308"],
 ".ts":["File TypeScript","#3b82f6"],
 ".py":["Script Python","#22c55e"],
 ".cpp":["Codice Sorgente C++","#6366f1"],
 ".h":["Header C/C++","#818cf8"],
 ".upk":["Unreal Package File","#7c3aed"],
 ".rpf":["Rockstar Package File","#e11d48"],
 ".vpk":["Valve Pak Archive","#f97316"],
 ".bundle":["File Bundle","#06b6d4"],
 ".assets":["Unity Assets File","#14b8a6"],
 ".resS":["Unity Resources File","#0d9488"]
};

const PALETTE=["#2563eb","#16a34a","#d97706","#9333ea","#0891b2","#dc2626","#ca8a04","#db2777","#4f46e5","#0d9488","#ea580c","#65a30d"];
function getExtInfo(ext){
 if(!ext)return{desc:"Nessuna Estensione",color:"#15803d"};
 const low=ext.toLowerCase();
 if(EXT_META[low])return{desc:EXT_META[low][0],color:EXT_META[low][1]};
 let hash=0;
 for(let i=0;i<low.length;i++)hash=((hash<<5)-hash)+low.charCodeAt(i);
 const col=PALETTE[Math.abs(hash)%PALETTE.length];
 return{desc:`File ${low.slice(1).toUpperCase()}`,color:col};
}

// Stato scansione corrente (1 disco alla volta, con cache dei nodi cartella per apertura istantanea)
let activeScan={
 running:false,
 cancel:false,
 drive:"",
 dirMap:new Map(), // pathLower -> {size, physSize, files, folders, mtime}
 rootFiles:new Map(), // per file speciali nella radice (pagefile.sys, hiberfil.sys, swapfile.sys)
 lastResult:null
};

// Verifica se un percorso appartiene a directory di installazione attiva, cartelle temporanee o file in download
function isExcludedFromDeepScan(filePath){
 if(!filePath)return true;
 const low=filePath.toLowerCase();
 // Escludi cartelle temporanee, installer e percorsi applicativi utente che potrebbero essere aggiornati
 if(low.includes("\\appdata\\local\\temp")||
    low.includes("\\windows\\temp")||
    low.includes("\\squirrel")||
    low.includes("\\package cache")||
    low.includes("\\$recycle.bin")||
    low.includes("\\system volume information")||
    low.includes("\\windows\\installer")||
    low.includes("\\appdata\\local\\programs")){
  return true;
 }
 // Escludi file di download parziale o temporanei
 if(/\.(tmp|part|crdownload|download|pending|lock)$/i.test(low)||/^[~$]/.test(path.basename(low))){
  return true;
 }
 return false;
}

// Calcola un'impronta veloce di un file (primi 64KB + 64KB centrali + ultimi 64KB) per verificare i duplicati senza bloccare il disco
async function fastFileSignature(filePath,fileSize){
 if(isExcludedFromDeepScan(filePath))return null;
 let fh=null;
 try{
  fh=await fsp.open(filePath,"r");
  const chunk=Math.min(65536,fileSize);
  const buf=Buffer.alloc(chunk*3);
  const r1=await fh.read(buf,0,chunk,0);
  const mid=Math.max(0,Math.floor(fileSize/2)-Math.floor(chunk/2));
  const r2=await fh.read(buf,chunk,chunk,mid);
  const end=Math.max(0,fileSize-chunk);
  const r3=await fh.read(buf,chunk*2,chunk,end);
  const totalRead=(r1&&r1.bytesRead||chunk)+(r2&&r2.bytesRead||chunk)+(r3&&r3.bytesRead||chunk);
  return crypto.createHash("sha1").update(buf.slice(0,Math.min(buf.length,totalRead))).digest("hex");
 }catch(e){
  return null;
 }finally{
  if(fh){
   try{await fh.close()}catch(err){}
  }
 }
}

// Recupera dimensioni di file di sistema bloccati nella radice del disco (es. pagefile.sys, hiberfil.sys, swapfile.sys)
async function getRootLockedSystemFiles(driveRoot){
 const map=new Map();
 const ps=`
 Get-ChildItem -LiteralPath '${driveRoot.replace(/'/g,"''")}' -Force -File -ErrorAction SilentlyContinue |
   Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Compress
 `;
 const r=await runPs(ps,8000);
 try{
  const parsed=JSON.parse(r.out.trim());
  const list=Array.isArray(parsed)?parsed:(parsed?[parsed]:[]);
  for(const f of list){
   if(f&&f.Name&&typeof f.Length==="number"){
    const mtime=f.LastWriteTimeUtc?new Date(f.LastWriteTimeUtc).getTime():Date.now();
    map.set(f.Name.toLowerCase(),{name:f.Name,size:f.Length,physSize:roundCluster(f.Length),mtime});
   }
  }
 }catch(e){}
 return map;
}

// Esegue la scansione completa di 1 singolo disco alla volta (stile WinDirStat)
async function scanDiskWinDirStat(driveLetterOrRoot,onProgress){
 if(activeScan.running){
  activeScan.cancel=true;
  await new Promise(r=>setTimeout(r,250));
 }
 const rawInput=String(driveLetterOrRoot||"C:").trim();
 const cleanDrive=rawInput.slice(0,2).toUpperCase();
 const rootPath=(rawInput.length>3&&fs.existsSync(rawInput))?path.resolve(rawInput):(cleanDrive+"\\");

 activeScan={
  running:true,
  cancel:false,
  drive:cleanDrive,
  dirMap:new Map(),
  rootFiles:new Map(),
  sizeBuckets:new Map(),
  lastResult:null
 };

 const t0=Date.now();
 let filesScanned=0,foldersScanned=0,bytesScanned=0,lastProgTs=0;
 const extStats=new Map(); // ext -> {ext, bytes, files}
 const largestFiles=[]; // manteniamo i top 250 file più grandi
 let minLargestByte=1024*1024; // soglia iniziale 1 MB
 const sizeBuckets=activeScan.sizeBuckets; // size -> [ {path, name, mtime} ] per file >= 2.5 MB (usato solo se l'utente avvia manualmente Duplicate Files)

 // Info spazio libero / totale del disco
 let diskTotalBytes=0,diskFreeBytes=0;
 try{
  const psDrive=`$d=Get-PSDrive -Name '${cleanDrive[0]}' -ErrorAction SilentlyContinue; if($d){ @{free=$d.Free; used=$d.Used} | ConvertTo-Json -Compress }`;
  const dr=await runPs(psDrive,6000);
  const dj=JSON.parse(dr.out.trim());
  if(dj){
   diskFreeBytes=Number(dj.free)||0;
   diskTotalBytes=(Number(dj.used)||0)+diskFreeBytes;
  }
 }catch(e){}

 activeScan.rootFiles=await getRootLockedSystemFiles(rootPath);

 function recordFileForStats(fullPath,name,size,physSize,mtime){
  filesScanned++;
  bytesScanned+=size;
  const ext=path.extname(name).toLowerCase()||"";
  let es=extStats.get(ext);
  if(!es){es={ext,bytes:0,files:0};extStats.set(ext,es)}
  es.bytes+=size;
  es.files++;

  // Top 220 Largest Files
  if(size>=minLargestByte||largestFiles.length<220){
   largestFiles.push({name,path:fullPath,size,physSize,mtime,ext});
   if(largestFiles.length>280){
    largestFiles.sort((a,b)=>b.size-a.size);
    largestFiles.length=220;
    minLargestByte=largestFiles[largestFiles.length-1].size;
   }
  }

  // Candidati duplicati (file >= 2.5 MB per velocità ed efficacia, escluse cartelle temporanee/installazioni)
  if(size>=2621440 && !isExcludedFromDeepScan(fullPath)){
   let b=sizeBuckets.get(size);
   if(!b){b=[];sizeBuckets.set(size,b)}
   if(b.length<12)b.push({name,path:fullPath,size,mtime});
  }
 }

 async function walkDir(dirPath,depth){
  if(activeScan.cancel)return{size:0,physSize:0,files:0,folders:0,mtime:0};
  foldersScanned++;
  const now=Date.now();
  if(onProgress&&now-lastProgTs>=220){
   lastProgTs=now;
   const usedEst=diskTotalBytes>diskFreeBytes?(diskTotalBytes-diskFreeBytes):0;
   const pct=usedEst>0?Math.min(96,Math.max(2,Math.round((bytesScanned/usedEst)*95))):Math.min(92,Math.round(filesScanned/3000));
   onProgress({
    drive:cleanDrive,
    phase:"Scansione albero cartelle e file...",
    pct,
    filesScanned,
    foldersScanned,
    bytesScannedFmt:fmtBytes(bytesScanned),
    currentDir:dirPath
   });
  }

  let entries=[];
  try{
   entries=await fsp.readdir(dirPath,{withFileTypes:true});
  }catch(e){
   return{size:0,physSize:0,files:0,folders:0,mtime:0};
  }

  let totalSize=0,totalPhys=0,totalFiles=0,totalFolders=0,latestMtime=0;
  const subDirs=[];
  const isRoot=(depth===0);

  for(const ent of entries){
   if(activeScan.cancel)break;
   // Evita i punti di giunzione / symlink per non contare due volte o entrare in loop
   if(ent.isSymbolicLink())continue;
   const full=path.join(dirPath,ent.name);
   if(ent.isDirectory()){
    const lowName=ent.name.toLowerCase();
    if(lowName==="$recycle.bin"||lowName==="system volume information")continue;
    subDirs.push(full);
   }else if(ent.isFile()){
    let st=null;
    try{st=await fsp.lstat(full)}catch(e){}
    if(st){
     const sz=st.size||0;
     const ps=roundCluster(sz);
     const mt=st.mtimeMs||0;
     totalSize+=sz;
     totalPhys+=ps;
     totalFiles++;
     if(mt>latestMtime)latestMtime=mt;
     recordFileForStats(full,ent.name,sz,ps,mt);
    }else if(isRoot&&activeScan.rootFiles.has(ent.name.toLowerCase())){
     const rf=activeScan.rootFiles.get(ent.name.toLowerCase());
     totalSize+=rf.size;
     totalPhys+=rf.physSize;
     totalFiles++;
     if(rf.mtime>latestMtime)latestMtime=rf.mtime;
     recordFileForStats(full,ent.name,rf.size,rf.physSize,rf.mtime);
    }
   }
  }

  // Scansione sottocartelle con concorrenza controllata (più alta ai primi livelli per saturare l'I/O NVMe/SSD)
  const conc=depth<2?6:depth<4?4:2;
  for(let i=0;i<subDirs.length;i+=conc){
   if(activeScan.cancel)break;
   const batch=subDirs.slice(i,i+conc);
   const resList=await Promise.all(batch.map(sd=>walkDir(sd,depth+1)));
   for(const r of resList){
    totalSize+=r.size;
    totalPhys+=r.physSize;
    totalFiles+=r.files;
    totalFolders+=1+r.folders;
    if(r.mtime>latestMtime)latestMtime=r.mtime;
   }
  }

  const statObj={size:totalSize,physSize:totalPhys,files:totalFiles,folders:totalFolders,mtime:latestMtime};
  activeScan.dirMap.set(dirPath.toLowerCase(),statObj);
  return statObj;
 }

 const rootStat=await walkDir(rootPath,0);
 if(activeScan.cancel){
  activeScan.running=false;
  return{ok:false,canceled:true};
 }

 // NOTA: Durante il check del disco calcoliamo solo All Files e Largest Files.
 // I Duplicate Files vengono esclusi dal check iniziale e calcolati solo su richiesta manuale dell'utente.

 // Ordina Largest Files
 largestFiles.sort((a,b)=>b.size-a.size);
 const topLargest=largestFiles.slice(0,200).map((f,idx)=>{
  const pct=rootStat.size>0?+((f.size/rootStat.size)*100).toFixed(1):0;
  return{
   rank:idx+1,
   name:f.name,
   path:f.path,
   dir:path.dirname(f.path),
   ext:f.ext||"--",
   size:f.size,
   sizeFmt:fmtBytes(f.size),
   physSizeFmt:fmtBytes(f.physSize),
   pct,
   pctFmt:pct.toFixed(1).replace(".",",")+"%",
   lastChange:fmtDate(f.mtime)
  };
 });

 // Ordina Estensioni (colonna destra WinDirStat)
 const extensions=[...extStats.values()].sort((a,b)=>b.bytes-a.bytes).slice(0,100).map(e=>{
  const meta=getExtInfo(e.ext);
  const pct=rootStat.size>0?+((e.bytes/rootStat.size)*100).toFixed(1):0;
  return{
   ext:e.ext||"(nessuna)",
   color:meta.color,
   desc:meta.desc,
   bytes:e.bytes,
   bytesFmt:fmtBytes(e.bytes),
   files:e.files,
   filesFmt:e.files.toLocaleString("it-IT"),
   pct,
   pctFmt:pct.toFixed(1).replace(".",",")+"%"
  };
 });

 const topChildren=await getDirectoryChildren(rootPath);
 const freePct=diskTotalBytes>0?+((diskFreeBytes/diskTotalBytes)*100).toFixed(1):0;
 const elapsedSec=+((Date.now()-t0)/1000).toFixed(1);

 const result={
  ok:true,
  drive:cleanDrive,
  rootPath,
  rootLabel:`(${cleanDrive}) - ${freePct.toFixed(1).replace(".",",")}% Free`,
  scannedAt:new Date().toLocaleString("it-IT"),
  elapsedSec,
  totalDiskBytes:diskTotalBytes,
  freeDiskBytes:diskFreeBytes,
  rootSize:rootStat.size,
  rootSizeFmt:fmtBytes(rootStat.size),
  rootPhysSize:rootStat.physSize,
  rootPhysSizeFmt:fmtBytes(rootStat.physSize),
  totalFiles:rootStat.files,
  totalFilesFmt:rootStat.files.toLocaleString("it-IT"),
  totalFolders:rootStat.folders,
  lastChange:fmtDate(rootStat.mtime),
  children:topChildren,
  extensions,
  largestFiles:topLargest,
  duplicateGroups:[],
  duplicatesScanned:false,
  totalWastedDuplicatesFmt:"0 MB"
 };

 activeScan.running=false;
 activeScan.lastResult=result;
 if(onProgress){
  onProgress({
   drive:cleanDrive,
   phase:"Analisi completata!",
   pct:100,
   filesScanned,
   foldersScanned,
   bytesScannedFmt:fmtBytes(rootStat.size),
   currentDir:rootPath
  });
 }
 return result;
}

// Scansione manuale dei file duplicati (avviata solo quando l'utente clicca manualmente su Duplicate Files)
async function scanDiskDuplicates(onProgress){
 if(!activeScan.lastResult||!activeScan.sizeBuckets){
  return{ok:false,msg:"Esegui prima il Check File del disco per analizzare i duplicati."};
 }
 activeScan.running=true;
 activeScan.cancel=false;
 const duplicateGroups=[];
 const candidateBuckets=[...activeScan.sizeBuckets.entries()].filter(([sz,arr])=>arr.length>=2).sort((a,b)=>b[0]-a[0]).slice(0,160);
 const totalBuckets=Math.max(1,candidateBuckets.length);
 let doneBuckets=0;

 for(const [sz,arr] of candidateBuckets){
  if(activeScan.cancel)break;
  doneBuckets++;
  if(onProgress){
   onProgress({
    drive:activeScan.drive,
    phase:`Verifica hash SHA-1 file duplicati (${doneBuckets}/${totalBuckets} gruppi)...`,
    pct:Math.min(99,Math.max(5,Math.round((doneBuckets/totalBuckets)*98))),
    filesScanned:activeScan.lastResult.totalFiles||0,
    foldersScanned:activeScan.lastResult.totalFolders||0,
    bytesScannedFmt:fmtBytes(sz),
    currentDir:arr[0]?arr[0].path:""
   });
  }
  const byHash=new Map();
  for(const item of arr){
   if(activeScan.cancel)break;
   const sig=await fastFileSignature(item.path,sz);
   if(!sig)continue;
   let hList=byHash.get(sig);
   if(!hList){hList=[];byHash.set(sig,hList)}
   hList.push(item);
  }
  for(const [sig,hList] of byHash.entries()){
   if(hList.length>=2){
    const wastedBytes=sz*(hList.length-1);
    duplicateGroups.push({
     hash:sig.slice(0,10),
     name:hList[0].name,
     ext:path.extname(hList[0].name).toLowerCase()||"",
     fileSize:sz,
     fileSizeFmt:fmtBytes(sz),
     count:hList.length,
     wastedBytes,
     wastedFmt:fmtBytes(wastedBytes),
     files:hList.map(f=>({
      name:f.name,
      path:f.path,
      dir:path.dirname(f.path),
      size:sz,
      sizeFmt:fmtBytes(sz),
      lastChange:fmtDate(f.mtime)
     }))
    });
   }
  }
 }
 duplicateGroups.sort((a,b)=>b.wastedBytes-a.wastedBytes);
 activeScan.running=false;
 if(activeScan.cancel)return{ok:false,canceled:true};

 const totalWasted=duplicateGroups.reduce((a,g)=>a+g.wastedBytes,0);
 const totalWastedFmt=fmtBytes(totalWasted);
 activeScan.lastResult.duplicateGroups=duplicateGroups.slice(0,120);
 activeScan.lastResult.duplicatesScanned=true;
 activeScan.lastResult.totalWastedDuplicatesFmt=totalWastedFmt;

 if(onProgress){
  onProgress({
   drive:activeScan.drive,
   phase:"Analisi completata!",
   pct:100,
   filesScanned:activeScan.lastResult.totalFiles||0,
   foldersScanned:activeScan.lastResult.totalFolders||0,
   bytesScannedFmt:totalWastedFmt,
   currentDir:activeScan.lastResult.rootPath
  });
 }
 return{
  ok:true,
  duplicateGroups:activeScan.lastResult.duplicateGroups,
  totalWastedDuplicatesFmt:totalWastedFmt,
  duplicatesScanned:true
 };
}

// Restituisce tutte le sottocartelle e i file diretti di una cartella, ordinati per dimensione decrescente (con percentuale subtree!)
async function getDirectoryChildren(dirPath){
 if(!dirPath)return[];
 const norm=path.normalize(dirPath);
 const parentStat=activeScan.dirMap.get(norm.toLowerCase())||{size:0,physSize:0};
 let entries=[];
 try{
  entries=await fsp.readdir(norm,{withFileTypes:true});
 }catch(e){
  return[];
 }

 const isRoot=/^[a-zA-Z]:\\?$/.test(norm);
 const items=[];

 for(const ent of entries){
  if(ent.isSymbolicLink())continue;
  const full=path.join(norm,ent.name);
  if(ent.isDirectory()){
   const st=activeScan.dirMap.get(full.toLowerCase());
   const size=st?st.size:0;
   const physSize=st?st.physSize:0;
   const files=st?st.files:0;
   const mtime=st?st.mtime:0;
   items.push({
    type:"dir",
    name:ent.name,
    path:full,
    size,
    sizeFmt:fmtBytes(size),
    physSize,
    physSizeFmt:fmtBytes(physSize),
    files,
    filesFmt:files.toLocaleString("it-IT"),
    lastChange:fmtDate(mtime)
   });
  }else if(ent.isFile()){
   let sz=0,ps=0,mt=0;
   try{
    const st=await fsp.lstat(full);
    sz=st.size||0;
    ps=roundCluster(sz);
    mt=st.mtimeMs||0;
   }catch(e){
    if(isRoot&&activeScan.rootFiles.has(ent.name.toLowerCase())){
     const rf=activeScan.rootFiles.get(ent.name.toLowerCase());
     sz=rf.size;ps=rf.physSize;mt=rf.mtime;
    }
   }
   items.push({
    type:"file",
    name:ent.name,
    path:full,
    ext:path.extname(ent.name).toLowerCase()||"",
    size:sz,
    sizeFmt:fmtBytes(sz),
    physSize:ps,
    physSizeFmt:fmtBytes(ps),
    files:1,
    filesFmt:"",
    lastChange:fmtDate(mt)
   });
  }
 }

 items.sort((a,b)=>b.physSize-a.physSize||b.size-a.size);
 const denom=parentStat.physSize||items.reduce((a,x)=>a+x.physSize,0)||1;
 items.forEach(it=>{
  const pct=Math.min(100,Math.max(0,(it.physSize/denom)*100));
  it.pct=+pct.toFixed(1);
  it.pctFmt=pct.toFixed(1).replace(".",",")+"%";
 });
 return items;
}

// Elimina un file o cartella spostandolo nel Cestino di Windows (sicuro, previa conferma esplicita dell'utente)
async function trashFileOrFolder(targetPath){
 if(!targetPath||!fs.existsSync(targetPath))return{ok:false,msg:"Percorso non trovato sul disco."};
 // Protezione cartelle critiche di sistema
 const norm=path.normalize(targetPath);
 if(/^[a-zA-Z]:\\(Windows|Program Files|Program Files \(x86\)|Users|ProgramData)\s*$/i.test(norm)){
  return{ok:false,msg:"Cartella di sistema protetta: impossibile eliminarla."};
 }
 const ps=`
 Add-Type -AssemblyName Microsoft.VisualBasic
 $p = '${norm.replace(/'/g,"''")}'
 try {
   if (Test-Path -LiteralPath $p -PathType Container) {
     [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
   } else {
     [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
   }
   'OK'
 } catch {
   $_.Exception.Message
 }
 `;
 const r=await runPs(ps,25000);
 const out=(r.out||"").trim();
 if(out==="OK")return{ok:true,msg:`Spostato nel Cestino di Windows: ${path.basename(norm)}`};
 return{ok:false,msg:`Impossibile spostare nel Cestino: ${out}`};
}

function isProtectedSystemPath(norm){
 return /^[a-zA-Z]:\\?$/i.test(norm)||/^[a-zA-Z]:\\(Windows|Program Files|Program Files \(x86\)|Users|ProgramData|System Volume Information|\$Recycle\.Bin)\s*$/i.test(norm);
}

// Esegue le azioni del menu contestuale in stile Windows Explorer / WinDirStat
async function executeFileContextAction(action,targetPath){
 if(!targetPath)return{ok:false,msg:"Percorso non specificato."};
 const norm=path.normalize(targetPath);
 const exists=fs.existsSync(norm);
 let isDir=false;
 if(exists){
  try{isDir=fs.statSync(norm).isDirectory()}catch(e){}
 }
 const workDir=isDir?norm:path.dirname(norm);

 if(action==="select_explorer"||action==="explorer_menu"){
  cp.spawn("explorer.exe",[isDir&&/^[a-zA-Z]:\\?$/.test(norm)?norm:`/select,${norm}`],{detached:true,stdio:"ignore"}).unref();
  return{ok:true,msg:"Aperto in Esplora Risorse."};
 }
 if(action==="open_cmd"){
  cp.spawn("cmd.exe",["/c","start","Prompt dei Comandi",`/D`,workDir,"cmd.exe"],{detached:true,stdio:"ignore"}).unref();
  return{ok:true,msg:`Prompt dei comandi aperto in ${workDir}`};
 }
 if(action==="open_ps"){
  cp.spawn("cmd.exe",["/c","start","Windows PowerShell","/D",workDir,"powershell.exe","-NoExit"],{detached:true,stdio:"ignore"}).unref();
  return{ok:true,msg:`PowerShell aperto in ${workDir}`};
 }
 if(action==="properties"){
  const ps=`
  $code = @'
  using System;
  using System.Runtime.InteropServices;
  public class ShellProps {
    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    public static extern bool SHObjectProperties(IntPtr hwnd, uint shopObjectType, string pszObjectName, string pszPropertyPage);
  }
'@
  Add-Type -TypeDefinition $code
  [ShellProps]::SHObjectProperties([IntPtr]::Zero, 2, '${norm.replace(/'/g,"''")}', $null) | Out-Null
  Start-Sleep -Milliseconds 400
  `;
  runPs(ps,5000);
  return{ok:true,msg:"Finestra Proprietà di Windows aperta."};
 }
 if(action==="delete_trash"){
  return await trashFileOrFolder(norm);
 }
 if(action==="delete_perm"){
  if(!exists)return{ok:false,msg:"Elemento non trovato sul disco."};
  if(isProtectedSystemPath(norm))return{ok:false,msg:"Percorso di sistema protetto: eliminazione bloccata per sicurezza."};
  try{
   await fsp.rm(norm,{recursive:true,force:true});
   return{ok:true,deleted:true,msg:`Eliminato definitivamente: ${path.basename(norm)}`};
  }catch(e){
   return{ok:false,msg:`Impossibile eliminare definitivamente: ${e.message}`};
  }
 }
 if(action==="empty_folder"){
  if(!exists||!isDir)return{ok:false,msg:"L'opzione 'Empty Folder' è applicabile solo alle cartelle."};
  if(isProtectedSystemPath(norm))return{ok:false,msg:"Cartella di sistema protetta: impossibile svuotarla."};
  try{
   const items=await fsp.readdir(norm);
   let cnt=0;
   for(const name of items){
    const sub=path.join(norm,name);
    const r=await trashFileOrFolder(sub);
    if(r&&r.ok)cnt++;
   }
   const st=activeScan.dirMap.get(norm.toLowerCase());
   if(st){st.size=0;st.physSize=0;st.files=0;st.folders=0;}
   return{ok:true,emptied:true,msg:`Cartella svuotata (${cnt} elementi spostati nel Cestino).`};
  }catch(e){
   return{ok:false,msg:`Errore durante lo svuotamento: ${e.message}`};
  }
 }
 if(action==="compress"){
  if(!exists)return{ok:false,msg:"Elemento non trovato sul disco."};
  const zipPath=norm.replace(/[\\/]+$/,"")+".zip";
  const ps=`Compress-Archive -LiteralPath '${norm.replace(/'/g,"''")}' -DestinationPath '${zipPath.replace(/'/g,"''")}' -Force -ErrorAction Stop; 'OK'`;
  const r=await runPs(ps,120000);
  if((r.out||"").trim().endsWith("OK"))return{ok:true,msg:`Archivio creato: ${path.basename(zipPath)}`};
  return{ok:false,msg:`Impossibile comprimere in ZIP: ${(r.out||"").trim()||"errore"}`};
 }
 if(action==="custom_cleanup"){
  const targetDir=isDir?norm:path.dirname(norm);
  if(isProtectedSystemPath(targetDir))return{ok:false,msg:"Seleziona una sottocartella specifica per la pulizia mirata."};
  const ps=`
  $d = '${targetDir.replace(/'/g,"''")}'
  $files = Get-ChildItem -LiteralPath $d -Recurse -File -Include *.tmp,*.log,*.bak,*.old,*.dmp -ErrorAction SilentlyContinue
  $cnt = 0; $bytes = 0
  foreach ($f in $files) {
    try { $bytes += $f.Length; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $cnt++ } catch {}
  }
  "Rimossi $cnt file temporanei/log ({0:N1} MB recuperati)" -f ($bytes / 1MB)
  `;
  const r=await runPs(ps,30000);
  return{ok:true,msg:(r.out||"").trim()||"Pulizia completata."};
 }
 return{ok:false,msg:"Azione non riconosciuta."};
}

function cancelDiskScan(){
 if(activeScan.running){
  activeScan.cancel=true;
  return{ok:true};
 }
 return{ok:false};
}

module.exports={
 scanDiskWinDirStat,
 scanDiskDuplicates,
 getDirectoryChildren,
 trashFileOrFolder,
 executeFileContextAction,
 cancelDiskScan,
 getLastDiskScan:()=>activeScan.lastResult
};
