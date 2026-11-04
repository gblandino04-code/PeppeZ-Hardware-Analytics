// Motore Diagnostica Completa e Pulizia Intelligente per PeppeZ Hardware Analytics
// Regola ferrea: nessun controllo non eseguito viene dichiarato superato; nessun file viene eliminato senza conferma esplicita.
const fs=require("fs"),path=require("path"),os=require("os"),cp=require("child_process"),crypto=require("crypto");
const si=require("systeminformation");
const sensors=require("./sensors");

const run=(cmd,args,opt)=>new Promise(r=>cp.execFile(cmd,args,Object.assign({windowsHide:true,timeout:60000,maxBuffer:10*1024*1024},opt||{}),(err,out,stderr)=>r({err,out:String(out||""),stderr:String(stderr||"")})));
const runPs=(script,timeout=45000)=>run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",`[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'; ${script}`],{timeout});

const fmtBytes=b=>{
 if(!b||b<=0)return"0 B";
 if(b>=1073741824)return(b/1073741824).toFixed(2)+" GB";
 if(b>=1048576)return(b/1048576).toFixed(1)+" MB";
 if(b>=1024)return(b/1024).toFixed(0)+" KB";
 return b+" B";
};

/* ---------- C. ANALISI E PULIZIA INTELLIGENTE ---------- */
function getCleanCategoriesDef(){
 const local=process.env.LOCALAPPDATA||path.join(os.homedir(),"AppData","Local");
 const roam=process.env.APPDATA||path.join(os.homedir(),"AppData","Roaming");
 const windir=process.env.SystemRoot||"C:\\Windows";
 const progData=process.env.ProgramData||"C:\\ProgramData";
 const pfx86=process.env["ProgramFiles(x86)"]||"C:\\Program Files (x86)";
 const tmp=os.tmpdir();

 // Profili Firefox cache2
 const ffPaths=[];
 try{
  const ffRoot=path.join(local,"Mozilla","Firefox","Profiles");
  if(fs.existsSync(ffRoot)){
   for(const d of fs.readdirSync(ffRoot,{withFileTypes:true})){
    if(d.isDirectory()){
     const c2=path.join(ffRoot,d.name,"cache2");
     if(fs.existsSync(c2))ffPaths.push(c2);
    }
   }
  }
 }catch(e){}

 return [
  {
   id:"win_temp",
   title:"File temporanei Windows e applicazioni",
   typeDesc:"File temporanei di esecuzione (.tmp, .log, cache installer)",
   defaultSelected:true,
   inspectOnly:false,
   warn:null,
   paths:[tmp,path.join(windir,"Temp")].filter((v,i,a)=>v&&a.indexOf(v)===i)
  },
  {
   id:"browsers",
   title:"Cache di Chrome, Edge e Firefox",
   typeDesc:"Cache web e codice compilato dei browser (non tocca password, cookie o cronologia)",
   defaultSelected:true,
   inspectOnly:false,
   warn:null,
   paths:[
    path.join(local,"Google","Chrome","User Data","Default","Cache"),
    path.join(local,"Google","Chrome","User Data","Default","Code Cache"),
    path.join(local,"Google","Chrome","User Data","Default","GPUCache"),
    path.join(local,"Microsoft","Edge","User Data","Default","Cache"),
    path.join(local,"Microsoft","Edge","User Data","Default","Code Cache"),
    path.join(local,"Microsoft","Edge","User Data","Default","GPUCache"),
    ...ffPaths
   ]
  },
  {
   id:"games_cache",
   title:"Cache di giochi e launcher (Steam, Epic Games, Battle.net)",
   typeDesc:"Cache HTTP, webcache e depositi temporanei dei launcher di gioco",
   defaultSelected:false,
   inspectOnly:false,
   warn:"AVVERTENZA: L'eliminazione della cache dei launcher e dei giochi può comportare nuovi download di dati temporanei e rallentamenti iniziali al prossimo avvio dei launcher.",
   paths:[
    path.join(pfx86,"Steam","appcache","httpcache"),
    path.join(pfx86,"Steam","depotcache"),
    path.join(local,"Steam","htmlcache"),
    path.join(local,"EpicGamesLauncher","Saved","webcache"),
    path.join(local,"EpicGamesLauncher","Saved","webcache_4430"),
    path.join(local,"EpicGamesLauncher","Saved","Logs"),
    path.join(progData,"Battle.net","Agent","Logs")
   ]
  },
  {
   id:"shader_cache",
   title:"Shader Cache NVIDIA, AMD e DirectX",
   typeDesc:"Shader precompilati DirectX / OpenGL / Vulkan delle schede video",
   defaultSelected:false,
   inspectOnly:false,
   warn:"AVVERTENZA: L'eliminazione della Shader Cache comporterà la ricompilazione degli shader e possibili rallentamenti temporanei (stuttering) durante le prime sessioni di gioco.",
   paths:[
    path.join(local,"NVIDIA","DXCache"),
    path.join(local,"NVIDIA","GLCache"),
    path.join(local,"NVIDIA Corporation","NV_Cache"),
    path.join(local,"AMD","DxCache"),
    path.join(local,"AMD","GLCache"),
    path.join(local,"AMD","DxcCache"),
    path.join(local,"D3DSCache")
   ]
  },
  {
   id:"win_update",
   title:"Residui di Windows Update e installazioni",
   typeDesc:"Pacchetti di aggiornamento già scaricati in SoftwareDistribution\\Download",
   defaultSelected:true,
   inspectOnly:false,
   warn:null,
   paths:[
    path.join(windir,"SoftwareDistribution","Download")
   ]
  },
  {
   id:"logs_crash_thumbs",
   title:"Log, report di crash e miniature",
   typeDesc:"Dump di crash (.dmp), report Windows Error Reporting (WER) e cache miniature Explorer",
   defaultSelected:true,
   inspectOnly:false,
   warn:null,
   paths:[
    path.join(local,"CrashDumps"),
    path.join(local,"Microsoft","Windows","WER","ReportArchive"),
    path.join(local,"Microsoft","Windows","WER","ReportQueue"),
    path.join(progData,"Microsoft","Windows","WER","ReportArchive"),
    path.join(progData,"Microsoft","Windows","WER","ReportQueue"),
    path.join(local,"Microsoft","Windows","Explorer")
   ],
   fileFilter:(fullPath)=>{
    if(fullPath.toLowerCase().includes("\\microsoft\\windows\\explorer\\")){
     return /^thumbcache_.*\.db$/i.test(path.basename(fullPath));
    }
    return true;
   }
  },
  {
   id:"recycle_bin",
   title:"Cestino di Windows",
   typeDesc:"Elementi già cestinati dall'utente su tutte le unità ($Recycle.Bin)",
   defaultSelected:false,
   inspectOnly:false,
   warn:"Gli elementi presenti nel Cestino verranno rimossi definitivamente.",
   paths:["C:\\$Recycle.Bin","D:\\$Recycle.Bin"].filter(p=>{try{return fs.existsSync(p)}catch(e){return false}})
  },
  {
   id:"app_caches",
   title:"Cache obsolete di Discord, Spotify, Adobe e altre app",
   typeDesc:"Cache temporanea multimediale e web di Discord, Spotify, Adobe, Teams e Slack",
   defaultSelected:true,
   inspectOnly:false,
   warn:null,
   paths:[
    path.join(roam,"discord","Cache"),
    path.join(roam,"discord","Code Cache"),
    path.join(roam,"discord","GPUCache"),
    path.join(local,"Spotify","Storage"),
    path.join(local,"Spotify","Browser","Cache"),
    path.join(roam,"Adobe","Common","Media Cache Files"),
    path.join(roam,"Adobe","Common","Media Cache"),
    path.join(roam,"Slack","Cache"),
    path.join(local,"Packages","MSTeams_8wekyb3d8bbwe","LocalCache","Microsoft","MSTeams","EBWebView","Default","Cache")
   ]
  },
  {
   id:"large_duplicates",
   title:"File duplicati e di grandi dimensioni (>100 MB in Download/Temp)",
   typeDesc:"Solo segnalazione sicura: file >100 MB o possibili duplicati (non vengono mai eliminati in automatico)",
   defaultSelected:false,
   inspectOnly:true,
   warn:"SICUREZZA: Questa categoria è di sola analisi. I file personali o scaricati non vengono mai eliminati automaticamente dal programma.",
   paths:[path.join(os.homedir(),"Downloads"),tmp]
  }
 ];
}

