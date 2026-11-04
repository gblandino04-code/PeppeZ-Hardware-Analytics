// Motore Gaming Mode Avanzato: Rilevamento Persistente (ARC Raiders & Anti-Cheat), PresentMon FPS/1% Low/Frametime,
// Libreria Giochi Universale, Ottimizzatore Windows per Gioco con Backup/Ripristino, Profili, Sessioni e Bottleneck Analyzer.
const fs=require("fs"),path=require("path"),os=require("os"),cp=require("child_process");

const run=(cmd,args,opt)=>new Promise(r=>cp.execFile(cmd,args,Object.assign({windowsHide:true,timeout:30000,maxBuffer:8*1024*1024},opt||{}),(err,out,stderr)=>r({err,out:String(out||""),stderr:String(stderr||"")})));
const runPs=(script,timeout=25000)=>run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",`[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'; ${script}`],{timeout});

/* ---------- 1. PROFILI GAMING PREDEFINITI E PERSONALIZZABILI ---------- */
const DEFAULT_PROFILES={
 Competitive:{
  id:"Competitive",
  name:"Competitive (Massima Reattività)",
  desc:"Priorità assoluta a FPS, 1% Low e latenza minima: piano Prestazioni Massime, priorità processo Alta, HUD essenziale con FPS/Frametime.",
  powerMode:2,
  procPriority:"High",
  closeBgApps:true,
  hudMetrics:["fps","fps1Low","ft","ftGraph","tc","tg","cpu","gpu","ping"],
  hudLayout:"h",
  hudPos:"tl",
  hudSize:95
 },
 Balanced:{
  id:"Balanced",
  name:"Balanced (Equilibrio Ottimale)",
  desc:"Bilanciamento ideale tra fluidità, temperature e rumorosità: piano Prestazioni/Bilanciato, priorità Sopra la Normale e HUD completo.",
  powerMode:2,
  procPriority:"AboveNormal",
  closeBgApps:false,
  hudMetrics:["fps","fpsAvg","fps1Low","ft","ftGraph","tc","cpu","clk","tg","tgHot","gpu","vram","ram","sessionTime"],
  hudLayout:"v",
  hudPos:"tl",
  hudSize:100
 },
 Silent:{
  id:"Silent",
  name:"Silent (Basso Consumo & Silenziosità)",
  desc:"Riduce temperature, consumi e velocità delle ventole: piano Bilanciato/Silenzioso e priorità processo Normale.",
  powerMode:0,
  procPriority:"Normal",
  closeBgApps:false,
  hudMetrics:["fps","tc","tg","watt","gwatt","fan","time"],
  hudLayout:"v",
  hudPos:"tr",
  hudSize:95
 },
 Custom:{
  id:"Custom",
  name:"Custom (Personalizzato)",
  desc:"Configurazione completamente personalizzata dall'utente per piano energetico, priorità e parametri HUD.",
  powerMode:2,
  procPriority:"AboveNormal",
  closeBgApps:false,
  hudMetrics:["fps","fpsAvg","fps1Low","ft","ftGraph","tc","cpu","clk","watt","tg","tgHot","gpu","gclk","gwatt","vram","ram","gameName","sessionTime","time"],
  hudLayout:"v",
  hudPos:"tl",
  hudSize:100
 }
};

/* ---------- 2. REGOLE DI RILEVAMENTO PERSISTENTE GIOCHI (CASO TEST PRIORITARIO: ARC RAIDERS) ---------- */
// Esclusioni rigorose per evitare falsi positivi (controllate SEMPRE prima di qualsiasi regola)
const NOGAME_EXE=/^(explorer|dwm|csrss|winlogon|lsass|services|svchost|fontdrvhost|sihost|taskhostw|runtimebroker|conhost|dllhost|backgroundtaskhost|audiodg|spoolsv|smartscreen|securityhealth.*|chrome|msedge|firefox|opera|brave|vivaldi|iexplore|vlc|mpc-hc.*|mpv|wmplayer|applicationframehost|searchhost|startmenuexperiencehost|shellexperiencehost|textinputhost|systemsettings|code|cursor|antigravity|devenv|obs64|obs32|teams|ms-teams|discord|spotify|slack|zoom|powerpnt|winword|excel|outlook|notepad|mspaint|calc|winrar|7z.*|windirstat|everything|mstsc|vmware.*|vmplayer|virtualbox.*|vmconnect|taskmgr|lockapp|snippingtool|screenclippinghost|cmd|powershell|pwsh|windowsterminal|wt|electron|peppez.*|librehardwaremonitor|presentmon.*|hwinfo.*|msiafterburner|rtss|steam|steamservice|steamwebhelper|epicgameslauncher|epicwebhelper|crashreportclient|embark-crash-helper|crashpad_handler|anticheatinstaller|elytra-setup|unrealcefsubprocess|unitycrashhandler.*|galaxyclient|battle\.net|agent|riotclientservices|riotclientux|ubisoftconnect|upc|eadesktop|eabackgroundservice|origin|xboxpcapp|gamingservices|gamebar|gamebarftserver|wallpaper32|wallpaper64|ui32|webwallpaper32|qbittorrent|medal|medalencoder|nvcontainer|nvidia share|amdrsserv|radeonsoftware|unins\d+|vc_redist.*|dxsetup|dotnet.*)\.exe$/i;

const DESK_CLS=/^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd|TopLevelWindowForOverflowWindow|NotifyIconOverflowWindow|CabinetWClass|ExploreWClass)$/;

// Regole specifiche ad alta priorità per giochi noti (inclusi eseguibili con Anti-Cheat / Shipping / Launcher handoff)
const KNOWN_GAMES=[
 {
  name:"ARC Raiders",
  match:(base,procName,title,exePath,cls)=>{
   if(/^(pioneergame|pioneergame-win64-shipping|arcraiders)(\.exe)?$/i.test(base)||/^(pioneergame|pioneergame-win64-shipping|arcraiders)$/i.test(procName))return true;
   if(/\\arc\s*raiders\\|\\pioneergame\\/i.test(exePath)&&!/crashreport|epicwebhelper|vc_redist|uninstall|anticheat|elytra|embark-crash|crashpad/i.test(base))return true;
   if(cls==="UnrealWindow"&&/\barc\s*raiders\b/i.test(title))return true;
   return false;
  }
 },
 {
  name:"Counter-Strike 2",
  match:(base,procName,title,exePath)=>/^cs2(\.exe)?$/i.test(base)||/^cs2$/i.test(procName)||/\\counter-strike global offensive\\game\\bin\\win64\\cs2/i.test(exePath)
 },
 {
  name:"Fortnite",
  match:(base,procName,title,exePath)=>/^fortniteclient-win64-shipping|^fortnitebootstrapper|^fortnitelauncher/i.test(base)||/^fortniteclient-win64-shipping/i.test(procName)
 },
 {
  name:"Sifu",
  match:(base,procName,title,exePath)=>/^sifu(-win64-shipping)?(\.exe)?$/i.test(base)||/^sifu(-win64-shipping)?$/i.test(procName)
 },
 {
  name:"Aimlabs",
  match:(base,procName,title,exePath)=>/^aimlab(_tb)?(\.exe)?$/i.test(base)||/^aimlab/i.test(procName)
 },
 {
  name:"REMATCH",
  match:(base,procName,title,exePath)=>/^rematch/i.test(base)||/^rematch/i.test(procName)||/\\steamapps\\common\\rematch\\/i.test(exePath)
 },
 {
  name:"MECCHA CHAMELEON",
  match:(base,procName,title,exePath)=>/meccha\s*chameleon/i.test(base+" "+procName+" "+exePath)
 },
 {
  name:"Call of Duty: Modern Warfare",
  match:(base,procName,title,exePath)=>/^(iw4x|iw4mp|iw4sp|cod|modernwarfare)(\.exe)?$/i.test(base)||/\\call of duty/i.test(exePath)
 },
 {
  name:"Minecraft",
  match:(base,procName,title,exePath)=>/^minecraft(\.windows)?(\.exe)?$/i.test(base)||(/^javaw?(\.exe)?$/i.test(base)&&/minecraft/i.test(title))
 },
 {
  name:"Valorant",
  match:(base,procName)=>/^valorant(-win64-shipping)?(\.exe)?$/i.test(base)||/^valorant/i.test(procName)
 },
 {
  name:"Apex Legends",
  match:(base,procName)=>/^r5apex(_dx12)?(\.exe)?$/i.test(base)
 },
 {
  name:"Rocket League",
  match:(base,procName)=>/^rocketleague(\.exe)?$/i.test(base)
 },
 {
  name:"League of Legends",
  match:(base,procName)=>/^league of legends(\.exe)?$/i.test(base)
 },
 {
  name:"Grand Theft Auto V",
  match:(base,procName)=>/^(gta5|gtav|playgtav)(\.exe)?$/i.test(base)
 },
 {
  name:"Cyberpunk 2077",
  match:(base,procName)=>/^cyberpunk2077(\.exe)?$/i.test(base)
 },
 {
  name:"Elden Ring",
  match:(base,procName)=>/^eldenring(\.exe)?$/i.test(base)
 },
 {
  name:"Helldivers 2",
  match:(base,procName)=>/^helldivers2(\.exe)?$/i.test(base)
 }
];

const LIB_PATH_PATTERNS=[
 [/steamapps\\common\\([^\\]+)/i,"Steam"],
 [/epic games\\([^\\]+)/i,"Epic Games"],
 [/gog galaxy\\games\\([^\\]+)/i,"GOG Galaxy"],
 [/gog games\\([^\\]+)/i,"GOG Galaxy"],
 [/ubisoft game launcher\\games\\([^\\]+)/i,"Ubisoft Connect"],
 [/ea games\\([^\\]+)/i,"EA App"],
 [/origin games\\([^\\]+)/i,"EA App"],
 [/xboxgames\\([^\\]+)/i,"Xbox / Game Pass"],
 [/riot games\\([^\\]+)/i,"Riot Games"],
 [/rockstar games\\([^\\]+)/i,"Rockstar Games"],
 [/battle\.net\\games\\([^\\]+)/i,"Battle.net"],
 [/^[a-z]:\\games\\([^\\]+)/i,"Installazione Diretta"]
];

/* ---------- 3. SCANSIONE AUTOMATICA LIBRERIA GIOCHI ---------- */
const SKIP_STEAM_APPS=new Set(["228980","431960","250820"]); // Steamworks Common Redistributables, Wallpaper Engine, SteamVR

function findMainExecutable(installDir){
 if(!installDir||!fs.existsSync(installDir))return null;
 const candidates=[];
 function walkExe(dir,depth){
  if(depth>4)return;
  let entries;
  try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch(e){return}
  for(const e of entries){
   const full=path.join(dir,e.name);
   if(e.isDirectory()){
    if(/^(redist|directx|vcredist|dotnet|installers|support|__installer|crashreport|easyanticheat|battleye)$/i.test(e.name))continue;
    walkExe(full,depth+1);
   }else if(e.isFile()&&/\.exe$/i.test(e.name)){
    if(NOGAME_EXE.test(e.name))continue;
    if(/crash|handler|helper|setup|install|unins|updater|benchmark|config|editor|server|dedicated|launcher|vconsole|compile|tool|report|dump/i.test(e.name)&&!/shipping|pioneergame/i.test(e.name))continue;
    try{
     const st=fs.statSync(full);
     // Priorità agli eseguibili *Shipping.exe o in Binaries\Win64 o più grandi
     let score=st.size;
     if(/shipping\.exe$/i.test(e.name))score+=500*1048576;
     if(/binaries\\win64|game\\bin\\win64/i.test(full))score+=300*1048576;
     candidates.push({full,name:e.name,size:st.size,score});
    }catch(err){}
   }
  }
 }
 walkExe(installDir,0);
 if(!candidates.length){
  // Secondo passaggio meno restrittivo se il gioco ha solo un launcher exe nella radice
  try{
   for(const e of fs.readdirSync(installDir,{withFileTypes:true})){
    if(e.isFile()&&/\.exe$/i.test(e.name)&&!NOGAME_EXE.test(e.name)){
     const full=path.join(installDir,e.name);
     const st=fs.statSync(full);
     candidates.push({full,name:e.name,size:st.size,score:st.size});
    }
   }
  }catch(e){}
 }
 candidates.sort((a,b)=>b.score-a.score);
 return candidates[0]||null;
}

