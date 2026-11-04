const {app,BrowserWindow,ipcMain,globalShortcut,screen,Tray,Menu,nativeImage,shell,dialog}=require("electron");
const path=require("path"),fs=require("fs"),cp=require("child_process");
const sensors=require("./sensors");
const diagnostics=require("./diagnostics");
const network=require("./network");
const {GamingManager}=require("./gaming");
const diskanalyzer=require("./diskanalyzer");
if(!app.requestSingleInstanceLock()){app.quit();process.exit(0)}
const dir=app.getPath("userData"),
 POS=path.join(dir,"widget-pos.json"),
 WCFG=path.join(dir,"widgets.json"),
 SET=path.join(dir,"settings.json"),
 HWNDS=path.join(dir,"widget-hwnds.json"),
 DHIST=path.join(dir,"diag-history.json");
const icon=path.join(__dirname,"assets","icon.png"),preload=path.join(__dirname,"preload.js");
const gamingMgr=new GamingManager(dir,path.join(__dirname,"assets"));
let win,tray,ov=null,ovCfg=null,quitting=false,wins=[],pos={},wcfg=null,wShown=true,settings={widgetsAuto:true,top:false};
let game="",onDesk=true,ovForce=null,hkCur="",ovDisp=null,fgProc=null,diagHistory=[],lastDiagReport=null;
let lastFg={exe:"",name:"",title:"",cls:"",pid:0,fs:false,mode:"Windowed",x:0,y:0,procs:[]};
let lastGameDiag=null,lastNetPingMs=null,lastNetJitterMs=null,lastNetLossPct=0,lastPingCheckTs=0,pingBusy=false;
try{pos=JSON.parse(fs.readFileSync(POS,"utf8"))}catch(e){}
try{wcfg=JSON.parse(fs.readFileSync(WCFG,"utf8"))}catch(e){}
try{
 Object.assign(settings,JSON.parse(fs.readFileSync(SET,"utf8")));
 if(settings.overlay&&typeof settings.overlay==="object")ovCfg=settings.overlay;
}catch(e){}
try{const dh=JSON.parse(fs.readFileSync(DHIST,"utf8"));if(Array.isArray(dh.history))diagHistory=dh.history;if(dh.lastReport)lastDiagReport=dh.lastReport}catch(e){}
const save=(f,o)=>{try{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(f,JSON.stringify(o))}catch(e){}};
const run=(cmd,args,opt)=>new Promise(r=>cp.execFile(cmd,args,Object.assign({windowsHide:true,timeout:120000},opt||{}),(err,out)=>r({err,out:String(out||"")})));
const psq=s=>`'${String(s).replace(/'/g,"''")}'`;

function createMain(){
 win=new BrowserWindow({
  width:1680,height:950,minWidth:1024,minHeight:660,
  backgroundColor:"#050914",icon,title:"PeppeZ Hardware Analytics",
  autoHideMenuBar:true,show:!process.argv.includes("--hidden"),
  webPreferences:{preload}
 });
 win.setMenu(null);win.loadFile(path.join("app","index.html"));
 win.on("close",e=>{if(!quitting){e.preventDefault();win.hide()}});
}

/* ---------- WIDGET DESKTOP PERSISTENTI ---------- */
function getHwndStr(w){
 try{
  const b=w.getNativeWindowHandle();
  if(b.length>=8)return String(b.readBigUInt64LE(0));
  if(b.length>=4)return String(b.readUInt32LE(0));
 }catch(e){}
 return null;
}
function writeWidgetHwnds(){
 const hwnds=wins.filter(w=>!w.isDestroyed()).map(getHwndStr).filter(Boolean);
 save(HWNDS,{top:!!settings.top,hwnds,ts:Date.now()});
}
function clearWidgets(){wins.forEach(w=>{if(!w.isDestroyed())w.destroy()});wins=[];writeWidgetHwnds()}
const widgetsWanted=()=>!!wShown;
function syncWidgets(){
 const show=widgetsWanted();
 wins.forEach(w=>{
  if(w.isDestroyed())return;
  if(settings.top){
   w.setAlwaysOnTop(true,"screen-saver");
  }else{
   w.setAlwaysOnTop(false);
  }
  if(show&&!w.isVisible())w.showInactive();
  else if(!show&&w.isVisible())w.hide();
 });
 writeWidgetHwnds();
}
function applyWidgets(p,fromApp){
 clearWidgets();wcfg=p;save(WCFG,p);
 if(fromApp)wShown=true;
 (p.list||[]).forEach(c=>{
  const sp=pos[c.id]||{x:80+(c.x||0),y:80+(c.y||0)};
  const initW=Math.max(150,Math.round(c.w||260)),initH=Math.max(90,Math.round(c.h||160));
  const w=new BrowserWindow({
   x:Math.round(sp.x),y:Math.round(sp.y),width:initW,height:initH,
   frame:false,transparent:true,alwaysOnTop:!!settings.top,
   skipTaskbar:true,minimizable:false,maximizable:false,fullscreenable:false,
   hasShadow:false,show:false,resizable:true,focusable:true,
   webPreferences:{preload}
  });
  w._wid=c.id;
  w.loadFile(path.join("app","widget.html"),{query:{mode:"widget"}});
  w.webContents.on("did-finish-load",()=>{
   if(w.isDestroyed())return;
   w.webContents.send("cfg",Object.assign({},c,{unit:p.unit}));
   syncWidgets();
  });
  w.on("minimize",e=>{e.preventDefault();w.restore();syncWidgets()});
  w.on("moved",()=>{
   if(w.isDestroyed())return;
   const b=w.getBounds();pos[c.id]={x:b.x,y:b.y};save(POS,pos);
  });
  wins.push(w);
 });
 syncWidgets();
}