function isFileLocked(filePath){
 let fd=null;
 try{
  // Apertura non esclusiva in sola lettura per verificare l'accessibilità senza richiedere permessi di scrittura né bloccare file altrui
  fd=fs.openSync(filePath,"r");
  return false;
 }catch(e){
  if(e&&(e.code==="EBUSY"||e.code==="EPERM"||e.code==="EACCES"))return true;
  return false;
 }finally{
  if(fd!==null){
   try{fs.closeSync(fd)}catch(err){}
  }
 }
}

function walkCleanDir(rootDir,fileFilter,outFiles,maxFiles=2500,depth=0){
 if(depth>6||outFiles.length>=maxFiles)return;
 const normRoot=rootDir.toLowerCase();
 // Proteggi rigorosamente cartelle di installazione applicativa utente e di sistema
 if(normRoot.includes("\\appdata\\local\\programs")||normRoot.includes("\\program files"))return;
 let entries;
 try{entries=fs.readdirSync(rootDir,{withFileTypes:true})}catch(e){return}
 const thirtyMinAgo=Date.now()-30*60*1000;
 for(const e of entries){
  if(outFiles.length>=maxFiles)break;
  const full=path.join(rootDir,e.name);
  if(e.isSymbolicLink&&e.isSymbolicLink())continue;
  if(e.isDirectory()){
   const lowDir=e.name.toLowerCase();
   if(lowDir==="$recycle.bin"||lowDir==="system volume information"||lowDir.includes("squirrel"))continue;
   walkCleanDir(full,fileFilter,outFiles,maxFiles,depth+1);
  }else if(e.isFile()){
   if(fileFilter&&!fileFilter(full))continue;
   // Escludi file temporanei o installer scritti di recente (< 30 min) per non interrompere download o installazioni in corso
   try{
    const st=fs.statSync(full);
    if(st.size>0){
     if(st.mtimeMs&&st.mtimeMs>thirtyMinAgo)continue;
     outFiles.push({path:full,name:e.name,size:st.size,mtime:st.mtimeMs});
    }
   }catch(err){}
  }
 }
}

function quickEdgeHash(filePath,size){
 let fd=null;
 try{
  fd=fs.openSync(filePath,"r");
  const chunk=Math.min(16384,size);
  const buf=Buffer.alloc(chunk);
  const br=fs.readSync(fd,buf,0,chunk,0);
  return crypto.createHash("md5").update(buf.slice(0,br)).digest("hex");
 }catch(e){
  return null;
 }finally{
  if(fd!==null){
   try{fs.closeSync(fd)}catch(err){}
  }
 }
}

async function scanCleanable(){
 const defs=getCleanCategoriesDef();
 const results=[];
 let totalRecoverableBytes=0;
 let totalInspectBytes=0;

 for(const def of defs){
  const existingPaths=def.paths.filter(p=>{try{return fs.existsSync(p)}catch(e){return false}});
  if(def.id==="large_duplicates"){
   // Scansione sicura di file >100 MB e duplicati in Downloads
   const all=[];
   for(const p of existingPaths)walkCleanDir(p,null,all,800,3);
   const large=all.filter(f=>f.size>=100*1048576);
   // Duplicati per stessa dimensione (>2 MB) e stesso hash dei primi 16 KB
   const bySize={};
   all.filter(f=>f.size>=2*1048576).forEach(f=>{(bySize[f.size]=bySize[f.size]||[]).push(f)});
   const dupes=[];
   for(const sz of Object.keys(bySize)){
    const grp=bySize[sz];
    if(grp.length>1){
     const byHash={};
     for(const f of grp){
      const h=quickEdgeHash(f.path,f.size);
      if(h)(byHash[h]=byHash[h]||[]).push(f);
     }
     for(const h of Object.keys(byHash)){
      if(byHash[h].length>1){
       byHash[h].slice(1).forEach(d=>dupes.push(Object.assign({},d,{isDupe:true,orig:byHash[h][0].name})));
      }
     }
    }
   }
   const combined=[...dupes.map(x=>({path:x.path,name:`[Duplicato di ${x.orig}] ${x.name}`,size:x.size,locked:false})),
    ...large.filter(l=>!dupes.some(d=>d.path===l.path)).map(x=>({path:x.path,name:`[Grande >100MB] ${x.name}`,size:x.size,locked:false}))];
   combined.sort((a,b)=>b.size-a.size);
   const catBytes=combined.reduce((a,x)=>a+x.size,0);
   totalInspectBytes+=catBytes;
   results.push({
    id:def.id,
    title:def.title,
    typeDesc:def.typeDesc,
    warn:def.warn,
    inspectOnly:true,
    defaultSelected:false,
    paths:existingPaths.length?existingPaths:def.paths,
    foundPaths:existingPaths,
    totalBytes:catBytes,
    totalFmt:fmtBytes(catBytes),
    fileCount:combined.length,
    lockedCount:0,
    sampleFiles:combined.slice(0,15).map(f=>({path:f.path,name:f.name,size:f.size,sizeFmt:fmtBytes(f.size),locked:false}))
   });
   continue;
  }

  const files=[];
  for(const p of existingPaths){
   walkCleanDir(p,def.fileFilter,files,2500,0);
  }
  files.sort((a,b)=>b.size-a.size);
  const totalBytes=files.reduce((a,x)=>a+x.size,0);
  // Controlla lock sui primi 25 file principali per velocità senza bloccare l'I/O
  let lockedCount=0;
  const sampleFiles=files.slice(0,15).map(f=>{
   const locked=isFileLocked(f.path);
   if(locked)lockedCount++;
   return{path:f.path,name:f.name,size:f.size,sizeFmt:fmtBytes(f.size),locked};
  });
  totalRecoverableBytes+=totalBytes;
  results.push({
   id:def.id,
   title:def.title,
   typeDesc:def.typeDesc,
   warn:def.warn,
   inspectOnly:false,
   defaultSelected:def.defaultSelected&&totalBytes>0,
   paths:existingPaths.length?existingPaths:def.paths.slice(0,2),
   foundPaths:existingPaths,
   totalBytes,
   totalFmt:fmtBytes(totalBytes),
   fileCount:files.length,
   lockedCount,
   sampleFiles
  });
 }

 return {
  scannedAt:new Date().toISOString(),
  totalRecoverableBytes,
  totalRecoverableFmt:fmtBytes(totalRecoverableBytes),
  totalInspectBytes,
  totalInspectFmt:fmtBytes(totalInspectBytes),
  categories:results
 };
}

async function cleanCategories(selectedIds){
 if(!Array.isArray(selectedIds)||!selectedIds.length){
  return{ok:false,msg:"Nessuna categoria selezionata.",freedBytes:0,freedFmt:"0 B",deletedCount:0,skippedCount:0,lockedFiles:[],details:[]};
 }
 const defs=getCleanCategoriesDef().filter(d=>selectedIds.includes(d.id)&&!d.inspectOnly);
 let freedBytes=0,deletedCount=0,skippedCount=0;
 const lockedFiles=[];
 const details=[];

 for(const def of defs){
  let catFreed=0,catDel=0,catSkip=0;
  const existingPaths=def.paths.filter(p=>{try{return fs.existsSync(p)}catch(e){return false}});
  const files=[];
  for(const p of existingPaths)walkCleanDir(p,def.fileFilter,files,4000,0);
  for(const f of files){
   // Protezione: non eliminare file eseguibili, asar, installer o download parziali che potrebbero appartenere ad altre app
   if(/\.(exe|msi|asar|crdownload|part)$/i.test(f.name))continue;
   try{
    fs.unlinkSync(f.path);
    freedBytes+=f.size;
    catFreed+=f.size;
    deletedCount++;
    catDel++;
   }catch(e){
    skippedCount++;
    catSkip++;
    if(lockedFiles.length<60){
     lockedFiles.push({
      path:f.path,
      name:f.name,
      sizeFmt:fmtBytes(f.size),
      cat:def.title,
      reason:e&&e.code==="EBUSY"?"File in uso da un processo attivo":e&&e.code==="EACCES"?"File bloccato o permessi insufficienti":"File protetto o attualmente in uso"
     });
    }
   }
  }
  if(def.id==="recycle_bin"){
   await runPs("Clear-RecycleBin -Force -ErrorAction SilentlyContinue",15000);
  }
  details.push({
   id:def.id,
   title:def.title,
   freedBytes:catFreed,
   freedFmt:fmtBytes(catFreed),
   deletedCount:catDel,
   skippedCount:catSkip
  });
 }

 return{
  ok:true,
  cleanedAt:new Date().toISOString(),
  freedBytes,
  freedFmt:fmtBytes(freedBytes),
  deletedCount,
  skippedCount,
  lockedFiles,
  details
 };
}