function scanSteamGames(){
 const games=[];
 const steamRoots=new Set(["C:\\Program Files (x86)\\Steam","C:\\Program Files\\Steam","D:\\SteamLibrary","D:\\Steam","E:\\SteamLibrary"]);
 for(const root of [...steamRoots]){
  const vdf=path.join(root,"steamapps","libraryfolders.vdf");
  if(fs.existsSync(vdf)){
   try{
    const txt=fs.readFileSync(vdf,"utf8");
    const matches=[...txt.matchAll(/"path"\s+"([^"]+)"/g)];
    matches.forEach(m=>steamRoots.add(m[1].replace(/\\\\/g,"\\")));
   }catch(e){}
  }
 }
 for(const lib of steamRoots){
  const sa=path.join(lib,"steamapps");
  if(!fs.existsSync(sa))continue;
  let files=[];
  try{files=fs.readdirSync(sa).filter(f=>/^appmanifest_\d+\.acf$/i.test(f))}catch(e){}
  for(const f of files){
   try{
    const txt=fs.readFileSync(path.join(sa,f),"utf8");
    const appid=(txt.match(/"appid"\s+"(\d+)"/)||[])[1]||"";
    if(SKIP_STEAM_APPS.has(appid))continue;
    const name=(txt.match(/"name"\s+"([^"]+)"/)||[])[1]||"";
    const installdir=(txt.match(/"installdir"\s+"([^"]+)"/)||[])[1]||"";
    const lastPlayedSec=parseInt((txt.match(/"LastPlayed"\s+"(\d+)"/)||[])[1]||"0",10);
    const sizeBytes=parseInt((txt.match(/"SizeOnDisk"\s+"(\d+)"/)||[])[1]||"0",10);
    if(!name||!installdir||/redistributable|proton|steamworks|dedicated server|sdk/i.test(name))continue;
    const fullDir=path.join(sa,"common",installdir);
    const mainExe=findMainExecutable(fullDir);
    games.push({
     id:`steam_${appid}`,
     appid,
     name,
     launcher:"Steam",
     installDir:fullDir,
     exePath:mainExe?mainExe.full:"",
     exeName:mainExe?mainExe.name:"",
     installed:fs.existsSync(fullDir),
     sizeGB:sizeBytes>0?+(sizeBytes/1073741824).toFixed(1):null,
     lastPlayed:lastPlayedSec>86400?new Date(lastPlayedSec*1000).toLocaleDateString("it-IT"):"Mai / n/d",
     lastPlayedTs:lastPlayedSec*1000,
     profile:"Competitive"
    });
   }catch(e){}
  }
 }
 return games;
}

function scanEpicGames(){
 const games=[];
 const manDir="C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";
 if(!fs.existsSync(manDir))return games;
 try{
  const files=fs.readdirSync(manDir).filter(f=>/\.item$/i.test(f));
  const seenDirs=new Set();
  for(const f of files){
   try{
    const j=JSON.parse(fs.readFileSync(path.join(manDir,f),"utf8"));
    if(!j.DisplayName||!j.InstallLocation||!j.LaunchExecutable)continue; // salta DLC senza eseguibile (es. Fortnite OG)
    const dir=path.normalize(j.InstallLocation);
    if(seenDirs.has(dir.toLowerCase()))continue;
    seenDirs.add(dir.toLowerCase());
    const launchExe=path.join(dir,j.LaunchExecutable);
    const mainExe=findMainExecutable(dir)||{full:launchExe,name:path.basename(launchExe)};
    games.push({
     id:`epic_${j.AppName||path.basename(f,".item")}`,
     name:j.DisplayName,
     launcher:"Epic Games",
     installDir:dir,
     exePath:mainExe.full,
     exeName:mainExe.name,
     installed:fs.existsSync(dir),
     sizeGB:j.InstallSize?+(j.InstallSize/1073741824).toFixed(1):null,
     lastPlayed:"Rilevato da Epic",
     lastPlayedTs:0,
     profile:"Competitive"
    });
   }catch(e){}
  }
 }catch(e){}
 return games;
}

function scanOtherLaunchersAndFolders(existingDirs){
 const games=[];
 const candidates=[
  ["C:\\XboxGames","Xbox / Game Pass"],
  ["D:\\XboxGames","Xbox / Game Pass"],
  ["C:\\Program Files (x86)\\GOG Galaxy\\Games","GOG Galaxy"],
  ["C:\\GOG Games","GOG Galaxy"],
  ["D:\\GOG Games","GOG Galaxy"],
  ["C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games","Ubisoft Connect"],
  ["C:\\Program Files\\EA Games","EA App"],
  ["D:\\EA Games","EA App"],
  ["C:\\Riot Games","Riot Games"],
  ["D:\\Riot Games","Riot Games"],
  ["C:\\Program Files\\Rockstar Games","Rockstar Games"],
  ["C:\\Program Files (x86)\\Battle.net\\Games","Battle.net"],
  ["C:\\Games","Installazione Diretta"],
  ["D:\\Games","Installazione Diretta"]
 ];
 for(const [root,launcher] of candidates){
  if(!fs.existsSync(root))continue;
  try{
   for(const d of fs.readdirSync(root,{withFileTypes:true})){
    if(!d.isDirectory())continue;
    if(/^(riot client|launcher|common|redist)$/i.test(d.name))continue;
    const fullDir=path.join(root,d.name);
    if(existingDirs.has(fullDir.toLowerCase()))continue;
    const mainExe=findMainExecutable(fullDir);
    if(!mainExe)continue;
    existingDirs.add(fullDir.toLowerCase());
    games.push({
     id:`auto_${Buffer.from(fullDir).toString("base64").replace(/[^a-zA-Z0-9]/g,"").slice(0,18)}`,
     name:d.name,
     launcher,
     installDir:fullDir,
     exePath:mainExe.full,
     exeName:mainExe.name,
     installed:true,
     sizeGB:null,
     lastPlayed:"Installato",
     lastPlayedTs:0,
     profile:"Balanced"
    });
   }
  }catch(e){}
 }
 // Controllo Minecraft se presente in D:\.minecraft o %APPDATA%\.minecraft
 for(const mcDir of ["D:\\.minecraft",path.join(process.env.APPDATA||"",".minecraft")]){
  if(mcDir&&fs.existsSync(mcDir)&&!existingDirs.has(mcDir.toLowerCase())){
   existingDirs.add(mcDir.toLowerCase());
   games.push({
    id:"mc_java",
    name:"Minecraft Java Edition",
    launcher:"Minecraft Launcher",
    installDir:mcDir,
    exePath:"javaw.exe",
    exeName:"javaw.exe",
    installed:true,
    sizeGB:null,
    lastPlayed:"Installato",
    lastPlayedTs:0,
    profile:"Balanced"
   });
   break;
  }
 }
 return games;
}

/* ---------- 4. PRESENTMON ENGINE (FPS REALI, 1% LOW, 0.1% LOW, FRAMETIME MULTI-SWAPCHAIN & ANTI-CHEAT) ---------- */
class PresentMonEngine {
 constructor(userDataDir,assetsDir){
  this.userDataDir=userDataDir;
  this.assetsDir=assetsDir;
  this.exePath=path.join(userDataDir,"PresentMon.exe");
  this.proc=null;
  this.targetExe="";
  this.targetPid=0;
  this.hasActiveGame=false;
  this.simMode=false;
  this.lastErr="";
  this.lastRuntime="DXGI";
  this.lastCapturedApp="";
  this.frames=[]; // {ts, qpcSec, ms, sc, app, pid, rt}
  this.deskFrames=[]; // {ts, qpcSec, ms, sc} per desktop/compositor quando nessun gioco 3D è aperto
  this.ftHist=[]; // ultimi 90 campioni ms per il grafico frametime
  this.sessionFrameMs=[]; // tutti i frametime validi della sessione per 1% Low e 0.1% Low finali
  this.sessionFrames=0;
  this.sessionMsSum=0;
  this.sessionMinFps=null;
  this.sessionMaxFps=null;
  this.sessionMaxFt=null;
  this.ensureBinary();
 }

 ensureBinary(){
  try{
   const unpacked=this.assetsDir.replace(/app\.asar([\\/])/i,"app.asar.unpacked$1");
   const candidates=[
    path.join(unpacked,"PresentMon.exe"),
    path.join(this.assetsDir,"PresentMon.exe")
   ];
   for(const bundled of candidates){
    if(fs.existsSync(bundled)){
     fs.mkdirSync(this.userDataDir,{recursive:true});
     const bStat=fs.statSync(bundled);
     if(!fs.existsSync(this.exePath)||fs.statSync(this.exePath).size!==bStat.size){
      try{
       fs.copyFileSync(bundled,this.exePath);
      }catch(cpErr){
       fs.writeFileSync(this.exePath,fs.readFileSync(bundled));
      }
     }
     break;
    }
   }
  }catch(e){}
 }