/* ---------- GIOCHI: RILEVAMENTO PERSISTENTE MULTI-LIVELLO (ARC RAIDERS, ANTI-CHEAT, ALT+TAB) ---------- */
const DESK=/^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd|TopLevelWindowForOverflowWindow|NotifyIconOverflowWindow)$/;
const KEEP=/^(searchhost|startmenuexperiencehost|shellexperiencehost|textinputhost|lockapp)\.exe$/i;
let ovPoint=null;

function onFg(f){
 const base=path.basename(f.exe||(f.name?f.name+".exe":""));
 if(KEEP.test(base)){
  if(Array.isArray(f.procs)&&f.procs.length)lastFg.procs=f.procs;
  return;
 }
 lastFg=Object.assign({},lastFg,f);
 if(Array.isArray(f.procs)&&f.procs.length)lastFg.procs=f.procs;
 const own=f.pid===process.pid,widgetFocus=own&&wins.some(w=>!w.isDestroyed()&&w.isFocused());
 onDesk=DESK.test(f.cls||"")||(!f.cls&&!f.pid)||widgetFocus;
 lastGameDiag=gamingMgr.evaluateForeground(lastFg,!!(ovCfg&&ovCfg.on),ovForce);
 if(lastGameDiag.gameName!==game){
  game=lastGameDiag.gameName;
  ovForce=null;
  lastGameDiag=gamingMgr.evaluateForeground(lastFg,!!(ovCfg&&ovCfg.on),ovForce);
 }
 if(lastGameDiag.inForeground&&f.x!=null&&f.y!=null){
  ovPoint=[f.x,f.y];
 }else if(!ovPoint&&f.x!=null&&f.y!=null){
  ovPoint=[f.x,f.y];
 }
 syncOverlay();
}

function startFg(){
 try{
  const f=path.join(dir,"fg.ps1");fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(f,fs.readFileSync(path.join(__dirname,"fg.ps1"),"utf8"),"utf8");
  writeWidgetHwnds();
  fgProc=cp.spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",f,HWNDS],{windowsHide:true,stdio:["ignore","pipe","ignore"]});
  let buf="";fgProc.stdout.setEncoding("utf8");
  fgProc.stdout.on("data",c=>{buf+=c;let i;while((i=buf.indexOf("\n"))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(l)try{onFg(JSON.parse(l))}catch(e){}}});
  fgProc.on("exit",()=>{fgProc=null;if(!quitting)setTimeout(startFg,5000)});
 }catch(e){}
}

/* ---------- OVERLAY DI GIOCO ---------- */
function ovDisplay(){try{if(ovPoint&&ovPoint[0]){const p=screen.screenToDipPoint?screen.screenToDipPoint({x:ovPoint[0],y:ovPoint[1]}):{x:ovPoint[0],y:ovPoint[1]};return screen.getDisplayNearestPoint(p)}}catch(e){}return screen.getPrimaryDisplay()}
function syncOverlay(){
 if(!ov||ov.isDestroyed())return;
 const show=ovForce!=null?ovForce:(lastGameDiag?lastGameDiag.overlayShouldShow:!!game);
 if(show){
  const d=ovDisplay();
  if(!ovDisp||ovDisp.id!==d.id){ovDisp=d;ov.setBounds(d.bounds)}
  ov.setAlwaysOnTop(true,"screen-saver");
  if(!ov.isVisible())ov.showInactive();
 }else if(ov.isVisible()){
  ov.hide();
 }
}
function setOverlay(c){
 ovCfg=c;
 settings.overlay=c;
 save(SET,settings);
 lastGameDiag=gamingMgr.evaluateForeground(lastFg,!!(ovCfg&&ovCfg.on),ovForce);
 if(!c.on){if(ov){ov.destroy();ov=null}ovDisp=null}
 else if(!ov){
  const b=ovDisplay().bounds;ovDisp=ovDisplay();
  ov=new BrowserWindow({x:b.x,y:b.y,width:b.width,height:b.height,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,hasShadow:false,resizable:false,show:false,webPreferences:{preload}});
  ov.setAlwaysOnTop(true,"screen-saver");ov.setIgnoreMouseEvents(true);
  ov.loadFile(path.join("app","widget.html"),{query:{mode:"overlay"}});
  ov.webContents.on("did-finish-load",()=>{if(ov&&!ov.isDestroyed())ov.webContents.send("cfg",ovCfg);syncOverlay()});
  ov.on("closed",()=>{ov=null});
 }else ov.webContents.send("cfg",c);
 const hk=(c.hk||"Alt + O").replace(/ /g,"");
 if(hk!==hkCur){try{if(hkCur)globalShortcut.unregister(hkCur)}catch(e){}hkCur="";
  try{if(globalShortcut.register(hk,()=>{if(!ov||ov.isDestroyed())return;ovForce=!ov.isVisible();lastGameDiag=gamingMgr.evaluateForeground(lastFg,!!(ovCfg&&ovCfg.on),ovForce);syncOverlay()}))hkCur=hk}catch(e){}}
 syncOverlay();
}