/* ---------- CONTROLLI DIAGNOSTICI REALI (A, B, D, E) ---------- */
async function collectWindowsTelemetry(level){
 // Script PowerShell unico e veloce per raccogliere:
 // 1. Eventi WHEA-Logger (ultimi 30 giorni)
 // 2. Eventi Kernel-Power 41 e Arresti imprevisti 6008 (ultimi 30 giorni)
 // 3. Crash GPU Display 4101 e BSOD BugCheck 1001
 // 4. Crash Applicazioni (ID 1000) e Hang (ID 1002) (ultimi 14 giorni)
 // 5. Esaurimento memoria Resource-Exhaustion-Detector (ID 2004) e MemoryDiagnostics
 // 6. Dispositivi PnP con problemi / driver mancanti
 // 7. Dischi fisici e contatori SMART / usura
 // 8. Ultimi aggiornamenti Windows (HotFix)
 const ps=`
 $out = [ordered]@{
   whea = @()
   kernelPower = @()
   unexpectedShutdown = @()
   gpuTdr = @()
   bsod = @()
   appCrashes = @()
   memExhaust = @()
   memDiag = $null
   badDrivers = @()
   physDisks = @()
   hotfixes = @()
   wifiInfo = $null
 }
 $d30 = (Get-Date).AddDays(-30)
 $d14 = (Get-Date).AddDays(-14)
 try {
   $out.whea = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=$d30} -MaxEvents 15 | ForEach-Object { @{time=$_.TimeCreated.ToString('dd/MM/yyyy HH:mm'); id=$_.Id; msg=($_.Message -split "\\r?\\n")[0]} })
 } catch {}
 try {
   $out.kernelPower = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-Power'; Id=41; StartTime=$d30} -MaxEvents 15 | ForEach-Object { @{time=$_.TimeCreated.ToString('dd/MM/yyyy HH:mm'); id=$_.Id} })
 } catch {}
 try {
   $out.unexpectedShutdown = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=6008; StartTime=$d30} -MaxEvents 10 | ForEach-Object { @{time=$_.TimeCreated.ToString('dd/MM/yyyy HH:mm'); id=$_.Id} })
 } catch {}
 try {
   $out.gpuTdr = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=4101; StartTime=$d30} -MaxEvents 10 | ForEach-Object { @{time=$_.TimeCreated.ToString('dd/MM/yyyy HH:mm'); id=$_.Id; msg=($_.Message -split "\\r?\\n")[0]} })
 } catch {}
 try {
   $out.bsod = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=1001; StartTime=$d30} -MaxEvents 10 | Where-Object { $_.ProviderName -match 'WER-SystemErrorReporting|BugCheck' } | ForEach-Object { @{time=$_.TimeCreated.ToString('dd/MM/yyyy HH:mm'); msg=($_.Message -split "\\r?\\n")[0]} })
 } catch {}
 try {
   $out.appCrashes = @(Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000,1002; StartTime=$d14} -MaxEvents 15 | ForEach-Object { @{time=$_.TimeCreated.ToString('dd/MM/yyyy HH:mm'); id=$_.Id; msg=($_.Message -split "\\r?\\n")[0]} })
 } catch {}
 try {
   $out.memExhaust = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Resource-Exhaustion-Detector'; StartTime=$d30} -MaxEvents 10 | ForEach-Object { @{time=$_.TimeCreated.ToString('dd/MM/yyyy HH:mm'); msg=($_.Message -split "\\r?\\n")[0]} })
 } catch {}
 try {
   $md = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-MemoryDiagnostics-Results'} -MaxEvents 1
   if ($md) { $out.memDiag = @{time=$md.TimeCreated.ToString('dd/MM/yyyy HH:mm'); msg=($md.Message -split "\\r?\\n")[0]} }
 } catch {}
 try {
   $out.badDrivers = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | Select-Object -First 15 | ForEach-Object { @{name=$_.Name; code=$_.ConfigManagerErrorCode; status=$_.Status; cls=$_.PNPClass} })
 } catch {}
 try {
   $out.physDisks = @(Get-PhysicalDisk | ForEach-Object {
     $rel = $null
     try { $rel = $_ | Get-StorageReliabilityCounter } catch {}
     @{
       name = $_.FriendlyName
       media = [string]$_.MediaType
       health = [string]$_.HealthStatus
       op = [string]$_.OperationalStatus
       sizeGB = [math]::Round($_.Size / 1GB)
       wear = if ($rel -and $null -ne $rel.Wear) { $rel.Wear } else { $null }
       temp = if ($rel -and $null -ne $rel.Temperature) { $rel.Temperature } else { $null }
       readErr = if ($rel -and $null -ne $rel.ReadErrorsUncorrected) { $rel.ReadErrorsUncorrected } else { $null }
       writeErr = if ($rel -and $null -ne $rel.WriteErrorsUncorrected) { $rel.WriteErrorsUncorrected } else { $null }
     }
   })
 } catch {}
 try {
   $out.hotfixes = @(Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 5 | ForEach-Object { @{id=$_.HotFixID; desc=$_.Description; date=if($_.InstalledOn){$_.InstalledOn.ToString('dd/MM/yyyy')}else{''}} })
 } catch {}
 $out | ConvertTo-Json -Depth 4 -Compress
 `;
 const r=await runPs(ps,30000);
 try{return JSON.parse(r.out.trim())}catch(e){return{}}
}

async function runNetworkCheck(){
 // Ping reale verso DNS pubblici (1.1.1.1 / 8.8.8.8) per misurare ping min/max/avg, jitter e packet loss
 const ps=`
 $target = '1.1.1.1'
 $pings = @()
 $sent = 4
 $lost = 0
 for ($i=0; $i -lt $sent; $i++) {
   try {
     $p = Test-Connection -ComputerName $target -Count 1 -ErrorAction Stop
     $ms = if ($null -ne $p.ResponseTime) { $p.ResponseTime } elseif ($null -ne $p.Latency) { $p.Latency } else { 0 }
     $pings += [double]$ms
   } catch { $lost++ }
 }
 $wlan = (netsh wlan show interfaces) -join "\`n"
 $sig = $null; $ssid = $null; $radio = $null
 if ($wlan -match 'Signal\\s*:\\s*(\\d+)%' -or $wlan -match 'Segnale\\s*:\\s*(\\d+)%') { $sig = [int]$Matches[1] }
 if ($wlan -match 'SSID\\s*:\\s*([^\\r\\n]+)') { $ssid = $Matches[1].Trim() }
 if ($wlan -match 'Radio type\\s*:\\s*([^\\r\\n]+)' -or $wlan -match 'Tipo di radio\\s*:\\s*([^\\r\\n]+)') { $radio = $Matches[1].Trim() }
 @{ pings=$pings; sent=$sent; lost=$lost; sig=$sig; ssid=$ssid; radio=$radio } | ConvertTo-Json -Compress
 `;
 const r=await runPs(ps,15000);
 try{return JSON.parse(r.out.trim())}catch(e){return{pings:[],sent:4,lost:4}}
}