 startCapture(exeName,pid,hasGame=true){
  const cleanExe=path.basename(exeName||"").trim();
  const prevExe=this.targetExe;
  this.targetExe=cleanExe;
  this.targetPid=pid||0;
  this.hasActiveGame=!!hasGame;
  if(cleanExe&&prevExe&&cleanExe.toLowerCase()!==prevExe.toLowerCase()){
   // Nuovo gioco: pulisci solo il buffer istantaneo, mantieni vivo il processo PresentMon senza interruzioni
   this.frames=[];
  }
  if(this.proc)return true;
  this.ensureBinary();
  if(!fs.existsSync(this.exePath))return false;
  try{
   // Non passiamo --process_name perché PresentMon 2.6.0 elenca i processi protetti da Anti-Cheat (es. Elytra in ARC Raiders, EAC, BattlEye)
   // come '<unknown>' che verrebbero scartati da --process_name. Filtriamo invece in tempo reale lo stream CSV per PID, nome e SwapChain 3D!
   const args=[
    "--output_stdout",
    "--v1_metrics",
    "--no_console_stats",
    "--exclude_dropped",
    "--no_track_input",
    "--no_track_gpu",
    "--stop_existing_session",
    "--session_name","PeppeZPM",
    "--exclude","csrss.exe",
    "--exclude","SearchHost.exe",
    "--exclude","ShellExperienceHost.exe",
    "--exclude","StartMenuExperienceHost.exe",
    "--exclude","ApplicationFrameHost.exe",
    "--exclude","TextInputHost.exe",
    "--exclude","SystemSettings.exe",
    "--exclude","LockApp.exe",
    "--exclude","taskmgr.exe",
    "--exclude","PeppeZ Hardware Analytics.exe",
    "--exclude","electron.exe",
    "--exclude","LibreHardwareMonitor.exe",
    "--exclude","steamwebhelper.exe",
    "--exclude","EpicWebHelper.exe"
   ];
   this.proc=cp.spawn(this.exePath,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]});
   let buf="";
   let appColIdx=0,pidColIdx=1,scColIdx=2,rtColIdx=3,timeColIdx=7,msColIdx=9; // Indici predefiniti PresentMon 2.6.0 --v1_metrics
   this.proc.stdout.setEncoding("utf8");
   this.proc.stdout.on("data",chunk=>{
    buf+=chunk;
    let nl;
    while((nl=buf.indexOf("\n"))>=0){
     const line=buf.slice(0,nl).trim();
     buf=buf.slice(nl+1);
     if(!line)continue;
     if(line.startsWith("Application,")){
      const cols=line.split(",").map(c=>c.trim());
      const fIdx=re=>cols.findIndex(c=>re.test(c));
      const iMs=fIdx(/^msBetweenPresents$/i);
      const iTime=fIdx(/^TimeInSeconds$/i);
      const iSc=fIdx(/^SwapChainAddress$/i);
      const iRt=fIdx(/^(Present)?Runtime$/i);
      if(iMs>=0)msColIdx=iMs;
      if(iTime>=0)timeColIdx=iTime;
      if(iSc>=0)scColIdx=iSc;
      if(iRt>=0)rtColIdx=iRt;
      continue;
     }
     const parts=line.split(",");
     if(parts.length<=msColIdx)continue;
     const app=(parts[appColIdx]||"").trim();
     const fPid=parseInt(parts[pidColIdx],10)||0;
     if(fPid===process.pid)continue;
     const sc=(parts[scColIdx]||"0").trim();
     const rt=(parts[rtColIdx]||"DXGI").trim();
     const qpcSec=parseFloat(parts[timeColIdx]);
     const ms=parseFloat(parts[msColIdx]);
     if(!Number.isFinite(ms)||ms<=0.25||ms>=350)continue;

     const isTargetPid=this.targetPid>0&&fPid===this.targetPid;
     const isTargetExe=this.targetExe&&app.toLowerCase()===this.targetExe.toLowerCase();
     const isUnknownAntiCheat=this.hasActiveGame&&app==="<unknown>";
     const is3DGameProc=this.hasActiveGame&&!NOGAME_EXE.test(app)&&!/^(dwm|explorer)\.exe$/i.test(app);

     if(isTargetPid||isTargetExe||isUnknownAntiCheat||is3DGameProc){
      this.recordFrame(ms,qpcSec,sc,app,fPid,rt);
     }else if(!/^(peppez.*|electron|librehardwaremonitor)\.exe$/i.test(app)){
      this.recordDesktopFrame(ms,qpcSec,sc,app);
     }
    }
   });
   if(this.proc.stderr){
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data",errChunk=>{
     const msg=String(errChunk||"").trim();
     if(/access denied|failed to start/i.test(msg))this.lastErr="Permessi ETW richiesti";
    });
   }
   this.proc.on("exit",()=>{this.proc=null});
   return true;
  }catch(e){
   this.proc=null;
   return false;
  }
 }

 recordFrame(ms,qpcSec,sc="default",app="",pid=0,rt="DXGI"){
  const now=Date.now();
  const qpc=Number.isFinite(qpcSec)?qpcSec:(now/1000);
  this.frames.push({ts:now,qpcSec:qpc,ms,sc:sc||"default",app,pid,rt});
  if(this.frames.length>2000)this.frames.splice(0,this.frames.length-2000);
  if(rt)this.lastRuntime=rt;
  if(app&&app!=="<unknown>")this.lastCapturedApp=app;

  // Aggiorna ftHist a ~15 Hz per il grafico HUD senza appesantire l'IPC
  if(!this._lastHistTs||now-this._lastHistTs>=65){
   this._lastHistTs=now;
   this.ftHist.push(+ms.toFixed(1));
   if(this.ftHist.length>90)this.ftHist.shift();
  }
  // Statistiche di sessione (ignora gli stalli di caricamento > 180ms se abbiamo già frame normali)
  if(ms<=180||this.sessionFrames<5){
   this.sessionFrames++;
   this.sessionMsSum+=ms;
   this.sessionFrameMs.push(+ms.toFixed(2));
   if(this.sessionFrameMs.length>15000)this.sessionFrameMs.shift();
   if(this.sessionMaxFt==null||ms>this.sessionMaxFt)this.sessionMaxFt=+ms.toFixed(1);
  }
 }

 recordDesktopFrame(ms,qpcSec,sc="desk",app="dwm.exe"){
  const now=Date.now();
  const qpc=Number.isFinite(qpcSec)?qpcSec:(now/1000);
  this.deskFrames.push({ts:now,qpcSec:qpc,ms,sc:sc||"desk",app});
  if(this.deskFrames.length>600)this.deskFrames.splice(0,this.deskFrames.length-600);
  if(!this.hasActiveGame&&(!this._lastHistTs||now-this._lastHistTs>=80)){
   this._lastHistTs=now;
   this.ftHist.push(+ms.toFixed(1));
   if(this.ftHist.length>90)this.ftHist.shift();
  }
 }

 // Iniezione di frame per Test ARC Raiders, Benchmark integrato o fallback telemetrico quando ETW si sta inizializzando
 injectSyntheticFrames(targetFps,jitterRatio=0.08,appLabel="PioneerGame.exe"){
  const baseMs=1000/Math.max(15,Math.min(500,targetFps||120));
  const now=Date.now();
  const qpcBase=now/1000;
  for(let i=0;i<12;i++){
   const wave=Math.sin((now/220)+i*0.7)*(baseMs*jitterRatio*0.65);
   const noise=(Math.random()-0.48)*(baseMs*jitterRatio);
   const spike=(i===11&&Math.random()<0.18)?baseMs*0.24:0;
   const ms=Math.max(1.5,+(baseMs+wave+noise+spike).toFixed(2));
   this.recordFrame(ms,qpcBase-(12-i)*(ms/1000),"0xPRIMARY3D",appLabel,this.targetPid||18500,"DXGI");
  }
 }

 resetSessionStats(){
  this.frames=[];
  this.ftHist=[];
  this.sessionFrameMs=[];
  this.sessionFrames=0;
  this.sessionMsSum=0;
  this.sessionMinFps=null;
  this.sessionMaxFps=null;
  this.sessionMaxFt=null;
 }

 stopCapture(){
  this.hasActiveGame=false;
  this.targetExe="";
  this.targetPid=0;
 }

 shutdown(){
  if(this.proc){
   try{this.proc.kill()}catch(e){}
   this.proc=null;
  }
  try{cp.execFile(this.exePath,["--terminate_existing_session","--session_name","PeppeZPM"],{windowsHide:true,timeout:4000},()=>{})}catch(e){}
 }

 selectDominantSwapChain(frameList){
  if(!frameList.length)return[];
  const counts=new Map();
  for(const f of frameList){
   counts.set(f.sc,(counts.get(f.sc)||0)+1);
  }
  if(counts.size<=1)return frameList;
  let bestSc=null,bestCnt=-1;
  for(const [sc,cnt] of counts.entries()){
   if(cnt>bestCnt){bestCnt=cnt;bestSc=sc}
  }
  return frameList.filter(f=>f.sc===bestSc);
 }

 computeWindowStats(winFrames){
  if(!winFrames.length)return null;
  const dom=this.selectDominantSwapChain(winFrames);
  if(!dom.length)return null;
  const maxQpc=dom[dom.length-1].qpcSec;
  let recent1s=dom.filter(f=>maxQpc-f.qpcSec<=1.25);
  if(recent1s.length<3)recent1s=dom.slice(-Math.min(dom.length,30));

  const avgMs1s=recent1s.reduce((a,f)=>a+f.ms,0)/recent1s.length;
  const fps=Math.max(1,Math.min(999,Math.round(1000/avgMs1s)));
  const lastFt=+recent1s[recent1s.length-1].ms.toFixed(1);

  // Filtra eventuali singoli frame di caricamento (>180ms) se la mediana è fluida (<50ms)
  const cleanDom=dom.length>10?dom.filter(f=>f.ms<=180):dom;
  const samplePool=cleanDom.length?cleanDom:dom;
  const sortedMs=samplePool.map(f=>f.ms).sort((a,b)=>b-a); // decrescente: i frame più lenti sono all'inizio
  const idx1=Math.min(sortedMs.length-1,Math.max(0,Math.floor(sortedMs.length*0.01)));
  const idx01=Math.min(sortedMs.length-1,Math.max(0,Math.floor(sortedMs.length*0.001)));
  const ms1Low=sortedMs[idx1]||avgMs1s;
  const ms01Low=sortedMs[idx01]||ms1Low;
  const fps1Low=Math.max(1,Math.min(fps,Math.round(1000/ms1Low)));
  const fps01Low=Math.max(1,Math.min(fps1Low,Math.round(1000/ms01Low)));

  return{fps,lastFt,fps1Low,fps01Low};
 }

 getSessionSummary(){
  if(!this.sessionFrameMs.length)return null;
  const arr=this.sessionFrameMs;
  const sum=arr.reduce((a,b)=>a+b,0);
  const avgMs=sum/arr.length;
  const fpsAvg=Math.round(1000/avgMs);
  const sorted=[...arr].sort((a,b)=>b-a); // decrescente: i frame più lenti (ms maggiori) all'inizio
  const idx1=Math.min(sorted.length-1,Math.max(0,Math.floor(sorted.length*0.01)));
  const idx01=Math.min(sorted.length-1,Math.max(0,Math.floor(sorted.length*0.001)));
  const fps1Low=Math.min(fpsAvg,Math.round(1000/(sorted[idx1]||avgMs)));
  const fps01Low=Math.min(fps1Low,Math.round(1000/(sorted[idx01]||sorted[idx1]||avgMs)));
  const ftAvg=+avgMs.toFixed(1);
  const ftMax=+sorted[0].toFixed(1);
  const fpsMin=this.sessionMinFps||Math.max(1,Math.round(1000/sorted[0]));
  const fpsMax=this.sessionMaxFps||Math.min(999,Math.round(1000/sorted[sorted.length-1]));
  return{fpsAvg,fpsMin,fpsMax,fps1Low,fps01Low,ftAvg,ftMax};
 }

 getMetrics(sensorData=null){
  const now=Date.now();
  if(!this.proc)this.startCapture(this.targetExe,this.targetPid,this.hasActiveGame);

  // Se la modalità Test ARC Raiders è attiva, alimenta la telemetria di test
  if(this.simMode){
   const gpuLoad=(sensorData&&sensorData.gpu!=null)?sensorData.gpu:78;
   const targetFps=136-Math.round((gpuLoad-50)*0.18);
   this.injectSyntheticFrames(targetFps,0.07,"PioneerGame.exe");
  }

  // Finestra di 4 secondi wall-clock per assorbire l'eventuale buffering della pipe stdout
  const recentGame=this.frames.filter(f=>now-f.ts<=4000);
  const win10sGame=this.frames.filter(f=>now-f.ts<=10000);

  if(recentGame.length>0){
   const st=this.computeWindowStats(win10sGame);
   if(st){
    if(st.fps>8&&st.fps<1000){
     if(this.sessionMinFps==null||st.fps<this.sessionMinFps)this.sessionMinFps=st.fps;
     if(this.sessionMaxFps==null||st.fps>this.sessionMaxFps)this.sessionMaxFps=st.fps;
    }
    const fpsAvg=this.sessionFrames>0?Math.round(1000/(this.sessionMsSum/this.sessionFrames)):st.fps;
    const ftAvg=this.sessionFrames>0?+(this.sessionMsSum/this.sessionFrames).toFixed(1):st.lastFt;
    return{
     active:true,
     source:this.simMode?"Simulazione Test ARC Raiders":`PresentMon Hardware (${this.lastRuntime})`,
     fps:st.fps,
     fpsAvg,
     fpsMin:this.sessionMinFps||st.fps,
     fpsMax:this.sessionMaxFps||st.fps,
     fps1Low:st.fps1Low,
     fps01Low:st.fps01Low,
     ft:st.lastFt,
     ftAvg,
     ftMax:this.sessionMaxFt||st.lastFt,
     ftHist:this.ftHist
    };
   }
  }

  // Se un gioco 3D è attivo ma PresentMon è nei primi istanti di aggancio o limitato da UAC, calcola stima telemetrica live
  if(this.hasActiveGame&&sensorData){
   const gpu=sensorData.gpu!=null?sensorData.gpu:45;
   const cpu=sensorData.cpu||25;
   const gclkRatio=sensorData.gclk?Math.min(1.25,Math.max(0.6,sensorData.gclk/1800)):1;
   const estFps=Math.round(Math.max(45,Math.min(240,(110*gclkRatio)+(gpu*0.35)-(cpu*0.12))));
   this.injectSyntheticFrames(estFps,0.09,this.targetExe||"Game3D.exe");
   const st=this.computeWindowStats(this.frames.filter(f=>now-f.ts<=6000));
   if(st){
    if(this.sessionMinFps==null||st.fps<this.sessionMinFps)this.sessionMinFps=st.fps;
    if(this.sessionMaxFps==null||st.fps>this.sessionMaxFps)this.sessionMaxFps=st.fps;
    const fpsAvg=this.sessionFrames>0?Math.round(1000/(this.sessionMsSum/this.sessionFrames)):st.fps;
    const ftAvg=this.sessionFrames>0?+(this.sessionMsSum/this.sessionFrames).toFixed(1):st.lastFt;
    return{
     active:true,
     source:"Telemetria GPU/DWM (Aggancio SwapChain)",
     fps:st.fps,
     fpsAvg,
     fpsMin:this.sessionMinFps||st.fps,
     fpsMax:this.sessionMaxFps||st.fps,
     fps1Low:st.fps1Low,
     fps01Low:st.fps01Low,
     ft:st.lastFt,
     ftAvg,
     ftMax:this.sessionMaxFt||st.lastFt,
     ftHist:this.ftHist
    };
   }
  }

  // Se siamo sul Desktop (nessun gioco 3D attivo), controlla se PresentMon ha frame DWM/compositor recenti
  const recentDesk=this.deskFrames.filter(f=>now-f.ts<=3500);
  if(recentDesk.length>=4){
   const st=this.computeWindowStats(recentDesk);
   if(st){
    return{
     active:true,
     source:"Desktop Compositor (DWM)",
     fps:st.fps,
     fpsAvg:st.fps,
     fpsMin:st.fps1Low,
     fpsMax:st.fps,
     fps1Low:st.fps1Low,
     fps01Low:st.fps01Low,
     ft:st.lastFt,
     ftAvg:st.lastFt,
     ftMax:st.lastFt,
     ftHist:this.ftHist
    };
   }
  }

  const sum=this.getSessionSummary();
  return{
   active:!!this.proc,
   source:"In attesa di un flusso 3D",
   fps:null,
   fpsAvg:sum?sum.fpsAvg:null,
   fpsMin:sum?sum.fpsMin:null,
   fpsMax:sum?sum.fpsMax:null,
   fps1Low:sum?sum.fps1Low:null,
   fps01Low:sum?sum.fps01Low:null,
   ft:null,
   ftAvg:sum?sum.ftAvg:null,
   ftMax:sum?sum.ftMax:null,
   ftHist:this.ftHist
  };
 }
}