/* ---------- SENSORI (LibreHardwareMonitor & PawnIO) ---------- */
const LHMURL="https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/latest/download/LibreHardwareMonitor.zip";
const LHMDIR=path.join(dir,"LibreHardwareMonitor");
const LHMPATH=path.join(dir,"lhm.path");
const LHMZIP=path.join(app.getPath("temp"),"peppez-lhm.zip");
let pawnOk=null,setupDone=false;
function findFile(root,name){
 try{
  const entries=fs.readdirSync(root,{withFileTypes:true});
  for(const e of entries){
   const p=path.join(root,e.name);
   if(e.isFile()&&e.name.toLowerCase()===name.toLowerCase())return p;
   if(e.isDirectory()){const x=findFile(p,name);if(x)return x}
  }
 }catch(e){}
 return null;
}
function lhmPath(){
 for(const f of[LHMPATH,path.join(__dirname,"lhm.path")]){
  try{if(fs.existsSync(f)){const p=fs.readFileSync(f,"utf8").trim();if(p&&fs.existsSync(p))return p}}catch(e){}
 }
 const direct=path.join(LHMDIR,"LibreHardwareMonitor.exe");
 if(fs.existsSync(direct))return direct;
 return findFile(LHMDIR,"LibreHardwareMonitor.exe");
}
function writeLHMConfig(exe){
 const cfg=path.join(path.dirname(exe),"LibreHardwareMonitor.config");
 const xml=`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <appSettings>
    <add key="runWebServerMenuItem" value="true" />
    <add key="listenerPort" value="8085" />
    <add key="minTrayMenuItem" value="true" />
    <add key="startMinMenuItem" value="true" />
  </appSettings>
</configuration>
`;
 try{fs.writeFileSync(cfg,xml,"utf8")}catch(e){}
}
async function ensureLHMInstalled(){
 let exe=lhmPath();
 if(exe&&fs.existsSync(exe)){writeLHMConfig(exe);try{fs.writeFileSync(LHMPATH,exe,"utf8")}catch(e){};return exe}
 if(process.platform!=="win32")return null;
 const cmd=`$ProgressPreference='SilentlyContinue';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Invoke-WebRequest -UseBasicParsing ${psq(LHMURL)} -OutFile ${psq(LHMZIP)};if(Test-Path ${psq(LHMDIR)}){Remove-Item -Recurse -Force ${psq(LHMDIR)}};Expand-Archive -Force ${psq(LHMZIP)} ${psq(LHMDIR)}`;
 await run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",cmd],{timeout:300000});
 exe=lhmPath();
 if(exe&&fs.existsSync(exe)){writeLHMConfig(exe);try{fs.writeFileSync(LHMPATH,exe,"utf8")}catch(e){};return exe}
 return null;
}
const pawnInstalled=async()=>!(await run("sc",["query","PawnIO"])).err;
async function ensurePawnIO(){
 if(await pawnInstalled()){pawnOk=true;return false}
 await run("winget",["install","-e","--id","namazso.PawnIO","--silent","--accept-package-agreements","--accept-source-agreements","--disable-interactivity"],{timeout:600000});
 if(!(await pawnInstalled())){
  const exe=path.join(app.getPath("temp"),"PawnIO_setup.exe");
  const cmd=`$ProgressPreference='SilentlyContinue';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Invoke-WebRequest -UseBasicParsing 'https://github.com/namazso/PawnIO.Setup/releases/latest/download/PawnIO_setup.exe' -OutFile ${psq(exe)};Start-Process -FilePath ${psq(exe)} -ArgumentList '-install','-silent' -Wait`;
  await run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",cmd],{timeout:300000});
 }
 pawnOk=await pawnInstalled();
 return pawnOk;
}
function startLHM(){
 try{const exe=lhmPath();if(exe&&fs.existsSync(exe))cp.spawn(exe,[],{detached:true,stdio:"ignore",cwd:path.dirname(exe)}).unref()}catch(e){}
}
async function lhmRunning(){const r=await run("tasklist",["/FI","IMAGENAME eq LibreHardwareMonitor.exe","/NH"]);return /LibreHardwareMonitor\.exe/i.test(r.out)}
let isAdmin=null,noT=0,lhmRestarted=false;
async function checkAdmin(){isAdmin=!(await run("net",["session"])).err}
async function ensureSensorRuntime(){
 if(setupDone||process.platform!=="win32")return;
 setupDone=true;
 try{
  await checkAdmin();
  if(isAdmin){
   // Aggiunge l'utente al gruppo Performance Log Users (SID S-1-5-32-559) così PresentMon funziona sempre senza errori di accesso ETW
   run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command","$sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-559');$g=$sid.Translate([System.Security.Principal.NTAccount]).Value.Split('\\')[-1];Add-LocalGroupMember -Group $g -Member $env:USERNAME -ErrorAction SilentlyContinue"]).catch(()=>{});
  }
  const exe=await ensureLHMInstalled();
  const fresh=isAdmin?await ensurePawnIO():false;
  if(!exe)return;
  const up=await sensors.lhmOk();
  if(up&&fresh){await restartLHM();return}
  if(!up&&!(await lhmRunning()))startLHM();
  for(let i=0;i<20&&!(await sensors.lhmOk());i++)await new Promise(r=>setTimeout(r,2000));
  if(!(await sensors.lhmOk())){await restartLHM()}
 }catch(e){}
}
async function restartLHM(){
 const exe=lhmPath();if(exe)writeLHMConfig(exe);
 await run("taskkill",["/F","/IM","LibreHardwareMonitor.exe"]);
 await new Promise(r=>setTimeout(r,2500));startLHM();
}