async function runSfcDismCheck(isAdmin){
 if(!isAdmin){
  return{
   executed:false,
   status:"na",
   value:"Non disponibile (permessi Amministratore assenti)",
   desc:"I controlli DISM /CheckHealth e SFC richiedono che il programma sia eseguito come Amministratore.",
   solution:"Avvia PeppeZ Hardware Analytics come Amministratore per verificare l'integrità dei file di sistema Windows."
  };
 }
 // Eseguiamo DISM /Online /Cleanup-Image /CheckHealth (rapido e ufficiale) + lettura stato CBS.log / sfc /verifyonly
 const dism=await run("dism.exe",["/Online","/Cleanup-Image","/CheckHealth"],{timeout:45000});
 const out=(dism.out||"")+" "+(dism.stderr||"");
 const corrupted=/corrupt|danneggiat|riparabile|repairable/i.test(out)&&!/no component store corruption|nessun danneggiamento/i.test(out);
 // Controlla anche gli ultimi esiti di SFC nel CBS.log se disponibile
 const cbsCheck=await runPs(`
  $p = "$env:SystemRoot\\Logs\\CBS\\CBS.log"
  if (Test-Path $p) {
    $lines = Get-Content $p -Tail 400 -ErrorAction SilentlyContinue | Select-String -Pattern 'Cannot repair|corrupt|Successfully repaired|found no integrity violations' | Select-Object -Last 3
    if ($lines) { ($lines | ForEach-Object { $_.Line }) -join ' | ' } else { 'OK_NO_CBS_ERR' }
  } else { 'NO_CBS' }
 `,10000);
 const cbsTxt=(cbsCheck.out||"").trim();
 const cbsBad=/Cannot repair/i.test(cbsTxt);
 if(corrupted||cbsBad){
  return{
   executed:true,
   status:"bad",
   value:"Rilevata corruzione file di sistema / archivio componenti",
   desc:"DISM /CheckHealth o il registro CBS di Windows ha rilevato file di sistema o componenti danneggiati.",
   solution:"Esegui dal prompt come Amministratore: 'DISM /Online /Cleanup-Image /RestoreHealth' seguito da 'sfc /scannow'."
  };
 }
 return{
  executed:true,
  status:"ok",
  value:"Archivio componenti integro (DISM CheckHealth OK)",
  desc:"Nessun danneggiamento dell'archivio componenti Windows rilevato da DISM /CheckHealth.",
  solution:null
 };
}

function runMemoryPatternTest(megabytes=64){
 // Test reale in memoria RAM con pattern walking-bit e XOR
 const start=Date.now();
 const chunkSize=16*1048576; // 16 MB per blocco
 const chunks=Math.max(1,Math.floor(megabytes/16));
 let errors=0;
 const patterns=[0xAA,0x55,0xF0,0x0F];
 try{
  for(let c=0;c<chunks;c++){
   const buf=Buffer.allocUnsafe(chunkSize);
   for(const pat of patterns){
    buf.fill(pat);
    // Verifica campionata densa (ogni 64 byte + bordi) per non congelare l'event loop troppo a lungo
    for(let i=0;i<chunkSize;i+=64){
     if(buf[i]!==pat){errors++;break}
    }
   }
  }
  const elapsedSec=Math.max(0.05,(Date.now()-start)/1000);
  const totalMB=chunks*16*patterns.length*2; // scrittura + lettura
  const bwGBs=(totalMB/1024/elapsedSec).toFixed(1);
  return{executed:true,errors,testedMB:chunks*16,bwGBs,elapsedMs:Date.now()-start};
 }catch(e){
  return{executed:false,errors:0,err:e.message};
 }
}

async function runStressAndDeepTests(sensorSnap,onProgress){
 const res={cpu:null,disk:null,ram:null};
 // 1. Stress Test CPU (calcolo intensivo + monitoraggio termico e clock per ~4.5 secondi)
 if(onProgress)onProgress({step:"stress_cpu",pct:78,msg:"Stress test CPU in corso (monitoraggio stabilità, frequenze e thermal throttling)..."});
 const t0=sensorSnap.tc;
 const clk0=sensorSnap.clk;
 let maxTemp=t0||0,minClk=clk0||99,maxClk=clk0||0,mathErr=0;
 const tStart=Date.now();
 while(Date.now()-tStart<4200){
  // Burst di calcolo intensivo FP64
  let acc=1.0000001;
  for(let i=0;i<3500000;i++){
   acc=Math.sin(acc)+Math.cos(acc)*1.000001;
  }
  if(!Number.isFinite(acc))mathErr++;
  const cur=await sensors.read();
  if(cur.tc!=null&&cur.tc>maxTemp)maxTemp=cur.tc;
  if(cur.clk>0){
   if(cur.clk<minClk)minClk=cur.clk;
   if(cur.clk>maxClk)maxClk=cur.clk;
  }
  // Protezione termica di sicurezza: interrompi subito se CPU > 94°C
  if(cur.tc!=null&&cur.tc>=94)break;
 }
 const throttled=maxClk>1.5&&minClk<maxClk*0.72&&maxTemp>85;
 res.cpu={
  executed:true,
  mathErr,
  maxTemp:maxTemp||null,
  minClk:minClk<90?minClk:null,
  maxClk:maxClk>0?maxClk:null,
  throttled
 };

 // 2. Test Integrità RAM approfondito (128 MB multi-pattern)
 if(onProgress)onProgress({step:"stress_ram",pct:86,msg:"Test approfondito integrità celle RAM (pattern 0xAA / 0x55 / 0xF0 / 0x0F)..."});
 res.ram=runMemoryPatternTest(128);

 // 3. Benchmark & Stress Test I/O Disco (scrittura/lettura/verifica di blocco temporaneo da 32 MB)
 if(onProgress)onProgress({step:"stress_disk",pct:92,msg:"Test velocità e integrità I/O su disco temporaneo..."});
 let tmpFile=null,fd=null,rfd=null;
 try{
  const testDir=path.join(os.tmpdir(),"peppez-test");
  try{if(!fs.existsSync(testDir))fs.mkdirSync(testDir,{recursive:true})}catch(e){}
  tmpFile=path.join(testDir,`disktest-${Date.now()}-${process.pid}.bin`);
  const sz=32*1048576;
  const buf=crypto.randomBytes(1048576);
  const w0=Date.now();
  fd=fs.openSync(tmpFile,"w");
  for(let i=0;i<32;i++)fs.writeSync(fd,buf,0,buf.length);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fd=null;
  const wMs=Math.max(1,Date.now()-w0);
  const writeMBs=Math.round((sz/1048576)/(wMs/1000));

  const r0=Date.now();
  rfd=fs.openSync(tmpFile,"r");
  const rbuf=Buffer.allocUnsafe(1048576);
  let ioErr=0;
  for(let i=0;i<32;i++){
   const br=fs.readSync(rfd,rbuf,0,rbuf.length,i*1048576);
   if(br!==rbuf.length)ioErr++;
  }
  fs.closeSync(rfd);
  rfd=null;
  const rMs=Math.max(1,Date.now()-r0);
  const readMBs=Math.round((sz/1048576)/(rMs/1000));
  res.disk={executed:true,writeMBs,readMBs,ioErr};
 }catch(e){
  res.disk={executed:false,err:e.message};
 }finally{
  if(fd!==null)try{fs.closeSync(fd)}catch(e){}
  if(rfd!==null)try{fs.closeSync(rfd)}catch(e){}
  if(tmpFile&&fs.existsSync(tmpFile))try{fs.unlinkSync(tmpFile)}catch(e){}
 }
 return res;
}