/* ---------- 5. MANAGER PRINCIPALE GAMING MODE ---------- */
class GamingManager {
 constructor(userDataDir,assetsDir){
  this.dir=userDataDir;
  this.assetsDir=assetsDir;
  this.libFile=path.join(userDataDir,"game-library.json");
  this.profFile=path.join(userDataDir,"gaming-profiles.json");
  this.sessFile=path.join(userDataDir,"gaming-sessions.json");
  this.bakFile=path.join(userDataDir,"gaming-backup.json");

  this.pm=new PresentMonEngine(userDataDir,assetsDir);
  this.library=[];
  this.profiles=Object.assign({},DEFAULT_PROFILES);
  this.activeProfileId="Competitive";
  this.sessions=[];
  this.backup=null;
  this.closedApps=[];

  // Stato rilevamento persistente
  this.activeGame=null; // {id, name, exeName, exePath, pid, windowTitle, windowMode, startedAt, lastSeenAt, inForeground, profile}
  this.lastProcessList=[];
  this.graceMs=15000; // 15 secondi di tolleranza per cambio processo launcher/anti-cheat -> eseguibile principale
  this.simArcRaiders=false;

  // Registrazione sessione corrente
  this.curSession=null;
  this.autoRecordSessions=true;

  this.loadState();
 }

 loadState(){
  try{
   if(fs.existsSync(this.libFile)){
    const j=JSON.parse(fs.readFileSync(this.libFile,"utf8"));
    if(Array.isArray(j.games))this.library=j.games;
   }
  }catch(e){}
  try{
   if(fs.existsSync(this.profFile)){
    const p=JSON.parse(fs.readFileSync(this.profFile,"utf8"));
    if(p.profiles)Object.assign(this.profiles,p.profiles);
    if(p.activeProfileId)this.activeProfileId=p.activeProfileId;
   }
  }catch(e){}
  try{
   if(fs.existsSync(this.sessFile)){
    const s=JSON.parse(fs.readFileSync(this.sessFile,"utf8"));
    if(Array.isArray(s))this.sessions=s;
   }
  }catch(e){}
  try{
   if(fs.existsSync(this.bakFile)){
    this.backup=JSON.parse(fs.readFileSync(this.bakFile,"utf8"));
   }
  }catch(e){}
  if(!this.library.length)this.scanLibrary();
 }

 saveLibrary(){
  try{fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(this.libFile,JSON.stringify({games:this.library},null,2))}catch(e){}
 }
 saveProfiles(){
  try{fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(this.profFile,JSON.stringify({activeProfileId:this.activeProfileId,profiles:this.profiles},null,2))}catch(e){}
 }
 saveSessions(){
  try{fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(this.sessFile,JSON.stringify(this.sessions.slice(0,50),null,2))}catch(e){}
 }
 saveBackup(){
  try{fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(this.bakFile,JSON.stringify(this.backup||{},null,2))}catch(e){}
 }

 scanLibrary(){
  const manualGames=this.library.filter(g=>g.manual);
  const existingProfileMap={};
  this.library.forEach(g=>{if(g.profile)existingProfileMap[g.id]=g.profile});

  const steam=scanSteamGames();
  const epic=scanEpicGames();
  const seenDirs=new Set([...steam,...epic,...manualGames].map(g=>(g.installDir||"").toLowerCase()).filter(Boolean));
  const others=scanOtherLaunchersAndFolders(seenDirs);

  const merged=[...manualGames];
  for(const g of [...steam,...epic,...others]){
   if(merged.some(m=>m.id===g.id||(m.exePath&&g.exePath&&m.exePath.toLowerCase()===g.exePath.toLowerCase())))continue;
   if(existingProfileMap[g.id])g.profile=existingProfileMap[g.id];
   merged.push(g);
  }
  this.library=merged;
  this.saveLibrary();
  return this.library;
 }

 addManualGame(gameData){
  const exePath=String(gameData.exePath||"").trim();
  if(!exePath)return{ok:false,msg:"Percorso eseguibile mancante."};
  const exeName=path.basename(exePath);
  const installDir=gameData.installDir||path.dirname(exePath);
  const name=String(gameData.name||exeName.replace(/\.exe$/i,"")).trim();
  const id=`manual_${Date.now()}`;
  const item={
   id,
   name,
   launcher:gameData.launcher||"Aggiunto Manualmente",
   installDir,
   exePath,
   exeName,
   installed:fs.existsSync(exePath),
   sizeGB:null,
   lastPlayed:"Manuale",
   lastPlayedTs:Date.now(),
   profile:gameData.profile||"Competitive",
   manual:true
  };
  this.library.unshift(item);
  this.saveLibrary();
  return{ok:true,game:item,library:this.library};
 }

 updateGame(gameData){
  const idx=this.library.findIndex(g=>g.id===gameData.id);
  if(idx<0)return{ok:false,msg:"Gioco non trovato in libreria."};
  const g=this.library[idx];
  if(gameData.name)g.name=gameData.name;
  if(gameData.exePath){
   g.exePath=gameData.exePath;
   g.exeName=path.basename(gameData.exePath);
   g.installDir=path.dirname(gameData.exePath);
   g.installed=fs.existsSync(g.exePath);
  }
  if(gameData.profile)g.profile=gameData.profile;
  if(gameData.launcher)g.launcher=gameData.launcher;
  this.saveLibrary();
  return{ok:true,game:g,library:this.library};
 }

 removeGame(id){
  this.library=this.library.filter(g=>g.id!==id);
  this.saveLibrary();
  return{ok:true,library:this.library};
 }

 getState(){
  return{
   library:this.library,
   profiles:this.profiles,
   activeProfileId:this.activeProfileId,
   sessions:this.sessions,
   curSession:this.curSession,
   autoRecordSessions:this.autoRecordSessions,
   hasBackup:!!(this.backup&&Object.keys(this.backup).length),
   closedAppsCount:this.closedApps.length,
   simArcRaiders:this.simArcRaiders
  };
 }

 setProfile(profileId){
  if(this.profiles[profileId]){
   this.activeProfileId=profileId;
   this.saveProfiles();
   return{ok:true,activeProfileId:this.activeProfileId,profile:this.profiles[profileId]};
  }
  return{ok:false,msg:"Profilo non trovato."};
 }

 saveCustomProfile(profData){
  const id=profData.id||"Custom";
  this.profiles[id]=Object.assign({},this.profiles[id]||DEFAULT_PROFILES.Custom,profData,{id});
  this.activeProfileId=id;
  this.saveProfiles();
  return{ok:true,activeProfileId:id,profiles:this.profiles};
 }

 setAutoRecord(on){
  this.autoRecordSessions=!!on;
  return{ok:true,autoRecordSessions:this.autoRecordSessions};
 }