function triggerBackgroundPing(){
 const now=Date.now();
 if(pingBusy||now-lastPingCheckTs<2500)return;
 pingBusy=true;lastPingCheckTs=now;
 network.measureHostPing("1.1.1.1",2).then(res=>{
  if(res&&res.ok){
   if(res.jitterMs>0)lastNetJitterMs=+res.jitterMs.toFixed(1);
   else if(lastNetPingMs!=null)lastNetJitterMs=+Math.abs(res.avgMs-lastNetPingMs).toFixed(1);
   else lastNetJitterMs=0.5;
   lastNetPingMs=res.avgMs;
   lastNetLossPct=res.lossPct||0;
  }else if(res){
   lastNetLossPct=res.lossPct!=null?res.lossPct:100;
  }
 }).catch(()=>{}).finally(()=>{pingBusy=false});
}

async function loop(){
 try{
  triggerBackgroundPing();
  const d=await sensors.read();
  lastGameDiag=gamingMgr.evaluateForeground(lastFg,!!(ovCfg&&ovCfg.on),ovForce);
  if(lastGameDiag.gameName!==game){game=lastGameDiag.gameName;ovForce=null}
  syncOverlay();
  let pm=gamingMgr.pm.getMetrics(d);
  gamingMgr.recordSessionSample(d,pm,lastNetPingMs);
  if(pm.fps==null&&gamingMgr.curSession&&gamingMgr.curSession.manual){
   pm=gamingMgr.pm.getMetrics(d);
  }
  // Carico max singolo core CPU per HUD e Bottleneck
  const coreLoads=(d.sens||[]).filter(s=>s.cat==="load"&&/core\s*#?\d/i.test(s.n)).map(s=>Math.round(s.v));
  d.cpuCoreMax=coreLoads.length?Math.max(...coreLoads):Math.round(d.cpu||0);
  d.game=lastGameDiag.gameName;
  d.gameDiag=lastGameDiag;
  d.admin=isAdmin;
  d.pawn=pawnOk;
  d.fps=pm.fps;
  d.fpsAvg=pm.fpsAvg;
  d.fpsMin=pm.fpsMin;
  d.fpsMax=pm.fpsMax;
  d.fps1Low=pm.fps1Low;
  d.fps01Low=pm.fps01Low;
  d.ft=pm.ft;
  d.ftAvg=pm.ftAvg;
  d.ftMax=pm.ftMax;
  d.ftHist=pm.ftHist||[];
  d.fpsSource=pm.source||"";
  d.sessionDurSec=lastGameDiag.sessionDurationSec;
  d.ping=lastNetPingMs;
  d.jitter=lastNetJitterMs;
  d.pktLoss=lastNetLossPct;
  d.bottleneck=gamingMgr.analyzeBottleneck(d,pm);
  d.curSession=gamingMgr.curSession?{
   id:gamingMgr.curSession.id,
   gameName:gamingMgr.curSession.gameName,
   profile:gamingMgr.curSession.profile,
   durationSec:Math.floor((Date.now()-gamingMgr.curSession.startedAt)/1000),
   samples:gamingMgr.curSession.samples,
   cpuMax:gamingMgr.curSession.cpuMax,
   gpuMax:gamingMgr.curSession.gpuMax,
   tcMax:gamingMgr.curSession.tcMax,
   tgMax:gamingMgr.curSession.tgMax
  }:null;

  if(d.diag&&d.diag.lhm&&d.tc==null&&d.diag.cpuHw.length&&!d.diag.cpuTemp){
   if(++noT>=12&&!lhmRestarted&&isAdmin){lhmRestarted=true;restartLHM()}
  }else noT=0;
  BrowserWindow.getAllWindows().forEach(w=>{if(!w.isDestroyed())w.webContents.send("data",d)});
 }catch(e){}
 setTimeout(loop,1000);
}

/* ---------- IMPOSTAZIONI, AVVIO CON WINDOWS, PIANO ENERGETICO, STRUMENTI ---------- */
const TASK="PeppeZ Hardware Analytics",OLD_TASK="PeppeZ System";
async function autostartOn(){
 return !(await run("schtasks",["/Query","/TN",TASK])).err || !(await run("schtasks",["/Query","/TN",OLD_TASK])).err;
}
async function setAutostart(on){
 await run("schtasks",["/Delete","/TN",OLD_TASK,"/F"]);
 if(!on)return !(await run("schtasks",["/Delete","/TN",TASK,"/F"])).err;
 const exe=process.execPath,tr=app.isPackaged?`"${exe}" --hidden`:`"${exe}" "${app.getAppPath()}" --hidden`;
 return !(await run("schtasks",["/Create","/TN",TASK,"/TR",tr,"/SC","ONLOGON","/RL","HIGHEST","/F"])).err;
}
const PLANS=["a1841308-3541-4fab-bc81-f71556f20b4a","381b4222-f694-41f0-9685-ff5bb260df2e","8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"];
async function powerMode(){
 const r=await run("powercfg",["/getactivescheme"]);
 const m=r.out.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i);if(!m)return null;
 const g=m[0].toLowerCase();
 return g==PLANS[0]?0:(g==PLANS[2]||g=="e9a42b02-d5df-448d-aa00-03f14749eb61"||g=="ded574b5-45a0-4f42-8737-46345c09c238")?2:1;
}
async function setPower(m){
 const r=await run("powercfg",["/setactive",PLANS[m]]);
 if(r.err&&m==2)await run("powercfg",["/setactive","e9a42b02-d5df-448d-aa00-03f14749eb61"]);
}
const PSCLEAN='$p=@($env:TEMP,"$env:windir\\Temp");$f={param($d)(Get-ChildItem $d -Recurse -Force -File -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum};$b=0;foreach($d in $p){$b+=[double](& $f $d)};foreach($d in $p){Get-ChildItem $d -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue};$a=0;foreach($d in $p){$a+=[double](& $f $d)};"Liberati {0:N1} MB" -f ([Math]::Max(0,($b-$a)/1MB))';
async function tool(t){
 if(t=="clean"){const r=await run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",PSCLEAN]);return r.out.trim()||"Pulizia completata."}
 if(t=="flushdns"){
  await run("ipconfig",["/flushdns"]);
  return"Cache DNS svuotata con successo (ipconfig /flushdns).";
 }
 if(t=="dism_clean"){
  cp.spawn("cmd.exe",["/c","start","Pulizia Componenti Windows Update (DISM)","cmd","/k","DISM.exe /Online /Cleanup-Image /StartComponentCleanup"],{detached:true,stdio:"ignore"}).unref();
  return"Pulizia componenti Windows Update avviata in una finestra separata.";
 }
 if(t=="hiber_off"){
  const r=await run("powercfg",["-h","off"]);
  return r.err?"Richiede avvio come Amministratore per disattivare l'ibernazione.":"Ibernazione disattivata e file hiberfil.sys rimosso (spazio recuperato su C:).";
 }
 if(t=="hiber_on"){
  const r=await run("powercfg",["-h","on"]);
  return r.err?"Richiede privilegi di Amministratore.":"Ibernazione di Windows riattivata (powercfg -h on).";
 }
 if(t=="ultimate_power"){
  await run("powercfg",["-duplicatescheme","e9a42b02-d5df-448d-aa00-03f14749eb61"]);
  await run("powercfg",["/setactive","e9a42b02-d5df-448d-aa00-03f14749eb61"]);
  return"Piano energetico 'Prestazioni Eccellenti' sbloccato e attivato.";
 }
 if(t=="sysdm_perf"){
  cp.spawn("SystemPropertiesPerformance.exe",[],{detached:true,stdio:"ignore"}).unref();
  return"Finestra Opzioni Prestazioni ed Effetti Visivi aperta.";
 }
 if(t=="opt_telemetry"){
  const cmd=`New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager' -Name 'SubscribedContent-338389Enabled' -Value 0 -Type DWord -ErrorAction SilentlyContinue; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager' -Name 'SystemPaneSuggestionsEnabled' -Value 0 -Type DWord -ErrorAction SilentlyContinue; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager' -Name 'SoftLandingEnabled' -Value 0 -Type DWord -ErrorAction SilentlyContinue`;
  await run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",cmd]);
  return"Suggerimenti promozionali e notifiche di telemetria utente disattivati.";
 }
 if(t=="opt_tcp"){
  await run("netsh",["int","tcp","set","global","autotuninglevel=normal"]);
  await run("netsh",["int","tcp","set","global","rss=enabled"]);
  return"Stack di rete TCP/IP ottimizzato (Receive-Side Scaling e Auto-Tuning).";
 }
 if(t=="rebuild_icons"){
  const cmd=`$p="$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer"; Get-ChildItem $p -Filter 'thumbcache_*.db' -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue; Get-ChildItem $p -Filter 'iconcache_*.db' -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue`;
  await run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",cmd]);
  return"Cache miniature e icone di Esplora Risorse ripulita.";
 }
 if(t=="win_storage"){shell.openExternal("ms-settings:storagesense");return"Impostazioni Sensore Memoria aperte."}
 if(t=="startup"){shell.openExternal("ms-settings:startupapps");return"Impostazioni App di avvio aperte."}
 if(t=="power"){shell.openExternal("ms-settings:powersleep");return"Impostazioni Alimentazione aperte."}
 if(t=="disks"){cp.spawn("cleanmgr.exe",[],{detached:true,stdio:"ignore"}).unref();return"Pulizia disco di Windows aperta."}
 if(t=="ssd"){cp.spawn("dfrgui.exe",[],{detached:true,stdio:"ignore"}).unref();return"Ottimizza unità di Windows aperto."}
 if(t=="diag"){cp.spawn("cmd.exe",["/c","start","Verifica file di Windows (SFC)","cmd","/k","sfc /scannow"],{detached:true,stdio:"ignore"}).unref();return"Verifica SFC avviata in una finestra separata."}
 if(t=="dism"){cp.spawn("cmd.exe",["/c","start","Ripristino Immagine Windows (DISM)","cmd","/k","DISM.exe /Online /Cleanup-Image /RestoreHealth"],{detached:true,stdio:"ignore"}).unref();return"Ripristino DISM avviato in una finestra separata."}
 if(t=="devmgmt"){cp.spawn("cmd.exe",["/c","start","","devmgmt.msc"],{detached:true,stdio:"ignore"}).unref();return"Gestione dispositivi aperto."}
 if(t=="eventvwr"){cp.spawn("cmd.exe",["/c","start","","eventvwr.msc"],{detached:true,stdio:"ignore"}).unref();return"Visualizzatore eventi aperto."}
 return"Operazione sconosciuta.";
}

app.whenReady().then(async()=>{
 createMain();
 tray=new Tray(nativeImage.createFromPath(icon).resize({width:16,height:16}));
 tray.setToolTip("PeppeZ Hardware Analytics");
 tray.setContextMenu(Menu.buildFromTemplate([
  {label:"Apri PeppeZ Hardware Analytics",click:()=>{win.show();win.focus()}},
  {label:"Mostra / nascondi widget desktop",click:()=>{wShown=!wShown;if(wShown&&wcfg&&!wins.length)applyWidgets(wcfg,false);syncWidgets()}},
  {label:"Mostra / nascondi overlay di gioco",click:()=>{if(ov&&!ov.isDestroyed()){ovForce=!ov.isVisible();syncOverlay()}}},
  {type:"separator"},
  {label:"Esci",click:()=>{quitting=true;app.quit()}}
 ]));
 tray.on("double-click",()=>{win.show();win.focus()});
 if(wcfg&&settings.widgetsAuto!==false)applyWidgets(wcfg,false);
 startFg();
 await checkAdmin();
 loop();
 ensureSensorRuntime();
});
app.on("second-instance",()=>{if(win){win.show();win.focus()}});
app.on("before-quit",()=>{quitting=true;try{fgProc&&fgProc.kill()}catch(e){}try{gamingMgr.pm.shutdown()}catch(e){}});
app.on("will-quit",()=>globalShortcut.unregisterAll());
app.on("window-all-closed",()=>{});

/* ---------- IPC HANDLERS ---------- */
ipcMain.handle("info",()=>sensors.info());
ipcMain.on("widgets",(e,p)=>applyWidgets(p,true));
ipcMain.on("widgets-toggle",(e,show)=>{
 wShown=show!==undefined?!!show:!wShown;
 if(wShown&&wcfg&&!wins.length)applyWidgets(wcfg,false);
 syncWidgets();
});
ipcMain.on("widgets-save",(e,p)=>{
 wcfg=p;save(WCFG,p);
 if(!p||!Array.isArray(p.list))return;
 if(wins.length>0){
  const sameIds=wins.length===p.list.length&&wins.every(w=>!w.isDestroyed()&&p.list.some(c=>c.id==w._wid));
  if(sameIds){
   wins.forEach(w=>{
    if(w.isDestroyed())return;
    const c=p.list.find(x=>x.id==w._wid);
    if(c)w.webContents.send("cfg",Object.assign({},c,{unit:p.unit}));
   });
  }else if(wShown){
   applyWidgets(p,false);
  }
 }
});
ipcMain.on("widget-update",(e,u)=>{
 if(!u||!wcfg||!Array.isArray(wcfg.list))return;
 const item=wcfg.list.find(x=>x.id==u.id);
 if(item){
  if(u.sz!=null)item.sz=u.sz;
  if(u.customW!=null)item.customW=u.customW;
  if(u.w!=null)item.w=u.w;
  if(u.h!=null)item.h=u.h;
  if(Array.isArray(u.m))item.m=u.m;
  save(WCFG,wcfg);
  if(win&&!win.isDestroyed())win.webContents.send("widgets-updated",wcfg);
 }
});
ipcMain.on("overlay",(e,c)=>setOverlay(c));
ipcMain.on("wsize",(e,w,h)=>{
 const b=BrowserWindow.fromWebContents(e.sender);
 if(b&&!b.isDestroyed())b.setContentSize(Math.max(110,Math.ceil(w)),Math.max(55,Math.ceil(h)));
});
ipcMain.handle("settings-get",async()=>Object.assign({},settings,{
 widgetsAuto:settings.widgetsAuto!==false,
 top:!!settings.top,
 wShown:!!wShown,
 overlay:settings.overlay||null,
 widgets:wcfg||null,
 autostart:await autostartOn(),
 power:await powerMode()
}));
ipcMain.on("settings-set",(e,s)=>{
 Object.assign(settings,s);
 if(s&&s.overlay)ovCfg=s.overlay;
 save(SET,settings);
 syncWidgets();
});
ipcMain.handle("autostart",(e,on)=>setAutostart(!!on));
ipcMain.on("power",(e,m)=>setPower(m));
ipcMain.handle("tool",(e,t)=>tool(t));

/* Diagnostica, Pulizia Intelligente ed Esportazione TXT */
ipcMain.handle("diag-history",()=>({history:diagHistory,lastReport:lastDiagReport}));
ipcMain.handle("diag-run",async(e,level)=>{
 await checkAdmin();
 const rep=await diagnostics.runDiagnostics(level||"fast",isAdmin,prog=>{
  if(win&&!win.isDestroyed())win.webContents.send("diag-progress",prog);
 },diagHistory);
 lastDiagReport=rep;
 diagHistory.unshift({
  id:rep.id,
  timestamp:rep.timestamp,
  dateFormatted:rep.dateFormatted,
  level:rep.level,
  levelLabel:rep.levelLabel,
  score:rep.score,
  healthLabel:rep.healthLabel,
  okCount:rep.counts.ok,
  warnCount:rep.counts.warn,
  badCount:rep.counts.bad,
  naCount:rep.counts.na,
  recoverableFmt:rep.clean?rep.clean.totalRecoverableFmt:"0 B",
  problems:(rep.problems||[]).map(p=>({group:p.group,title:p.title,status:p.status,value:p.value}))
 });
 if(diagHistory.length>25)diagHistory.length=25;
 save(DHIST,{history:diagHistory,lastReport:lastDiagReport});
 return{report:rep,history:diagHistory};
});
ipcMain.handle("diag-scan-clean",()=>diagnostics.scanCleanable());
ipcMain.handle("diag-clean",async(e,selectedIds)=>{
 const res=await diagnostics.cleanCategories(selectedIds);
 return res;
});
ipcMain.handle("diag-export-txt",async(e,customRep)=>{
 const rep=customRep||lastDiagReport;
 const txt=diagnostics.formatDiagnosticReportTxt(rep,diagHistory);
 const r=await dialog.showSaveDialog(win,{
  title:"Esporta Rapporto Diagnostico TXT",
  defaultPath:path.join(app.getPath("documents"),`PeppeZ-Hardware-Analytics-Diagnostica-${new Date().toISOString().slice(0,10)}.txt`),
  filters:[{name:"File di testo (.txt)",extensions:["txt"]}]
 });
 if(!r.canceled&&r.filePath){
  fs.writeFileSync(r.filePath,txt,"utf8");
  return{ok:true,filePath:r.filePath};
 }
 return{ok:false,canceled:true,txt};
});
ipcMain.handle("export-txt",async(e,payload)=>{
 const {title,defaultName,content}=payload||{};
 const ext=(defaultName&&defaultName.endsWith(".csv"))?"csv":"txt";
 const r=await dialog.showSaveDialog(win,{
  title:title||"Esporta Report",
  defaultPath:path.join(app.getPath("documents"),defaultName||`PeppeZ-Hardware-Analytics-Report.${ext}`),
  filters:[ext==="csv"?{name:"File CSV (.csv)",extensions:["csv"]}:{name:"File di testo (.txt)",extensions:["txt"]}]
 });
 if(!r.canceled&&r.filePath){
  fs.writeFileSync(r.filePath,String(content||""),"utf8");
  return{ok:true,filePath:r.filePath};
 }
 return{ok:false,canceled:true};
});
ipcMain.handle("open-path",(e,p)=>{
 if(!p)return false;
 try{
  if(fs.existsSync(p)){
   const st=fs.statSync(p);
   if(st.isDirectory())shell.openPath(p);
   else shell.showItemInFolder(p);
   return true;
  }
 }catch(err){}
 return false;
});

/* ---------- IPC: ANALISI AVANZATA RETE & DNS ---------- */
ipcMain.handle("net-overview",(e,host)=>network.getNetworkOverview(host||"1.1.1.1"));
ipcMain.handle("net-ping",(e,host,count)=>network.measureHostPing(host||"1.1.1.1",count||2));
ipcMain.handle("net-dns-bench",(e,custom)=>network.benchmarkDns(custom||[]));
ipcMain.handle("net-dns-apply",(e,p)=>network.applyDnsToWindows(p&&p.ifIndex,p&&p.adapter,p&&p.ip,p&&p.sec));
ipcMain.handle("net-dns-reset",(e,p)=>network.resetDnsToDhcp(p&&p.ifIndex,p&&p.adapter));
ipcMain.handle("net-traceroute",(e,host)=>network.runTraceroute(host||"1.1.1.1"));
ipcMain.handle("net-export-txt",async(e,payload)=>{
 const txt=network.formatNetworkReportTxt(payload);
 const r=await dialog.showSaveDialog(win,{
  title:"Esporta Report Diagnostica Rete & DNS",
  defaultPath:path.join(app.getPath("documents"),`PeppeZ-Hardware-Analytics-Rete-${new Date().toISOString().slice(0,10)}.txt`),
  filters:[{name:"File di testo (.txt)",extensions:["txt"]}]
 });
 if(!r.canceled&&r.filePath){
  fs.writeFileSync(r.filePath,txt,"utf8");
  return{ok:true,filePath:r.filePath};
 }
 return{ok:false,canceled:true};
});

/* ---------- IPC: GAMING MODE (LIBRERIA, OTTIMIZZATORE, PROFILI, SESSIONI, RILEVAMENTO) ---------- */
ipcMain.handle("game-state",()=>gamingMgr.getState());
ipcMain.handle("game-scan-lib",()=>({ok:true,library:gamingMgr.scanLibrary()}));
ipcMain.handle("game-pick-exe",async()=>{
 const r=await dialog.showOpenDialog(win,{
  title:"Seleziona l'eseguibile principale del gioco (.exe)",
  properties:["openFile"],
  filters:[{name:"Eseguibile Windows (.exe)",extensions:["exe"]}]
 });
 if(!r.canceled&&r.filePaths&&r.filePaths.length){
  const exePath=r.filePaths[0];
  return{ok:true,exePath,exeName:path.basename(exePath),installDir:path.dirname(exePath),suggestedName:path.basename(path.dirname(exePath))};
 }
 return{ok:false,canceled:true};
});
ipcMain.handle("game-add-manual",(e,g)=>gamingMgr.addManualGame(g||{}));
ipcMain.handle("game-update",(e,g)=>gamingMgr.updateGame(g||{}));
ipcMain.handle("game-remove",(e,id)=>gamingMgr.removeGame(id));
ipcMain.handle("game-launch",async(e,id)=>{
 const g=gamingMgr.library.find(x=>x.id===id);
 if(!g)return{ok:false,msg:"Gioco non trovato nella libreria."};
 try{
  g.lastPlayed=new Date().toLocaleDateString("it-IT");
  g.lastPlayedTs=Date.now();
  gamingMgr.saveLibrary();
  if(g.launcher==="Steam"&&g.appid){
   await shell.openExternal(`steam://rungameid/${g.appid}`);
   return{ok:true,msg:`Avvio di ${g.name} richiesto tramite Steam.`};
  }
  if(g.exePath&&fs.existsSync(g.exePath)){
   cp.spawn(g.exePath,[],{detached:true,stdio:"ignore",cwd:path.dirname(g.exePath)}).unref();
   return{ok:true,msg:`Avviato ${g.name} (${g.exeName}).`};
  }
  if(g.installDir&&fs.existsSync(g.installDir)){
   shell.openPath(g.installDir);
   return{ok:true,msg:`Aperta cartella di ${g.name}.`};
  }
  return{ok:false,msg:"Eseguibile del gioco non trovato sul disco."};
 }catch(err){
  return{ok:false,msg:`Errore avvio: ${err.message}`};
 }
});
ipcMain.handle("game-opt-inspect",(e,gameId)=>gamingMgr.inspectGameOptimizations(gameId));
ipcMain.handle("game-opt-apply",(e,p)=>gamingMgr.applyOptimization(p&&p.gameId,p&&p.optId,p&&p.extra));
ipcMain.handle("game-opt-restore",()=>gamingMgr.restoreAllOptimizations());
ipcMain.handle("game-profile-set",(e,id)=>gamingMgr.setProfile(id));
ipcMain.handle("game-profile-save",(e,p)=>gamingMgr.saveCustomProfile(p||{}));
ipcMain.handle("game-autorec-set",(e,on)=>gamingMgr.setAutoRecord(on));
ipcMain.handle("game-sess-start",(e,p)=>({ok:true,curSession:gamingMgr.startSession(p&&p.gameName,p&&p.profile,true)}));
ipcMain.handle("game-sess-stop",()=>({ok:true,summary:gamingMgr.stopSession(),sessions:gamingMgr.sessions}));
ipcMain.handle("game-sess-export-txt",async(e,sessId)=>{
 const txt=gamingMgr.formatSessionReportTxt(sessId);
 const r=await dialog.showSaveDialog(win,{
  title:"Esporta Report Sessioni Gaming TXT",
  defaultPath:path.join(app.getPath("documents"),`PeppeZ-Hardware-Analytics-Sessioni-Gaming-${new Date().toISOString().slice(0,10)}.txt`),
  filters:[{name:"File di testo (.txt)",extensions:["txt"]}]
 });
 if(!r.canceled&&r.filePath){
  fs.writeFileSync(r.filePath,txt,"utf8");
  return{ok:true,filePath:r.filePath};
 }
 return{ok:false,canceled:true};
});
ipcMain.handle("game-arc-test",(e,on)=>{
 const res=gamingMgr.toggleArcRaidersTest(on);
 lastGameDiag=gamingMgr.evaluateForeground(lastFg,!!(ovCfg&&ovCfg.on),ovForce);
 game=lastGameDiag.gameName;
 syncOverlay();
 return Object.assign({},res,{gameDiag:lastGameDiag});
});

/* ---------- IPC: DISK MANAGER - ANALIZZATORE SPAZIO STILE WINDIRSTAT ---------- */
ipcMain.handle("disk-scan-start",async(e,drive)=>{
 return await diskanalyzer.scanDiskWinDirStat(drive,prog=>{
  if(win&&!win.isDestroyed())win.webContents.send("disk-scan-progress",prog);
 });
});
ipcMain.handle("disk-scan-duplicates",async()=>{
 return await diskanalyzer.scanDiskDuplicates(prog=>{
  if(win&&!win.isDestroyed())win.webContents.send("disk-scan-progress",prog);
 });
});
ipcMain.handle("disk-scan-cancel",()=>diskanalyzer.cancelDiskScan());
ipcMain.handle("disk-scan-expand",(e,folderPath)=>diskanalyzer.getDirectoryChildren(folderPath));
ipcMain.handle("disk-scan-trash",(e,targetPath)=>diskanalyzer.trashFileOrFolder(targetPath));
ipcMain.handle("disk-context-action",async(e,action,targetPath)=>{
 if(action==="open"){
  if(!targetPath||!fs.existsSync(targetPath))return{ok:false,msg:"Percorso non trovato."};
  const errMsg=await shell.openPath(path.normalize(targetPath));
  return errMsg?{ok:false,msg:errMsg}:{ok:true,msg:"Elemento aperto."};
 }
 if(action==="copy_path"){
  const {clipboard}=require("electron");
  clipboard.writeText(String(targetPath||""));
  return{ok:true,msg:"Percorso copiato negli appunti."};
 }
 return await diskanalyzer.executeFileContextAction(action,targetPath);
});
ipcMain.handle("disk-scan-last",()=>diskanalyzer.getLastDiskScan());