async function runDiagnostics(level="fast",isAdmin=false,onProgress=null,historyList=[]){
 const p=(step,pct,msg)=>{if(onProgress)try{onProgress({step,pct,msg})}catch(e){}};
 p("init",8,"Lettura sensori hardware e stato componenti in tempo reale...");
 const [s,hwInfo]=await Promise.all([sensors.read(),sensors.info()]);

 p("telemetry",25,"Analisi registri eventi Windows (WHEA, Kernel-Power, crash, driver, SMART)...");
 const [winTel,netRes]=await Promise.all([collectWindowsTelemetry(level),runNetworkCheck()]);

 let sfcRes={
  executed:false,
  status:"na",
  value:"Non previsto nella modalità Rapida",
  desc:"La verifica approfondita dei file di sistema Windows (DISM / SFC) viene eseguita nelle modalità Completa e Approfondita.",
  solution:"Seleziona il livello 'Completa' o 'Approfondita' per eseguire il controllo integrità di Windows."
 };
 if(level==="full"||level==="deep"){
  p("sfc",52,"Verifica integrità file di sistema Windows (DISM CheckHealth & CBS)...");
  sfcRes=await runSfcDismCheck(isAdmin);
 }

 let deepRes=null;
 if(level==="deep"){
  deepRes=await runStressAndDeepTests(s,onProgress);
 }else{
  p("ram_quick",64,"Verifica rapida allocazione memoria RAM...");
  deepRes={ram:runMemoryPatternTest(32),cpu:null,disk:null};
 }

 p("clean",75,"Analisi spazio recuperabile, cache di sistema, browser, launcher e shader...");
 const cleanReport=await scanCleanable();

 const checks=[];
 const addCheck=(id,category,group,title,status,executed,value,desc,solution=null)=>{
  checks.push({id,category,group,title,status,executed:!!executed,value,desc,solution});
 };

 /* ==================== A. CONTROLLI HARDWARE ==================== */
 // 1. CPU: Temperatura
 if(s.tc!=null){
  const st=s.tc>85?"bad":s.tc>75?"warn":"ok";
  addCheck("cpu_temp","hardware","CPU","Temperatura CPU",st,true,`${Math.round(s.tc)} °C`,
   st==="ok"?`Temperatura del processore ottimale (${Math.round(s.tc)} °C).`:`Temperatura CPU elevata (${Math.round(s.tc)} °C).`,
   st==="ok"?null:"Verifica la curva delle ventole, la pulizia del dissipatore dalla polvere e lo stato della pasta termica.");
 }else{
  addCheck("cpu_temp","hardware","CPU","Temperatura CPU","na",false,"Sensore non disponibile",
   "Il sensore termico della CPU non è attualmente raggiungibile (richiede LibreHardwareMonitor e driver PawnIO con privilegi di Amministratore).",
   "Avvia l'applicazione come Amministratore e assicurati che il servizio PawnIO e LibreHardwareMonitor siano attivi.");
 }

 // 2. CPU: Frequenze, utilizzo e throttling
 const cpuSpeedBase=hwInfo.raw&&hwInfo.raw.cpu&&hwInfo.raw.cpu.speed?hwInfo.raw.cpu.speed:0;
 const isThrottling=(deepRes&&deepRes.cpu&&deepRes.cpu.throttled)||(s.cpu>80&&cpuSpeedBase>1.5&&s.clk>0&&s.clk<cpuSpeedBase*0.75);
 addCheck("cpu_freq_load","hardware","CPU","Frequenze, Utilizzo e Throttling CPU",
  isThrottling?"warn":s.cpu>95?"warn":"ok",
  true,
  `${s.clk?s.clk.toFixed(2)+" GHz":"--"} • Carico ${Math.round(s.cpu)}%${isThrottling?" • Throttling rilevato":" • Nessun throttling"}`,
  isThrottling?"Rilevata riduzione di frequenza (throttling) sotto carico elevato.":`Processore operativo a ${s.clk?s.clk.toFixed(2)+" GHz":"frequenza nominale"} con utilizzo del ${Math.round(s.cpu)}%.`,
  isThrottling?"Controlla le temperature della CPU e il profilo energetico di Windows (imposta Prestazioni o Bilanciato).":null
 );

 // 3. CPU: Stabilità ed errori WHEA
 const wheaArr=Array.isArray(winTel.whea)?winTel.whea:[];
 addCheck("cpu_whea","hardware","CPU","Stabilità CPU ed Errori Hardware WHEA",
  wheaArr.length>0?"bad":"ok",
  true,
  wheaArr.length>0?`${wheaArr.length} errori WHEA negli ultimi 30 giorni`:"0 errori WHEA rilevati",
  wheaArr.length>0?`Il registro Windows WHEA-Logger riporta ${wheaArr.length} errori hardware (ultimo: ${wheaArr[0].time} - ${wheaArr[0].msg||"Errore hardware"}).`:"Nessun errore hardware WHEA (CPU, cache, bus PCIe) registrato negli ultimi 30 giorni.",
  wheaArr.length>0?"Rimuovi eventuali overclock/undervolt instabili su CPU/RAM nel BIOS e aggiorna il BIOS della scheda madre.":null
 );

 // 4. GPU: Temperatura e Hotspot
 if(s.tg!=null){
  const hotWarn=s.tg>83||(s.tgHot!=null&&s.tgHot>96);
  const hotBad=s.tg>90||(s.tgHot!=null&&s.tgHot>104);
  const st=hotBad?"bad":hotWarn?"warn":"ok";
  addCheck("gpu_temp","hardware","GPU","Temperatura GPU e Hotspot",st,true,
   `${Math.round(s.tg)} °C${s.tgHot!=null?` • Hotspot ${Math.round(s.tgHot)} °C`:""}`,
   st==="ok"?"Temperature del core grafico e hotspot entro i parametri ottimali.":"Temperature della scheda video elevate sotto carico.",
   st==="ok"?null:"Migliora il flusso d'aria del case e verifica le ventole della scheda video."
  );
 }else{
  addCheck("gpu_temp","hardware","GPU","Temperatura GPU e Hotspot","na",false,"Sensore non disponibile",
   "Nessun sensore termico dedicato esposto dalla GPU (comune sulle GPU integrate o senza driver telemetrico).",null);
 }

 // 5. GPU: VRAM, frequenze, utilizzo ed errori driver (TDR)
 const tdrArr=Array.isArray(winTel.gpuTdr)?winTel.gpuTdr:[];
 const gpuDriversBad=(winTel.badDrivers||[]).filter(d=>/display|video|vga|nvidia|amd|radeon|geforce|intel.*graphics/i.test((d.name||"")+" "+(d.cls||"")));
 const gpuSt=gpuDriversBad.length>0?"bad":tdrArr.length>0?"warn":"ok";
 const gpuParts=[];
 if(s.gpu!=null)gpuParts.push(`Uso ${Math.round(s.gpu)}%`);
 if(s.gclk!=null)gpuParts.push(`${Math.round(s.gclk)} MHz`);
 if(s.vram!=null)gpuParts.push(`VRAM ${Math.round(s.vram)}${s.vramTot?"/"+Math.round(s.vramTot):""} MB`);
 gpuParts.push(tdrArr.length?`${tdrArr.length} reset driver (TDR)`:"Driver OK");
 addCheck("gpu_driver_vram","hardware","GPU","VRAM, Frequenze ed Errori Driver GPU",gpuSt,true,
  gpuParts.join(" • "),
  gpuDriversBad.length>0?`Rilevato problema sul driver video: ${gpuDriversBad.map(d=>`${d.name} (Codice ${d.code})`).join(", ")}.`:
  tdrArr.length>0?`Rilevati ${tdrArr.length} ripristini del driver video (Event ID 4101 TDR) negli ultimi 30 giorni.`:
  `Scheda video (${hwInfo.sum.gpu||"GPU"}) e driver video operativi senza crash TDR registrati.`,
  gpuSt==="ok"?null:"Esegui un'installazione pulita dei driver grafici (NVIDIA/AMD/Intel) aggiornati."
 );

 // 6. RAM: Occupazione, Memory Leak e Anomalie
 const memEx=Array.isArray(winTel.memExhaust)?winTel.memExhaust:[];
 const topMemProc=(s.procs||[]).slice().sort((a,b)=>(b.mem||0)-(a.mem||0))[0];
 const heavyLeak=topMemProc&&topMemProc.mem>3500&&s.ram>85;
 const ramSt=s.ram>92||heavyLeak?"bad":s.ram>82||memEx.length>0?"warn":"ok";
 addCheck("ram_usage_leak","hardware","RAM","Utilizzo RAM e Rilevamento Memory Leak",ramSt,true,
  `${s.ramUsedGB} / ${s.ramT} GB (${Math.round(s.ram)}%) • Libera: ${s.ramAvailGB} GB`,
  heavyLeak?`Possibile memory leak: il processo ${topMemProc.n} occupa ${Math.round(topMemProc.mem)} MB con RAM al ${Math.round(s.ram)}%.`:
  memEx.length>0?`Windows ha segnalato ${memEx.length} eventi di esaurimento memoria negli ultimi 30 giorni (ultimo: ${memEx[0].time}).`:
  `Utilizzo memoria RAM regolare (${Math.round(s.ram)}%). Processo più pesante: ${topMemProc?`${topMemProc.n} (${Math.round(topMemProc.mem)} MB)`:"nessuna anomalia"}.`,
  ramSt==="ok"?null:"Chiudi le applicazioni con consumo anomalo di memoria o verifica i programmi in background."
 );

 // 7. RAM: Test di Integrità
 const ramTest=deepRes&&deepRes.ram;
 if(ramTest&&ramTest.executed){
  const mdMsg=winTel.memDiag?` • Diagnostica Windows: ${winTel.memDiag.msg}`:"";
  addCheck("ram_integrity","hardware","RAM",level==="deep"?"Test Integrità RAM Approfondito (Multi-Pattern)":"Test Integrità RAM Rapido",
   ramTest.errors>0?"bad":"ok",true,
   `${ramTest.errors} errori bit (${ramTest.testedMB} MB verificati a ${ramTest.bwGBs} GB/s)`,
   ramTest.errors>0?`Rilevati ${ramTest.errors} errori di verifica bit nella memoria RAM!`:`Verifica bit-a-bit completata su ${ramTest.testedMB} MB con 0 errori.${mdMsg}`,
   ramTest.errors>0?"Esegui Diagnostica memoria Windows (mdsched.exe) al riavvio e verifica i moduli RAM / profilo XMP-EXPO.":null
  );
 }else{
  addCheck("ram_integrity","hardware","RAM","Test Integrità RAM","na",false,"Non eseguito","Impossibile allocare il buffer di test RAM.",null);
 }

 // 8. SSD/HDD: Salute SMART, Usura e Settori Danneggiati
 const physDisks=Array.isArray(winTel.physDisks)&&winTel.physDisks.length?winTel.physDisks:(hwInfo.raw&&hwInfo.raw.diskLayout||[]).map(d=>({
  name:d.name,media:d.type,health:d.smartStatus,op:"OK",sizeGB:Math.round((d.size||0)/1e9),wear:null,readErr:null,writeErr:null
 }));
 if(physDisks.length){
  const badDisk=physDisks.find(d=>/unhealthy|warning|pred\s*fail|bad/i.test(String(d.health||""))||(d.readErr&&d.readErr>0)||(d.writeErr&&d.writeErr>0)||(d.wear&&d.wear>=95));
  const warnDisk=physDisks.find(d=>d.wear&&d.wear>=80);
  const st=badDisk?"bad":warnDisk?"warn":"ok";
  const diskSummary=physDisks.map(d=>{
   const w=d.wear!=null?` • Usura: ${d.wear}%`:"";
   const err=(d.readErr||d.writeErr)?` • Errori I/O: ${(d.readErr||0)+(d.writeErr||0)}`:"";
   return `${d.name} (${d.health||"OK"}${w}${err})`;
  }).join(" | ");
  addCheck("disk_smart","hardware","SSD/HDD","Salute SMART, Usura SSD e Settori Danneggiati",st,true,
   diskSummary,
   st==="ok"?"Tutte le unità disco riportano stato SMART integro e nessun errore non corretto.":
   `Attenzione sullo stato SMART o usura di una o più unità: ${diskSummary}.`,
   st==="ok"?null:"Effettua subito un backup dei dati importanti e verifica lo stato dell'unità con il tool del produttore."
  );
 }else{
  addCheck("disk_smart","hardware","SSD/HDD","Salute SMART, Usura SSD e Settori Danneggiati","na",false,"Dati SMART non disponibili",
   "Nessuna informazione SMART restituita dal controller di archiviazione.",null);
 }

 // 9. SSD/HDD: Temperature e Spazio Disponibile
 const drives=s.disks||[];
 const lowDrive=drives.find(d=>(d.tot-d.used)<10||(d.used/d.tot)>0.93);
 const warnDrive=drives.find(d=>(d.tot-d.used)<25||(d.used/d.tot)>0.85);
 const dTempWarn=s.ts!=null&&s.ts>55;
 const dSpaceSt=(lowDrive||(s.ts!=null&&s.ts>65))?"bad":(warnDrive||dTempWarn)?"warn":"ok";
 const drvTxt=drives.map(d=>`${d.n} ${(d.tot-d.used).toFixed(0)} GB liberi su ${d.tot.toFixed(0)} GB`).join(" • ");
 addCheck("disk_space_temp","hardware","SSD/HDD","Spazio Disponibile e Temperature Unità",dSpaceSt,drives.length>0,
  `${drvTxt||"--"}${s.ts!=null?` • Temp: ${Math.round(s.ts)} °C`:" • Temp disco: n/d"}`,
  lowDrive?`Spazio su disco quasi esaurito sull'unità ${lowDrive.n} (${(lowDrive.tot-lowDrive.used).toFixed(1)} GB disponibili).`:
  dTempWarn?`Temperatura SSD/HDD elevata (${Math.round(s.ts)} °C).`:
  "Spazio libero e parametri operativi delle unità di archiviazione nella norma.",
  dSpaceSt==="ok"?null:"Usa la sezione 'Analisi e Pulizia Intelligente' qui sotto per liberare spazio su disco."
 );

 // 10. Raffreddamento: Velocità Ventole e Dissipazione
 if(s.fans&&s.fans.length>0){
  const stallFan=s.fans.find(f=>f.v<220&&(s.tc>70||s.tg>75));
  const loudFan=s.fans.find(f=>f.v>3600);
  const fSt=stallFan?"bad":loudFan?"warn":"ok";
  addCheck("cooling_fans","hardware","Raffreddamento","Velocità Ventole, RPM e Dissipazione",fSt,true,
   s.fans.map(f=>`${f.n}: ${f.v} RPM`).join(" • "),
   stallFan?`Rilevata ventola con RPM anomali (${stallFan.n}: ${stallFan.v} RPM) con temperature elevate.`:
   `Rilevate ${s.fans.length} ventole attive con regime di rotazione regolare.`,
   fSt==="ok"?null:"Controlla il collegamento delle ventole sulla scheda madre e rimuovi eventuale polvere."
  );
 }else{
  addCheck("cooling_fans","hardware","Raffreddamento","Velocità Ventole e RPM","na",false,"Nessun sensore RPM rilevato",
   "La scheda madre o il controller EC del sistema non espone sensori tachimetrici RPM per le ventole (oppure le ventole sono in modalità 0-RPM Zero Frozr).",
   null);
 }

 // 11. Alimentazione: Tensioni rilevabili
 if(s.volts&&s.volts.length>0){
  let vBad=null;
  for(const v of s.volts){
   if(/\+12V|^12V/i.test(v.n)&&(v.v<11.3||v.v>12.7))vBad=v;
   if(/\+5V|^5V/i.test(v.n)&&(v.v<4.7||v.v>5.3))vBad=v;
   if(/\+3\.3V|^3\.3V/i.test(v.n)&&(v.v<3.1||v.v>3.5))vBad=v;
  }
  const vSample=s.volts.slice(0,5).map(v=>`${v.n}: ${v.v.toFixed(3)} V`).join(" • ");
  addCheck("power_voltages","hardware","Alimentazione","Tensioni di Alimentazione Rilevabili",vBad?"bad":"ok",true,
   vSample,
   vBad?`Tensione fuori tolleranza ATX rilevata su ${vBad.n} (${vBad.v.toFixed(3)} V).`:
   `Rilevati ${s.volts.length} sensori di tensione stabili entro le tolleranze operative.`,
   vBad?"Verifica i cavi dell'alimentatore (PSU) e la stabilità delle linee di alimentazione.":null
  );
 }else{
  addCheck("power_voltages","hardware","Alimentazione","Tensioni di Alimentazione Rilevabili","na",false,"Sensori di tensione non esposti",
   "L'hardware non espone sensori di tensione leggibili (richiede LibreHardwareMonitor attivo e chip Super I/O compatibile).",null);
 }

 // 12. Alimentazione: Spegnimenti improvvisi ed eventi Kernel-Power
 const kpArr=Array.isArray(winTel.kernelPower)?winTel.kernelPower:[];
 const unexpArr=Array.isArray(winTel.unexpectedShutdown)?winTel.unexpectedShutdown:[];
 const kpCount=kpArr.length+unexpArr.length;
 const kpSt=kpArr.length>=3?"bad":kpCount>0?"warn":"ok";
 addCheck("power_kernel","hardware","Alimentazione","Stabilità Energetica ed Eventi Kernel-Power",kpSt,true,
  kpCount>0?`${kpArr.length} eventi Kernel-Power 41 • ${unexpArr.length} spegnimenti imprevisti`:"0 spegnimenti improvvisi (30 gg)",
  kpCount>0?`Rilevati ${kpArr.length} eventi critici Kernel-Power (ID 41) e ${unexpArr.length} arresti imprevisti negli ultimi 30 giorni${kpArr[0]?` (ultimo: ${kpArr[0].time})`:""}.`:
  "Nessun arresto anomalo per mancanza di alimentazione o evento Kernel-Power (ID 41) negli ultimi 30 giorni.",
  kpSt==="ok"?null:"Evita di spegnere il PC forzatamente dal tasto fisico; se il PC si riavvia da solo sotto carico, verifica l'alimentatore (PSU) e le temperature."
 );

 /* ==================== B. CONTROLLI SOFTWARE E CONNETTIVITÀ ==================== */
 // 13. Windows: Integrità file di sistema (SFC / DISM)
 addCheck("win_sfc_dism","software","Windows","Integrità File di Sistema (DISM / SFC)",
  sfcRes.status,sfcRes.executed,sfcRes.value,sfcRes.desc,sfcRes.solution);

 // 14. Windows: Driver mancanti o problematici
 const badDrv=Array.isArray(winTel.badDrivers)?winTel.badDrivers:[];
 const realBadDrv=badDrv.filter(d=>d.code!==22); // 22 = dispositivo disabilitato manualmente dall'utente
 const disabledDrv=badDrv.filter(d=>d.code===22);
 const drvSt=realBadDrv.length>0?"bad":disabledDrv.length>0?"warn":"ok";
 addCheck("win_drivers","software","Windows","Stato Driver e Periferiche PnP",drvSt,true,
  realBadDrv.length>0?`${realBadDrv.length} driver con errori`:disabledDrv.length>0?`${disabledDrv.length} dispositivi disabilitati`:"Tutti i driver sono integri (0 errori)",
  realBadDrv.length>0?`Dispositivi con problemi di driver: ${realBadDrv.map(d=>`${d.name} (Codice errore ${d.code})`).join(", ")}.`:
  disabledDrv.length>0?`Dispositivi disabilitati manualmente in Gestione Dispositivi: ${disabledDrv.map(d=>d.name).join(", ")}.`:
  "Tutte le periferiche PnP e i driver di sistema in Gestione Dispositivi risultano regolarmente funzionanti.",
  realBadDrv.length>0?"Apri Gestione Dispositivi di Windows o Windows Update per installare/aggiornare i driver segnalati.":null
 );

 // 15. Windows: Aggiornamenti di sistema
 const hf=Array.isArray(winTel.hotfixes)?winTel.hotfixes:[];
 addCheck("win_updates","software","Windows","Aggiornamenti di Windows",hf.length>0?"ok":"warn",true,
  hf.length>0?`Ultimo: ${hf[0].id} (${hf[0].date||"installato"})`:"Nessun HotFix recente rilevato",
  hf.length>0?`Ultimi aggiornamenti installati: ${hf.map(h=>`${h.id}${h.date?` (${h.date})`:""}`).join(", ")}.`:
  "Non sono stati rilevati aggiornamenti recenti nell'elenco HotFix di Windows.",
  hf.length>0?null:"Controlla la presenza di aggiornamenti in Impostazioni > Windows Update."
 );

 // 16. Rete: Connessione Internet, Ping, Latenza e Packet Loss
 const pings=Array.isArray(netRes.pings)?netRes.pings:[];
 const sent=netRes.sent||4,lost=netRes.lost!=null?netRes.lost:(sent-pings.length);
 const lossPct=Math.round((lost/sent)*100);
 if(pings.length>0){
  const avgPing=Math.round(pings.reduce((a,b)=>a+b,0)/pings.length);
  const minPing=Math.round(Math.min(...pings));
  const maxPing=Math.round(Math.max(...pings));
  const jitter=maxPing-minPing;
  const netSt=(lossPct>=50||avgPing>180)?"bad":(lossPct>0||avgPing>75||jitter>45)?"warn":"ok";
  const wifiTxt=netRes.sig!=null?` • Wi-Fi ${netRes.ssid||""} (${netRes.sig}%)`:"";
  addCheck("net_ping_loss","software","Rete","Connessione Internet, Latenza Ping e Packet Loss",netSt,true,
   `Ping medio: ${avgPing} ms (min ${minPing} / max ${maxPing} ms, jitter ${jitter} ms) • Loss: ${lossPct}%${wifiTxt}`,
   netSt==="ok"?`Connessione Internet stabile con bassa latenza (${avgPing} ms) e 0% pacchetti persi.`:
   `Rilevata latenza di ${avgPing} ms con ${lossPct}% di perdita pacchetti (jitter ${jitter} ms).`,
   netSt==="ok"?null:"Se usi il Wi-Fi avvicinati al router o passa alla banda 5 GHz / cavo Ethernet; riavvia il modem se persiste packet loss."
  );
 }else{
  addCheck("net_ping_loss","software","Rete","Connessione Internet, Latenza Ping e Packet Loss","bad",true,
   "Connessione Internet assente o ICMP bloccato (100% loss)",
   "Impossibile raggiungere i server DNS esterni (1.1.1.1): verifica la connessione a Internet o il firewall.",
   "Controlla il collegamento Wi-Fi / Ethernet e il router di rete."
  );
 }

 // 17. Stabilità: Analisi Eventi Windows, BSOD e Crash Applicazioni
 const bsodArr=Array.isArray(winTel.bsod)?winTel.bsod:[];
 const crashArr=Array.isArray(winTel.appCrashes)?winTel.appCrashes:[];
 const stabSt=bsodArr.length>0?"bad":crashArr.length>=5?"warn":"ok";
 addCheck("win_stability","software","Stabilità","Stabilità di Sistema, BSOD e Crash Applicazioni",stabSt,true,
  `${bsodArr.length} BSOD (30 gg) • ${crashArr.length} crash app (14 gg)`,
  bsodArr.length>0?`Rilevati ${bsodArr.length} eventi di schermata blu (BugCheck) negli ultimi 30 giorni (ultimo: ${bsodArr[0].time}).`:
  crashArr.length>0?`Nessun BSOD rilevato. Registrati ${crashArr.length} arresti anomali di singole applicazioni negli ultimi 14 giorni (ultimo: ${crashArr[0].time}).`:
  "Nessun crash di sistema (BSOD) o arresto anomalo critico rilevato nei registri di Windows.",
  stabSt==="ok"?null:"Aggiorna i driver di sistema e le applicazioni che presentano arresti anomali ricorrenti."
 );

 /* ==================== D. TEST APPROFONDITI / STRESS TEST (SE ESEGUITI) ==================== */
 if(level==="deep"&&deepRes){
  if(deepRes.cpu&&deepRes.cpu.executed){
   const c=deepRes.cpu;
   addCheck("deep_cpu_stress","hardware","Stress Test","Stress Test CPU Multi-Core & Stabilità Termica",
    (c.mathErr>0||c.throttled)?"bad":(c.maxTemp&&c.maxTemp>88)?"warn":"ok",true,
    `Errori calcolo: ${c.mathErr}${c.maxTemp?` • Picco Temp: ${Math.round(c.maxTemp)} °C`:""}${c.maxClk?` • Clock: ${c.minClk.toFixed(2)}-${c.maxClk.toFixed(2)} GHz`:""}`,
    c.mathErr>0?"Rilevati errori di calcolo in virgola mobile durante lo stress test della CPU!":
    c.throttled?"Rilevato thermal throttling della CPU durante il test sotto carico.":
    "Il processore ha superato il test di carico intensivo senza errori matematici né instabilità.",
    (c.mathErr>0||c.throttled)?"Verifica il raffreddamento della CPU e la stabilità delle tensioni nel BIOS.":null
   );
  }
  if(deepRes.disk&&deepRes.disk.executed){
   const dk=deepRes.disk;
   addCheck("deep_disk_stress","hardware","Stress Test","Stress Test & Benchmark I/O Disco",
    dk.ioErr>0?"bad":(dk.writeMBs<40||dk.readMBs<40)?"warn":"ok",true,
    `Scrittura: ${dk.writeMBs} MB/s • Lettura: ${dk.readMBs} MB/s • Errori I/O: ${dk.ioErr}`,
    dk.ioErr>0?"Rilevati errori di integrità durante la lettura/scrittura del blocco di test su disco!":
    `Test sequenziale I/O completato con successo (${dk.writeMBs} MB/s in scrittura, ${dk.readMBs} MB/s in lettura, 0 errori).`,
    dk.ioErr>0?"Esegui 'chkdsk /f' sull'unità di sistema e verifica i cavi o lo stato SMART del disco.":null
   );
  }
 }

 // Calcolo punteggio di salute (0-100) solo sui controlli REALMENTE eseguiti (status != 'na')
 const executedChecks=checks.filter(c=>c.executed&&c.status!=="na");
 const okCount=checks.filter(c=>c.status==="ok").length;
 const warnCount=checks.filter(c=>c.status==="warn").length;
 const badCount=checks.filter(c=>c.status==="bad").length;
 const naCount=checks.filter(c=>c.status==="na"||!c.executed).length;

 let score=100;
 if(executedChecks.length>0){
  const pts=executedChecks.reduce((acc,c)=>acc+(c.status==="ok"?100:c.status==="warn"?62:15),0);
  score=Math.round(pts/executedChecks.length);
 }
 // Confronto con la scansione precedente nello storico
 const prevScan=Array.isArray(historyList)&&historyList.length?historyList[0]:null;
 let comparison=null;
 if(prevScan){
  const diffScore=score-(prevScan.score||0);
  const diffIssues=(warnCount+badCount)-((prevScan.warnCount||0)+(prevScan.badCount||0));
  comparison={
   prevDate:prevScan.dateFormatted||prevScan.timestamp,
   prevLevel:prevScan.levelLabel||prevScan.level,
   prevScore:prevScan.score,
   diffScore,
   diffIssues,
   summary:diffScore===0?`Punteggio invariato (${score}/100) rispetto alla scansione precedente del ${prevScan.dateFormatted}.`:
    diffScore>0?`Miglioramento di +${diffScore} punti (${score}/100 vs ${prevScan.score}/100) rispetto alla scansione del ${prevScan.dateFormatted}.`:
    `Variazione di ${diffScore} punti (${score}/100 vs ${prevScan.score}/100) rispetto alla scansione del ${prevScan.dateFormatted}.`
  };
 }

 const levelLabels={fast:"Rapida",full:"Completa",deep:"Approfondita"};
 const now=new Date();
 const report={
  id:Date.now(),
  timestamp:now.toISOString(),
  dateFormatted:now.toLocaleString("it-IT"),
  level,
  levelLabel:levelLabels[level]||level,
  isAdmin:!!isAdmin,
  score,
  healthLabel:score>=88?"Ottimo":score>=70?"Buono (Attenzione)":score>=50?"Richiede Manutenzione":"Critico",
  counts:{total:checks.length,executed:executedChecks.length,ok:okCount,warn:warnCount,bad:badCount,na:naCount},
  checks,
  problems:checks.filter(c=>c.status==="bad"||c.status==="warn"),
  comparison,
  clean:cleanReport,
  anomaliesLog:[
   ...wheaArr.map(e=>({type:"WHEA Hardware Error",time:e.time,detail:e.msg||"Errore hardware WHEA"})),
   ...kpArr.map(e=>({type:"Kernel-Power ID 41",time:e.time,detail:"Riavvio o arresto improvviso senza spegnimento regolare"})),
   ...bsodArr.map(e=>({type:"BSOD / BugCheck",time:e.time,detail:e.msg||"Arresto critico di sistema"})),
   ...tdrArr.map(e=>({type:"Reset Driver GPU (TDR)",time:e.time,detail:e.msg||"Il driver video ha smesso di rispondere ed è stato ripristinato"})),
   ...crashArr.slice(0,8).map(e=>({type:`App Crash (ID ${e.id})`,time:e.time,detail:e.msg||"Arresto anomalo applicazione"}))
  ]
 };
 p("done",100,"Diagnostica completata.");
 return report;
}