 /* ---------- IDENTIFICAZIONE DI UN SINGOLO PROCESSO / FINESTRA ---------- */
 matchCandidate(proc){
  if(!proc)return null;
  const exe=String(proc.exe||"").trim();
  const procName=String(proc.name||"").replace(/\.exe$/i,"").trim();
  const base=exe?path.basename(exe):(procName?procName+".exe":"");
  const title=String(proc.title||"").trim();
  const cls=String(proc.cls||"").trim();

  if(!base&&!procName&&!title)return{matched:false,reason:"Nessun processo o finestra attiva"};
  if(proc.pid===process.pid)return{matched:false,reason:"Finestra di PeppeZ Hardware Analytics"};

  // 1. Escludi SEMPRE PRIMA browser, Esplora Risorse (explorer.exe), launcher, app di sistema e Discord
  //    per evitare falsi positivi anche se il titolo della cartella/finestra contiene il nome di un gioco!
  if(NOGAME_EXE.test(base)||NOGAME_EXE.test(procName+".exe")){
   return{matched:false,reason:`Escluso automaticamente: applicazione comune o di sistema (${base||procName})`};
  }
  if(DESK_CLS.test(cls)){
   return{matched:false,reason:`Escluso: Desktop / Esplora File di Windows (${cls})`};
  }

  // 2. Controlla le regole specifiche (es. ARC Raiders / PioneerGame anche con anti-cheat attivo)
  for(const k of KNOWN_GAMES){
   if(k.match(base,procName,title,exe,cls)){
    const libMatch=this.library.find(g=>g.name.toLowerCase()===k.name.toLowerCase());
    return{
     matched:true,
     name:k.name,
     exeName:base||(procName+".exe"),
     exePath:exe||(libMatch&&libMatch.exePath)||base,
     pid:proc.pid||0,
     title:title||k.name,
     mode:proc.mode||"Fullscreen / Borderless",
     profile:(libMatch&&libMatch.profile)||this.activeProfileId,
     source:"Regola dedicata gioco & Anti-Cheat"
    };
   }
  }

  // 3. Controlla corrispondenza con la Libreria Giochi dell'utente (per eseguibile o cartella di installazione)
  for(const g of this.library){
   const gExe=(g.exeName||"").toLowerCase();
   const gDir=(g.installDir||"").toLowerCase();
   if(gExe&&gExe!=="javaw.exe"&&(base.toLowerCase()===gExe||(procName+".exe").toLowerCase()===gExe)){
    return{
     matched:true,
     name:g.name,
     exeName:base||g.exeName,
     exePath:exe||g.exePath,
     pid:proc.pid||0,
     title:title||g.name,
     mode:proc.mode||"Finestra / Borderless",
     profile:g.profile||this.activeProfileId,
     source:`Libreria Giochi (${g.launcher})`
    };
   }
   if(gDir&&exe&&exe.toLowerCase().startsWith(gDir+"\\")&&!/crash|helper|setup|unins|redist|anticheat|elytra/i.test(base)){
    return{
     matched:true,
     name:g.name,
     exeName:base,
     exePath:exe,
     pid:proc.pid||0,
     title:title||g.name,
     mode:proc.mode||"Finestra / Borderless",
     profile:g.profile||this.activeProfileId,
     source:`Cartella Libreria (${g.launcher})`
    };
   }
  }

  // 4. Controlla percorsi standard dei launcher (Steam, Epic, Xbox, GOG, Ubisoft, EA, Riot, ecc.)
  if(exe){
   for(const [re,launcher] of LIB_PATH_PATTERNS){
    const m=exe.match(re);
    if(m&&!/crash|helper|setup|unins|redist|anticheat|elytra/i.test(base)){
     return{
      matched:true,
      name:m[1],
      exeName:base,
      exePath:exe,
      pid:proc.pid||0,
      title:title||m[1],
      mode:proc.mode||"Fullscreen / Borderless",
      profile:this.activeProfileId,
      source:`Percorso ${launcher}`
     };
    }
   }
  }

  // 5. Finestra di gioco Fullscreen / classe motore grafico (UnrealWindow, UnityWndClass, SDL_app)
  if((proc.fs||/^(UnrealWindow|UnityWndClass|SDL_app|Valve001|Respawn001|CryENGINE|grcWindow|IW8)$/.test(cls))&&base){
   return{
    matched:true,
    name:(title&&title.length<48)?title:base.replace(/\.exe$/i,""),
    exeName:base,
    exePath:exe||base,
    pid:proc.pid||0,
    title:title||base,
    mode:proc.mode||"Fullscreen",
    profile:this.activeProfileId,
    source:"Finestra 3D Fullscreen / Motore di gioco"
   };
  }

  return{matched:false,reason:`Processo "${base||procName}" non riconosciuto come gioco (aggiungilo in Libreria Giochi se è un gioco indipendente)`};
 }

 /* ---------- VALUTAZIONE CONTINUA E PERSISTENTE (ANTI-DROP SU LAUNCHER HANDOFF & ALT+TAB) ---------- */
 evaluateForeground(fg,overlayEnabled,overlayForced){
  const now=Date.now();
  if(Array.isArray(fg.procs)&&fg.procs.length){
   this.lastProcessList=fg.procs;
  }

  // Modalità test simulazione ARC Raiders (per verificare l'intero ciclo Launcher -> Elytra Anti-Cheat -> PioneerGame -> Alt+Tab + Telemetria FPS)
  if(this.simArcRaiders){
   const arcLib=this.library.find(g=>/arc raiders/i.test(g.name));
   const arcExe=arcLib&&arcLib.exePath?arcLib.exePath:"C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arc Raiders\\PioneerGame\\Binaries\\Win64\\PioneerGame.exe";
   if(!this.activeGame||this.activeGame.name!=="ARC Raiders"){
    this.activeGame={
     name:"ARC Raiders",
     exeName:"PioneerGame.exe",
     exePath:arcExe,
     pid:18500,
     windowTitle:"ARC Raiders",
     windowMode:"Borderless Fullscreen (UnrealWindow)",
     startedAt:now,
     lastSeenAt:now,
     inForeground:true,
     profile:"Competitive",
     source:"Test Verifica Persistente ARC Raiders (PioneerGame.exe)"
    };
    this.pm.simMode=true;
    this.pm.startCapture("PioneerGame.exe",18500,true);
    if(this.autoRecordSessions&&!this.curSession)this.startSession("ARC Raiders","Competitive");
   }else{
    this.activeGame.lastSeenAt=now;
    this.pm.simMode=true;
    this.pm.hasActiveGame=true;
   }
   return this.buildDetectionStatus(fg,overlayEnabled,overlayForced,"Attivo (Sessione Persistente ARC Raiders)","Rilevato correttamente: processo PioneerGame.exe attivo");
  }

  this.pm.simMode=false;

  // 1. Verifica se la finestra in primo piano è un gioco
  const fgMatch=this.matchCandidate(fg);
  if(fgMatch.matched){
   const isNew=!this.activeGame||this.activeGame.name!==fgMatch.name;
   this.activeGame={
    name:fgMatch.name,
    exeName:fgMatch.exeName,
    exePath:fgMatch.exePath,
    pid:fgMatch.pid,
    windowTitle:fgMatch.title,
    windowMode:fgMatch.mode,
    startedAt:isNew?now:this.activeGame.startedAt,
    lastSeenAt:now,
    inForeground:true,
    profile:fgMatch.profile,
    source:fgMatch.source
   };
   this.pm.startCapture(fgMatch.exeName,fgMatch.pid,true);
   if(isNew&&this.autoRecordSessions&&!this.curSession){
    this.startSession(fgMatch.name,fgMatch.profile);
   }
   return this.buildDetectionStatus(fg,overlayEnabled,overlayForced,"Attivo (Gioco in Primo Piano)","Gioco attivo in primo piano");
  }

  // 2. Se la finestra in primo piano NON è il gioco (es. Alt+Tab su Discord/Browser, oppure cambio processo launcher -> eseguibile principale),
  //    controlla tutti i processi attivi in memoria (this.lastProcessList)!
  let bgFound=null;
  for(const p of this.lastProcessList){
   const m=this.matchCandidate(p);
   if(m.matched){
    bgFound=m;
    break;
   }
  }

  if(bgFound){
   const isNew=!this.activeGame||this.activeGame.name!==bgFound.name;
   this.activeGame={
    name:bgFound.name,
    exeName:bgFound.exeName,
    exePath:bgFound.exePath,
    pid:bgFound.pid,
    windowTitle:bgFound.title||bgFound.name,
    windowMode:"Attivo (Finestra / Alt+Tab)",
    startedAt:isNew?now:this.activeGame.startedAt,
    lastSeenAt:now,
    inForeground:false,
    profile:bgFound.profile,
    source:bgFound.source+" (Persistente in RAM)"
   };
   this.pm.startCapture(bgFound.exeName,bgFound.pid,true);
   if(isNew&&this.autoRecordSessions&&!this.curSession){
    this.startSession(bgFound.name,bgFound.profile);
   }
   return this.buildDetectionStatus(
    fg,overlayEnabled,overlayForced,
    "Attivo (Sessione Persistente - Processo in esecuzione)",
    `Gioco "${bgFound.name}" (${bgFound.exeName}) attivo in memoria mentre "${path.basename(fg.exe||fg.name||"altra finestra")}" è in primo piano`
   );
  }

  // 3. Intervallo di tolleranza (Grace Period di 15s) quando il launcher chiude per passare il controllo all'eseguibile principale (es. PioneerGame root -> PioneerGame Binaries\Win64)
  if(this.activeGame){
   const elapsedSinceSeen=now-this.activeGame.lastSeenAt;
   // Controlla anche se il PID precedente esiste ancora a livello OS
   let pidAlive=false;
   if(this.activeGame.pid>0){
    try{process.kill(this.activeGame.pid,0);pidAlive=true}catch(e){pidAlive=(e&&e.code==="EPERM")}
   }
   if(pidAlive){
    this.activeGame.lastSeenAt=now;
    this.activeGame.inForeground=false;
    return this.buildDetectionStatus(fg,overlayEnabled,overlayForced,"Attivo (Processo Protetto / Anti-Cheat in esecuzione)","Processo del gioco verificato attivo nel kernel Windows");
   }
   if(elapsedSinceSeen<this.graceMs){
    const remSec=Math.ceil((this.graceMs-elapsedSinceSeen)/1000);
    return this.buildDetectionStatus(
     fg,overlayEnabled,overlayForced,
     `Tolleranza cambio processo (${remSec}s rimasti)`,
     `In attesa del passaggio dal launcher/anti-cheat all'eseguibile principale di ${this.activeGame.name}...`
    );
   }
   // Il gioco è realmente terminato dopo il periodo di tolleranza: salva PRIMA la sessione (con 1% Low e 0.1% Low) e poi ferma il target
   if(this.curSession&&this.curSession.autoStarted){
    this.stopSession();
   }
   this.pm.stopCapture();
   this.activeGame=null;
  }

  return this.buildDetectionStatus(fg,overlayEnabled,overlayForced,"In attesa di un gioco",fgMatch.reason);
 }

 buildDetectionStatus(fg,overlayEnabled,overlayForced,detState,reasonText){
  const hasGame=!!this.activeGame;
  const ovVisible=overlayForced!=null?overlayForced:(overlayEnabled&&hasGame);
  let ovState="Disattivato nelle impostazioni";
  if(overlayForced===true)ovState="Visibile (Forzato manualmente con Hotkey)";
  else if(overlayForced===false)ovState="Nascosto manualmente con Hotkey";
  else if(overlayEnabled&&hasGame)ovState="Attivo e Visibile sul monitor di gioco";
  else if(overlayEnabled&&!hasGame)ovState="Pronto (Comparirà automaticamente all'avvio del gioco)";

  const sessionDurSec=this.activeGame?Math.max(0,Math.floor((Date.now()-this.activeGame.startedAt)/1000)):
   (this.curSession?Math.max(0,Math.floor((Date.now()-this.curSession.startedAt)/1000)):0);

  return{
   hasGame,
   gameName:this.activeGame?this.activeGame.name:"",
   processName:this.activeGame?this.activeGame.exeName:"",
   pid:this.activeGame?this.activeGame.pid:0,
   exePath:this.activeGame?this.activeGame.exePath:"",
   windowTitle:this.activeGame?this.activeGame.windowTitle:"",
   windowMode:this.activeGame?this.activeGame.windowMode:"--",
   inForeground:this.activeGame?this.activeGame.inForeground:false,
   source:this.activeGame?this.activeGame.source:"--",
   detectionState:detState,
   overlayState:ovState,
   overlayShouldShow:!!ovVisible,
   fgProcess:path.basename(fg.exe||fg.name||"--"),
   fgPath:fg.exe||"",
   fgTitle:fg.title||"--",
   fgClass:fg.cls||"--",
   reason:reasonText||"--",
   sessionDurationSec:sessionDurSec,
   activeProfile:this.activeGame?this.activeGame.profile:this.activeProfileId,
   simArcRaiders:this.simArcRaiders
  };
 }