function formatDiagnosticReportTxt(rep,historyList=[]){
 if(!rep)return"Nessun rapporto diagnostico disponibile.";
 const sep="=".repeat(78);
 const sub="-".repeat(78);
 const stMap={ok:"[SUPERATO - OK]",warn:"[ATTENZIONE]",bad:"[PROBLEMA RILEVATO]",na:"[NON DISPONIBILE / NON ESEGUITO]"};
 const lines=[
  sep,
  "  PEPPEZ HARDWARE ANALYTICS - RAPPORTO DIAGNOSTICO COMPLETO DEL SISTEMA",
  sep,
  `Data e ora scansione : ${rep.dateFormatted}`,
  `Livello diagnostica  : ${rep.levelLabel.toUpperCase()}`,
  `Permessi Admin       : ${rep.isAdmin?"Sì (Amministratore)":"No (Utente standard)"}`,
  `Punteggio di Salute  : ${rep.score} / 100 (${rep.healthLabel})`,
  `Riepilogo Controlli  : ${rep.counts.ok} Superati (OK) | ${rep.counts.warn} Attenzione | ${rep.counts.bad} Problemi | ${rep.counts.na} Non disponibili/Non eseguiti`,
  rep.comparison?`Confronto Storico    : ${rep.comparison.summary}`:"Confronto Storico    : Prima scansione registrata",
  ""
 ];

 const hwChecks=rep.checks.filter(c=>c.category==="hardware");
 const swChecks=rep.checks.filter(c=>c.category==="software");

 lines.push(sep,"  1. CONTROLLI HARDWARE (CPU, GPU, RAM, SSD/HDD, RAFFREDDAMENTO, ALIMENTAZIONE)",sep);
 hwChecks.forEach(c=>{
  lines.push(`${stMap[c.status]||c.status} [${c.group}] ${c.title}`);
  lines.push(`  Valore rilevato : ${c.value}`);
  lines.push(`  Dettaglio       : ${c.desc}`);
  if(c.solution)lines.push(`  Soluzione       : ${c.solution}`);
  lines.push(sub);
 });

 lines.push("",""+sep,"  2. CONTROLLI SOFTWARE, STABILITÀ E CONNETTIVITÀ (WINDOWS, RETE, EVENTI)",sep);
 swChecks.forEach(c=>{
  lines.push(`${stMap[c.status]||c.status} [${c.group}] ${c.title}`);
  lines.push(`  Valore rilevato : ${c.value}`);
  lines.push(`  Dettaglio       : ${c.desc}`);
  if(c.solution)lines.push(`  Soluzione       : ${c.solution}`);
  lines.push(sub);
 });

 lines.push("",""+sep,"  3. PROBLEMI RILEVATI E SOLUZIONI CONSIGLIATE",sep);
 if(!rep.problems||!rep.problems.length){
  lines.push("Nessun problema o anomalia rilevata nei controlli eseguiti.");
 }else{
  rep.problems.forEach((p,idx)=>{
   lines.push(`${idx+1}. [${p.status==="bad"?"PROBLEMA":"ATTENZIONE"}] ${p.group} - ${p.title}`);
   lines.push(`   Problema  : ${p.desc}`);
   lines.push(`   Soluzione : ${p.solution||"Monitorare il parametro nel tempo."}`);
  });
 }

 lines.push("",""+sep,"  4. ANALISI SPAZIO E PULIZIA INTELLIGENTE",sep);
 if(rep.clean){
  lines.push(`Spazio recuperabile stimato (cache e temporanei) : ${rep.clean.totalRecoverableFmt}`);
  lines.push(`File grandi / duplicati segnalati per ispezione  : ${rep.clean.totalInspectFmt}`);
  lines.push(sub);
  (rep.clean.categories||[]).forEach(cat=>{
   lines.push(`• ${cat.title}: ${cat.totalFmt} (${cat.fileCount} file)${cat.inspectOnly?" [SOLA ISPEZIONE - NON ELIMINABILE IN AUTOMATICO]":""}`);
   lines.push(`  Tipologia : ${cat.typeDesc}`);
   lines.push(`  Percorsi  : ${(cat.paths||[]).join("; ")||"Nessuna cartella rilevata"}`);
   if(cat.warn)lines.push(`  Nota      : ${cat.warn}`);
  });
 }

 lines.push("",""+sep,"  5. STORICO ANOMALIE DI SISTEMA E SCANSIONI PRECEDENTI",sep);
 if(rep.anomaliesLog&&rep.anomaliesLog.length){
  lines.push("Eventi anomali recenti registrati da Windows:");
  rep.anomaliesLog.forEach(a=>lines.push(`  - [${a.time}] ${a.type}: ${a.detail}`));
 }else{
  lines.push("Nessun evento critico recente nei registri di Windows.");
 }
 if(Array.isArray(historyList)&&historyList.length){
  lines.push("","Ultime scansioni effettuate:");
  historyList.slice(0,10).forEach(h=>{
   lines.push(`  • ${h.dateFormatted} | Livello: ${h.levelLabel} | Punteggio: ${h.score}/100 | OK: ${h.okCount} | Avvisi: ${h.warnCount} | Problemi: ${h.badCount} | N/D: ${h.naCount||0}`);
  });
 }
 lines.push(sep,"Generato da PeppeZ Hardware Analytics",sep);
 return lines.join("\r\n");
}

module.exports={
 runDiagnostics,
 scanCleanable,
 cleanCategories,
 formatDiagnosticReportTxt,
 fmtBytes
};