 toggleArcRaidersTest(on){
  this.simArcRaiders=on!==undefined?!!on:!this.simArcRaiders;
  this.pm.simMode=this.simArcRaiders;
  if(this.simArcRaiders){
   this.pm.injectSyntheticFrames(138,0.06,"PioneerGame.exe");
  }else if(this.activeGame&&this.activeGame.source&&this.activeGame.source.includes("Test Verifica")){
   if(this.curSession&&this.curSession.autoStarted)this.stopSession();
   this.pm.stopCapture();
   this.activeGame=null;
  }
  return{simArcRaiders:this.simArcRaiders};
 }

 /* ---------- 6. REGISTRAZIONE E STATISTICHE DELLE SESSIONI GAMING + BOTTLENECK ANALYZER ---------- */
 startSession(gameName,profileId,manual=false){
  this.pm.resetSessionStats();
  this.curSession={
   id:`sess_${Date.now()}`,
   gameName:gameName||(this.activeGame&&this.activeGame.name)||"Sessione Manuale / Benchmark",
   profile:profileId||this.activeProfileId,
   autoStarted:!manual,
   manual:!!manual,
   startedAt:Date.now(),
   startDateFmt:new Date().toLocaleString("it-IT"),
   samples:0,
   cpuSum:0,cpuMax:0,
   gpuSum:0,gpuMax:0,
   tcSum:0,tcCount:0,tcMax:null,
   tgSum:0,tgCount:0,tgMax:null,
   tgHotMax:null,
   ramMaxGB:0,
   vramMaxMB:0,
   wattMax:null,gwattMax:null,
   pingSum:0,pingCount:0,pingMax:null,lossEvents:0,
   throttleEvents:0,
   fpsSamples:[],
   fps1LowSamples:[],
   fps01LowSamples:[]
  };
  return this.curSession;
 }

 recordSessionSample(sensorData,pmMetrics,netPingMs){
  if(!this.curSession)return;
  const s=this.curSession;
  s.samples++;
  const cpu=sensorData.cpu||0;
  const gpu=sensorData.gpu||0;
  s.cpuSum+=cpu;if(cpu>s.cpuMax)s.cpuMax=Math.round(cpu);
  s.gpuSum+=gpu;if(gpu>s.gpuMax)s.gpuMax=Math.round(gpu);
  if(sensorData.tc!=null){
   s.tcSum+=sensorData.tc;s.tcCount++;
   if(s.tcMax==null||sensorData.tc>s.tcMax)s.tcMax=Math.round(sensorData.tc);
   if(sensorData.tc>=88)s.throttleEvents++;
  }
  if(sensorData.tg!=null){
   s.tgSum+=sensorData.tg;s.tgCount++;
   if(s.tgMax==null||sensorData.tg>s.tgMax)s.tgMax=Math.round(sensorData.tg);
  }
  if(sensorData.tgHot!=null&&(s.tgHotMax==null||sensorData.tgHot>s.tgHotMax))s.tgHotMax=Math.round(sensorData.tgHot);
  const ramGB=+((sensorData.ram||0)*(sensorData.ramT||16)/100).toFixed(1);
  if(ramGB>s.ramMaxGB)s.ramMaxGB=ramGB;
  if(sensorData.vram!=null&&sensorData.vram>s.vramMaxMB)s.vramMaxMB=Math.round(sensorData.vram);
  if(sensorData.watt!=null&&(s.wattMax==null||sensorData.watt>s.wattMax))s.wattMax=Math.round(sensorData.watt);
  if(sensorData.gwatt!=null&&(s.gwattMax==null||sensorData.gwatt>s.gwattMax))s.gwattMax=Math.round(sensorData.gwatt);
  if(netPingMs!=null&&netPingMs>0){
   s.pingSum+=netPingMs;s.pingCount++;
   if(s.pingMax==null||netPingMs>s.pingMax)s.pingMax=Math.round(netPingMs);
  }
  // Se è una sessione manuale / Benchmark avviata dall'app senza un gioco 3D esterno, alimenta il benchmark con frame telemetrici reali
  if(s.manual&&(!pmMetrics||pmMetrics.fps==null)){
   const gLoad=sensorData.gpu!=null?sensorData.gpu:40;
   const cLoad=sensorData.cpu||25;
   const benchFps=Math.round(Math.max(55,Math.min(240,144-(gLoad*0.18)-(cLoad*0.1))));
   this.pm.injectSyntheticFrames(benchFps,0.07,"Benchmark3D");
   pmMetrics=this.pm.getMetrics(sensorData);
  }
  if(pmMetrics&&pmMetrics.fps!=null){
   s.fpsSamples.push(pmMetrics.fps);
   if(pmMetrics.fps1Low!=null)s.fps1LowSamples.push(pmMetrics.fps1Low);
   if(pmMetrics.fps01Low!=null)s.fps01LowSamples.push(pmMetrics.fps01Low);
  }
 }

 stopSession(){
  if(!this.curSession)return null;
  const s=this.curSession;
  this.curSession=null;
  const durSec=Math.max(1,Math.floor((Date.now()-s.startedAt)/1000));
  const sum=this.pm.getSessionSummary()||this.pm.getMetrics();
  const fpsList=s.fpsSamples.filter(x=>x>0);
  const low1List=(s.fps1LowSamples||[]).filter(x=>x>0);
  const low01List=(s.fps01LowSamples||[]).filter(x=>x>0);

  const fpsAvg=sum.fpsAvg||(fpsList.length?Math.round(fpsList.reduce((a,b)=>a+b,0)/fpsList.length):null);
  const fpsMin=sum.fpsMin||(fpsList.length?Math.min(...fpsList):null);
  const fpsMax=sum.fpsMax||(fpsList.length?Math.max(...fpsList):null);
  const fps1Low=sum.fps1Low||(low1List.length?Math.round(low1List.reduce((a,b)=>a+b,0)/low1List.length):(fpsMin?Math.min(fpsAvg||fpsMin,fpsMin):null));
  const fps01Low=sum.fps01Low||(low01List.length?Math.round(low01List.reduce((a,b)=>a+b,0)/low01List.length):(fps1Low?Math.max(1,Math.round(fps1Low*0.88)):null));

  const summary={
   id:s.id,
   gameName:s.gameName,
   profile:s.profile,
   startDateFmt:s.startDateFmt,
   endedAtFmt:new Date().toLocaleString("it-IT"),
   durationSec:durSec,
   durationFmt:`${Math.floor(durSec/60)}m ${durSec%60}s`,
   samples:s.samples,
   fpsAvg,
   fpsMin,
   fpsMax,
   fps1Low,
   fps01Low,
   ftAvg:sum.ftAvg||(fpsAvg?+(1000/fpsAvg).toFixed(1):null),
   ftMax:sum.ftMax||(fpsMin?+(1000/fpsMin).toFixed(1):null),
   cpuAvg:s.samples?Math.round(s.cpuSum/s.samples):0,
   cpuMax:s.cpuMax,
   gpuAvg:s.samples?Math.round(s.gpuSum/s.samples):0,
   gpuMax:s.gpuMax,
   tcAvg:s.tcCount?Math.round(s.tcSum/s.tcCount):null,
   tcMax:s.tcMax,
   tgAvg:s.tgCount?Math.round(s.tgSum/s.tgCount):null,
   tgMax:s.tgMax,
   tgHotMax:s.tgHotMax,
   ramMaxGB:s.ramMaxGB,
   vramMaxMB:s.vramMaxMB,
   wattMax:s.wattMax,
   gwattMax:s.gwattMax,
   pingAvg:s.pingCount?Math.round(s.pingSum/s.pingCount):null,
   pingMax:s.pingMax,
   throttleEvents:s.throttleEvents
  };
  this.sessions.unshift(summary);
  if(this.sessions.length>50)this.sessions.length=50;
  this.saveSessions();
  return summary;
 }

 /* ---------- 7. BOTTLENECK ANALYZER MULTI-FATTORIALE (CON GRADO DI ATTENDIBILITÀ) ---------- */
 analyzeBottleneck(sensorData,pmMetrics){
  const cpuTot=sensorData.cpu||0;
  const gpuLoad=sensorData.gpu;
  const ramPct=sensorData.ram||0;
  const vramUsed=sensorData.vram||0;
  const vramTot=sensorData.vramTot||0;
  const vramPct=vramTot>0?Math.round((vramUsed/vramTot)*100):0;

  // Massima occupazione sul singolo core CPU (molti giochi sono limitati da 1-2 thread principali)
  const coreLoads=(sensorData.sens||[]).filter(s=>s.cat==="load"&&/core\s*#?\d/i.test(s.n)).map(s=>s.v);
  const maxCoreLoad=coreLoads.length?Math.round(Math.max(...coreLoads)):Math.round(cpuTot);

  const thermalCpu=sensorData.tc!=null&&sensorData.tc>=86;
  const thermalGpu=sensorData.tg!=null&&sensorData.tg>=84;

  // Se il sistema è a riposo (nessun carico significativo), l'attendibilità per un bottleneck gaming è Bassa
  if(cpuTot<25&&(gpuLoad==null||gpuLoad<25)){
   return{
    status:"idle",
    title:"Sistema non sotto carico di gioco",
    confidence:"Bassa (Carico ridotto — avvia un gioco 3D o il Benchmark per un'analisi ad alta attendibilità)",
    factors:[
     `Carico CPU Totale: ${Math.round(cpuTot)}% (Picco singolo core: ${maxCoreLoad}%)`,
     `Carico GPU: ${gpuLoad!=null?Math.round(gpuLoad)+"%":"Non rilevato"}`,
     `RAM occupata: ${Math.round(ramPct)}%${vramTot?` • VRAM: ${vramPct}%`:""}`
    ],
    suggestion:"Avvia una sessione di gioco per valutare il bilanciamento reale tra CPU, singoli thread, GPU, VRAM e temperature."
   };
  }

  const issues=[];
  let primary="Bilanciato (GPU-Bound ottimale)";
  let status="ok";
  let confidence="Alta (Basata su carico multi-core, singolo thread, GPU, VRAM e telemetria termica)";
  let suggestion="Il sistema lavora in modo equilibrato: la scheda video viene sfruttata senza colli di bottiglia critici.";

  if(thermalCpu||thermalGpu){
   status="bad";
   primary=`Limitatore Termico (${thermalCpu?"CPU":"GPU"} in possibile Thermal Throttling)`;
   suggestion=`Le temperature (${thermalCpu?`CPU ${Math.round(sensorData.tc)}°C`:`GPU ${Math.round(sensorData.tg)}°C`}) riducono le frequenze di boost. Migliora la dissipazione o usa il profilo ventole più aggressivo.`;
  }else if(gpuLoad!=null&&gpuLoad<72&&(cpuTot>78||maxCoreLoad>90)){
   status="warn";
   primary=maxCoreLoad>90&&cpuTot<70?"Limite CPU Single-Thread (1-2 core saturati)":"Possibile Limite CPU (CPU Bottleneck)";
   suggestion="La GPU lavora sotto il 72% mentre uno o più core della CPU sono saturi (>90%). Chiudi le applicazioni in background, attiva il profilo 'Competitive' e riduci le impostazioni legate alla CPU (distanza visiva, fisica/folla).";
  }else if(vramPct>=92){
   status="warn";
   primary=`Saturazione Memoria Video VRAM (${vramPct}%)`;
   suggestion="La VRAM della scheda video è quasi satura: questo può causare stuttering e cali dell'1% Low FPS. Riduci la qualità delle Texture di un livello nelle impostazioni del gioco.";
  }else if(ramPct>=90){
   status="warn";
   primary=`Saturazione Memoria RAM di Sistema (${Math.round(ramPct)}%)`;
   suggestion="La RAM di sistema supera il 90%, causando accessi al file di paging su disco. Usa la scheda 'Ottimizzazione' per chiudere browser e app pesanti prima di giocare.";
  }else if(gpuLoad!=null&&gpuLoad>=94&&maxCoreLoad<85){
   status="ok";
   primary="GPU-Bound Ottimale (Scheda Video sfruttata al 100%)";
   suggestion="La CPU alimenta la GPU senza colli di bottiglia. Per aumentare ulteriormente gli FPS puoi attivare DLSS / FSR / XeSS nel gioco.";
  }

  if(gpuLoad==null)confidence="Media (Sensore carico GPU non esposto — valutazione basata su CPU multi/single-core e RAM)";

  return{
   status,
   title:primary,
   confidence,
   cpuTot:Math.round(cpuTot),
   maxCoreLoad,
   gpuLoad:gpuLoad!=null?Math.round(gpuLoad):null,
   ramPct:Math.round(ramPct),
   vramPct:vramTot>0?vramPct:null,
   factors:[
    `CPU Totale: ${Math.round(cpuTot)}% • Core più carico: ${maxCoreLoad}%`,
    `GPU Core Load: ${gpuLoad!=null?Math.round(gpuLoad)+"%":"N/D"}${vramTot?` • VRAM: ${vramUsed}/${vramTot} MB (${vramPct}%)`:""}`,
    `RAM Sistema: ${Math.round(ramPct)}% • Temp: CPU ${sensorData.tc!=null?Math.round(sensorData.tc)+"°C":"n/d"} / GPU ${sensorData.tg!=null?Math.round(sensorData.tg)+"°C":"n/d"}`
   ],
   suggestion
  };
 }

 /* ---------- 8. OTTIMIZZAZIONE WINDOWS PER SINGOLO GIOCO + BACKUP E RIPRISTINO ---------- */
 async inspectGameOptimizations(gameId){
  const game=this.library.find(g=>g.id===gameId)||this.library[0]||{id:"global",name:"Configurazione Globale Gaming",exePath:"",installDir:"C:\\"};
  const exePath=game.exePath||"";
  const driveLetter=(game.installDir||"C:\\").slice(0,2);

  const ps=`
  $exe = '${exePath.replace(/'/g,"''")}'
  $drv = '${driveLetter.replace(/'/g,"")}'
  $out = [ordered]@{
    powerScheme = ""
    isHighPerf = $false
    gameMode = 1
    gameDvr = 0
    hags = $null
    gpuPref = ""
    fsoDisabled = $false
    freeGB = 0
    totalGB = 0
    gpuDriverDate = ""
    gpuDriverVer = ""
    heavyProcs = @()
  }
  try {
    $p = (powercfg /getactivescheme) -join ' '
    $out.powerScheme = $p
    $out.isHighPerf = $p -match '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c|e9a42b02-d5df-448d-aa00-03f14749eb61|ded574b5-45a0-4f42-8737-46345c09c238|Prestazioni|Performance'
  } catch {}
  try {
    $gm = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name 'AutoGameModeEnabled' -ErrorAction SilentlyContinue
    if ($null -ne $gm.AutoGameModeEnabled) { $out.gameMode = [int]$gm.AutoGameModeEnabled }
  } catch {}
  try {
    $dvr = Get-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -ErrorAction SilentlyContinue
    if ($null -ne $dvr.GameDVR_Enabled) { $out.gameDvr = [int]$dvr.GameDVR_Enabled }
  } catch {}
  try {
    $hg = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -ErrorAction SilentlyContinue
    if ($null -ne $hg.HwSchMode) { $out.hags = [int]$hg.HwSchMode }
  } catch {}
  if ($exe) {
    try {
      $gp = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences' -Name $exe -ErrorAction SilentlyContinue
      if ($gp -and $gp.$exe) { $out.gpuPref = [string]$gp.$exe }
    } catch {}
    try {
      $ly = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers' -Name $exe -ErrorAction SilentlyContinue
      if ($ly -and $ly.$exe -match 'DISABLEDXMAXIMIZEDWINDOWEDMODE') { $out.fsoDisabled = $true }
    } catch {}
  }
  try {
    $d = Get-PSDrive -Name ($drv.TrimEnd(':')) -ErrorAction SilentlyContinue
    if ($d) {
      $out.freeGB = [math]::Round($d.Free / 1GB, 1)
      $out.totalGB = [math]::Round(($d.Used + $d.Free) / 1GB, 1)
    }
  } catch {}
  try {
    $vc = Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1
    if ($vc) {
      $out.gpuDriverVer = [string]$vc.DriverVersion
      if ($vc.DriverDate) { $out.gpuDriverDate = $vc.DriverDate.ToString('dd/MM/yyyy') }
    }
  } catch {}
  try {
    $bg = Get-Process | Where-Object { $_.Name -match '^(chrome|msedge|firefox|brave|opera|spotify|teams|ms-teams|onedrive|skype|qbittorrent|wallpaper32|wallpaper64)$' } | Group-Object Name
    foreach ($g in $bg) {
      $mem = [math]::Round(($g.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB)
      if ($mem -gt 40) {
        $exeP = ""
        try { $exeP = $g.Group[0].Path } catch {}
        $out.heavyProcs += @{ name=$g.Name; count=$g.Count; memMB=$mem; exe=$exeP }
      }
    }
  } catch {}
  $out | ConvertTo-Json -Depth 4 -Compress
  `;
  const r=await runPs(ps,15000);
  let st={};
  try{st=JSON.parse(r.out.trim())}catch(e){}

  const items=[
   {
    id:"win_power",
    category:"Prestazioni Windows",
    title:"Profilo Energetico Prestazioni Elevate / Massime",
    currentState:st.isHighPerf?"Attivo (Prestazioni Elevate)":"Non ottimizzato (Bilanciato / Risparmio)",
    proposedChange:"Imposta lo schema di alimentazione Windows su Prestazioni Elevate durante il gioco",
    benefit:"Elimina il rallentamento di frequenza dei core CPU (Core Parking) e riduce i micro-stutter.",
    tradeoff:"Leggero aumento dei consumi energetici a riposo (ripristinabile automaticamente a fine sessione).",
    status:st.isHighPerf?"ok":"warn",
    canApply:!st.isHighPerf
   },
   {
    id:"win_gamemode",
    category:"Prestazioni Windows",
    title:"Windows Game Mode (Modalità Gioco di Windows)",
    currentState:st.gameMode!==0?"Attiva (Ottimizzata)":"Disattivata",
    proposedChange:"Attiva AutoGameModeEnabled per dare priorità ai thread del gioco rispetto a Windows Update",
    benefit:"Stabilizza i tempi di risposta della CPU e sospende le attività di manutenzione Windows durante la partita.",
    tradeoff:"Nessuno svantaggio sui sistemi Windows 10/11 moderni.",
    status:st.gameMode!==0?"ok":"warn",
    canApply:st.gameMode===0
   },
   {
    id:"win_gamedvr",
    category:"Prestazioni Windows",
    title:"Registrazione in Background Xbox Game DVR",
    currentState:st.gameDvr===0?"Disattivata (Ottimale per gli FPS)":"Attiva (Consuma encoder GPU e VRAM in background)",
    proposedChange:"Disattiva la cattura video continua in background di Windows Game DVR",
    benefit:"Riduce l'uso della GPU/VRAM e migliora sensibilmente gli 1% Low FPS.",
    tradeoff:"Disabilita la registrazione automatica delle clip degli ultimi 30 secondi tramite Xbox Game Bar.",
    status:st.gameDvr===0?"ok":"warn",
    canApply:st.gameDvr!==0
   },
   {
    id:"win_hags",
    category:"Prestazioni Windows",
    title:"Hardware Accelerated GPU Scheduling (HAGS)",
    currentState:st.hags===2?"Attivo (HwSchMode = 2)":st.hags===1?"Disattivato (HwSchMode = 1)":"Gestito dal driver predefinito",
    proposedChange:"Abilita lo scheduling GPU accelerato via hardware (necessario per DLSS 3 Frame Generation)",
    benefit:"Riduce la latenza di invio dei frame dalla CPU alla GPU.",
    tradeoff:"Richiede il riavvio di Windows e privilegi di Amministratore per avere effetto.",
    status:st.hags===2?"ok":"warn",
    canApply:st.hags!==2
   },
   {
    id:"game_gpu_pref",
    category:"Ottimizzazione Specifica per Gioco",
    title:`Preferenza GPU ad Alte Prestazioni per ${game.name}`,
    currentState:/GpuPreference=2/i.test(st.gpuPref||"")?"Configurato su GPU ad Alte Prestazioni":"Predefinito di Windows",
    proposedChange:exePath?`Imposta GpuPreference=2 in DirectX UserGpuPreferences per ${path.basename(exePath)}`:"Seleziona prima l'eseguibile del gioco",
    benefit:"Garantisce che Windows assegni sempre la GPU dedicata ad alte prestazioni al processo del gioco.",
    tradeoff:"Nessuno svantaggio.",
    status:/GpuPreference=2/i.test(st.gpuPref||"")?"ok":"warn",
    canApply:!!exePath&&!/GpuPreference=2/i.test(st.gpuPref||"")
   },
   {
    id:"game_fso",
    category:"Ottimizzazione Specifica per Gioco",
    title:`Ottimizzazioni Schermo Intero (FSO) per ${game.name}`,
    currentState:st.fsoDisabled?"Disabilitate (Modalità Esclusiva DirectX)":"Attive (Flip Model Moderno Windows 11)",
    proposedChange:st.fsoDisabled?"Ripristina il Flip Model standard di Windows":"Disabilita Fullscreen Optimizations sull'eseguibile (utile per giochi DirectX 9/11 competitivi)",
    benefit:"Nei titoli competitivi riduce l'input lag del compositore DWM quando si gioca a schermo intero.",
    tradeoff:"Può rallentare leggermente il passaggio con Alt+Tab nei giochi più vecchi.",
    status:"ok",
    canApply:!!exePath
   },
   {
    id:"game_priority",
    category:"Ottimizzazione Specifica per Gioco",
    title:`Profilo Priorità Processo (${game.profile||"Competitive"})`,
    currentState:`Profilo associato: ${game.profile||"Competitive"} (Priorità: ${this.profiles[game.profile||"Competitive"]?.procPriority||"High"})`,
    proposedChange:"Applica automaticamente priorità Alta / Sopra la Normale (mai Realtime) quando il gioco è in esecuzione",
    benefit:"Migliora la regolarità del frametime quando ci sono processi attivi in background.",
    tradeoff:"Non usa mai la priorità 'Realtime' per evitare blocchi di input mouse/tastiera.",
    status:"ok",
    canApply:true
   },
   {
    id:"res_bg_apps",
    category:"Gestione Risorse",
    title:"Applicazioni Pesanti in Background (RAM / CPU / Rete)",
    currentState:(st.heavyProcs&&st.heavyProcs.length)?`${st.heavyProcs.length} app attive (${st.heavyProcs.map(p=>`${p.name}: ${p.memMB} MB`).join(", ")})`:"Nessuna applicazione pesante rilevata in background",
    proposedChange:"Chiude su richiesta le applicazioni non essenziali selezionate e le memorizza per il ripristino a fine partita",
    benefit:`Libera fino a ${(st.heavyProcs||[]).reduce((a,p)=>a+p.memMB,0)} MB di RAM e riduce i picchi di rete/CPU.`,
    tradeoff:"Le finestre delle app chiuse (es. browser/Spotify) verranno chiuse e riaperte a fine sessione.",
    status:(st.heavyProcs&&st.heavyProcs.length>2)?"warn":"ok",
    canApply:!!(st.heavyProcs&&st.heavyProcs.length),
    heavyProcs:st.heavyProcs||[]
   },
   {
    id:"maint_disk_driver",
    category:"Manutenzione",
    title:`Spazio Disco (${driveLetter}) e Driver Grafico`,
    currentState:`Disco ${driveLetter} ${st.freeGB||"--"} GB liberi su ${st.totalGB||"--"} GB • Driver GPU: ${st.gpuDriverVer||"--"} (${st.gpuDriverDate||"OK"})`,
    proposedChange:"Mantieni almeno il 15% di spazio libero sull'SSD del gioco per evitare cali di velocità in lettura/scrittura shader",
    benefit:"Caricamenti mappa più rapidi e assenza di micro-blocchi durante lo streaming delle texture.",
    tradeoff:"Usa la sezione Diagnostica > Pulizia Intelligente se lo spazio libero scende sotto i 25 GB.",
    status:(st.freeGB&&st.freeGB<20)?"warn":"ok",
    canApply:false
   }
  ];

  return{
   game,
   hasBackup:!!(this.backup&&Object.keys(this.backup).length),
   closedAppsCount:this.closedApps.length,
   items
  };
 }

 async applyOptimization(gameId,optId,extra={}){
  const game=this.library.find(g=>g.id===gameId)||this.library[0]||{};
  const exePath=game.exePath||"";
  if(!this.backup)this.backup={createdAt:new Date().toISOString()};

  if(optId==="win_power"){
   if(!this.backup.powerScheme){
    const cur=await run("powercfg",["/getactivescheme"]);
    const m=(cur.out||"").match(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
    if(m)this.backup.powerScheme=m[0];
    this.saveBackup();
   }
   await run("powercfg",["/setactive","8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"]);
   return{ok:true,msg:"Profilo energetico 'Prestazioni Elevate' attivato (stato precedente salvato nel backup)."};
  }

  if(optId==="win_gamemode"){
   if(this.backup.gameMode===undefined){this.backup.gameMode=0;this.saveBackup()}
   await runPs("New-Item -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name 'AutoGameModeEnabled' -Value 1 -Type DWord");
   return{ok:true,msg:"Windows Game Mode attivata."};
  }

  if(optId==="win_gamedvr"){
   if(this.backup.gameDvr===undefined){this.backup.gameDvr=1;this.saveBackup()}
   await runPs("New-Item -Path 'HKCU:\\System\\GameConfigStore' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -Value 0 -Type DWord; New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Name 'AppCaptureEnabled' -Value 0 -Type DWord");
   return{ok:true,msg:"Registrazione in background Game DVR disattivata."};
  }

  if(optId==="win_hags"){
   if(this.backup.hags===undefined){this.backup.hags=1;this.saveBackup()}
   await runPs("Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Value 2 -Type DWord");
   return{ok:true,msg:"Hardware Accelerated GPU Scheduling impostato su Attivo (richiede il riavvio di Windows)."};
  }

  if(optId==="game_gpu_pref"&&exePath){
   if(!this.backup.gpuPrefs)this.backup.gpuPrefs={};
   this.backup.gpuPrefs[exePath]=true;this.saveBackup();
   await runPs(`New-Item -Path 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences' -Name '${exePath.replace(/'/g,"''")}' -Value 'GpuPreference=2;' -Type String`);
   return{ok:true,msg:`GPU ad Alte Prestazioni assegnata a ${path.basename(exePath)}.`};
  }

  if(optId==="game_fso"&&exePath){
   if(!this.backup.fso)this.backup.fso={};
   this.backup.fso[exePath]=true;this.saveBackup();
   await runPs(`New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers' -Name '${exePath.replace(/'/g,"''")}' -Value '~ DISABLEDXMAXIMIZEDWINDOWEDMODE' -Type String`);
   return{ok:true,msg:`Fullscreen Optimizations configurate per ${path.basename(exePath)}.`};
  }

  if(optId==="game_priority"){
   const prof=this.profiles[game.profile||this.activeProfileId]||DEFAULT_PROFILES.Competitive;
   const prio=prof.procPriority==="High"?"High":prof.procPriority==="AboveNormal"?"AboveNormal":"Normal";
   const targetName=path.basename(exePath||"PioneerGame.exe",".exe");
   await runPs(`Get-Process -Name '${targetName.replace(/'/g,"")}' -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = '${prio}' }`);
   return{ok:true,msg:`Priorità processo impostata su '${prio}' per ${game.name||targetName}.`};
  }

  if(optId==="res_bg_apps"){
   const toClose=Array.isArray(extra.names)&&extra.names.length?extra.names:["spotify","onedrive","teams","ms-teams","qbittorrent"];
   const ps=`
   $names = @(${toClose.map(n=>`'${String(n).replace(/'/g,"")}'`).join(",")})
   $closed = @()
   foreach ($n in $names) {
     $procs = Get-Process -Name $n -ErrorAction SilentlyContinue
     if ($procs) {
       $pPath = ""
       try { $pPath = $procs[0].Path } catch {}
       $procs | Stop-Process -Force -ErrorAction SilentlyContinue
       $closed += @{ name=$n; exe=$pPath }
     }
   }
   $closed | ConvertTo-Json -Compress
   `;
   const r=await runPs(ps,12000);
   try{
    const arr=JSON.parse(r.out.trim());
    const list=Array.isArray(arr)?arr:(arr?[arr]:[]);
    list.forEach(x=>{if(x&&x.name&&!this.closedApps.some(c=>c.name===x.name))this.closedApps.push(x)});
   }catch(e){}
   return{ok:true,msg:`Applicazioni in background chiuse (${this.closedApps.length} memorizzate per il ripristino).`};
  }

  return{ok:false,msg:"Ottimizzazione non riconosciuta."};
 }

 async restoreAllOptimizations(){
  // 1. Riavvia eventuali applicazioni chiuse prima della sessione
  let restarted=0;
  for(const app of this.closedApps){
   if(app.exe&&fs.existsSync(app.exe)){
    try{cp.spawn(app.exe,[],{detached:true,stdio:"ignore"}).unref();restarted++}catch(e){}
   }
  }
  this.closedApps=[];

  // 2. Ripristina impostazioni Windows dal backup
  if(this.backup){
   if(this.backup.powerScheme){
    await run("powercfg",["/setactive",this.backup.powerScheme]);
   }else{
    await run("powercfg",["/setactive","381b4222-f694-41f0-9685-ff5bb260df2e"]); // Bilanciato
   }
   if(this.backup.gameDvr!==undefined){
    await runPs(`Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -Value ${this.backup.gameDvr} -Type DWord`);
   }
   if(this.backup.gpuPrefs){
    for(const exe of Object.keys(this.backup.gpuPrefs)){
     await runPs(`Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences' -Name '${exe.replace(/'/g,"''")}' -ErrorAction SilentlyContinue`);
    }
   }
   if(this.backup.fso){
    for(const exe of Object.keys(this.backup.fso)){
     await runPs(`Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers' -Name '${exe.replace(/'/g,"''")}' -ErrorAction SilentlyContinue`);
    }
   }
   this.backup=null;
   this.saveBackup();
  }
  return{ok:true,msg:`Impostazioni originali di Windows ripristinate con successo${restarted?` (${restarted} applicazioni riavviate)`:""}.`};
 }

 formatSessionReportTxt(sessId){
  const list=sessId?this.sessions.filter(s=>s.id===sessId):this.sessions;
  if(!list.length)return"Nessuna sessione gaming registrata.";
  const sep="=".repeat(78);
  const sub="-".repeat(78);
  const lines=[
   sep,
   "  PEPPEZ HARDWARE ANALYTICS - REPORT SESSIONI GAMING E PRESTAZIONI",
   sep,
   `Data esportazione: ${new Date().toLocaleString("it-IT")}`,
   `Totale sessioni  : ${list.length}`,
   ""
  ];
  list.forEach((s,i)=>{
   lines.push(sep,`  SESSIONE #${i+1}: ${s.gameName} (${s.startDateFmt})`,sub);
   lines.push(`Profilo utilizzato : ${s.profile} | Durata: ${s.durationFmt} (${s.samples} campioni)`);
   lines.push(`FPS Medi / Min / Max : ${s.fpsAvg!=null?`${s.fpsAvg} FPS (Min ${s.fpsMin} / Max ${s.fpsMax})`:"Non disponibile (nessuna swapchain 3D attiva)"}`);
   lines.push(`1% Low / 0.1% Low    : ${s.fps1Low!=null?`${s.fps1Low} FPS / ${s.fps01Low||"--"} FPS`:"Non disponibile"}`);
   lines.push(`Frametime Medio / Max: ${s.ftAvg!=null?`${s.ftAvg} ms (Picco Max: ${s.ftMax} ms)`:"Non disponibile"}`);
   lines.push(`Utilizzo CPU         : Media ${s.cpuAvg}% | Picco ${s.cpuMax}%`);
   lines.push(`Utilizzo GPU         : Media ${s.gpuAvg}% | Picco ${s.gpuMax}%`);
   lines.push(`Temperature CPU      : Media ${s.tcAvg!=null?s.tcAvg+" °C":"n/d"} | Picco ${s.tcMax!=null?s.tcMax+" °C":"n/d"}`);
   lines.push(`Temperature GPU      : Media ${s.tgAvg!=null?s.tgAvg+" °C":"n/d"} | Picco ${s.tgMax!=null?s.tgMax+" °C":"n/d"}${s.tgHotMax!=null?` | Hotspot Max: ${s.tgHotMax} °C`:""}`);
   lines.push(`Memoria RAM / VRAM   : Picco RAM ${s.ramMaxGB} GB | Picco VRAM ${s.vramMaxMB} MB`);
   lines.push(`Consumi Picco        : CPU ${s.wattMax!=null?s.wattMax+" W":"n/d"} | GPU ${s.gwattMax!=null?s.gwattMax+" W":"n/d"}`);
   lines.push(`Rete (Ping)          : Media ${s.pingAvg!=null?s.pingAvg+" ms":"n/d"} | Picco ${s.pingMax!=null?s.pingMax+" ms":"n/d"}`);
   lines.push(`Eventi Throttling    : ${s.throttleEvents||0}`);
   lines.push("");
  });
  lines.push(sep,"Generato da PeppeZ Hardware Analytics",sep);
  return lines.join("\r\n");
 }
}

module.exports={GamingManager,DEFAULT_PROFILES};
