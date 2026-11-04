// Lettura sensori: systeminformation + LibreHardwareMonitor (Remote Web Server, porta 8085).
// Regola: ogni valore non rilevato resta null e l'interfaccia lo segnala come non disponibile. Nessun dato inventato.
const si=require("systeminformation"),http=require("http"),os=require("os");
let gpuC={t:0,v:null,all:[]},tmpC={t:0,v:null,cores:[]},procC={t:0,v:[]},dskC={t:0,v:[]},batC={t:0,v:null},fsC={t:0,v:null};
const seenFans=new Set();

function lhmGet(){return new Promise(r=>{
 const q=http.get("http://127.0.0.1:8085/data.json",{timeout:900},res=>{let b="";res.setEncoding("utf8");res.on("data",c=>b+=c);res.on("end",()=>{try{r(JSON.parse(b))}catch(e){r(null)}})});
 q.on("error",()=>r(null));q.on("timeout",()=>{q.destroy();r(null)})})}
async function lhmOk(){return !!(await lhmGet())}

/* ---- albero LibreHardwareMonitor -> lista piatta di sensori ----
   livelli: 0 radice, 1 computer, 2 hardware, poi (eventuale sotto-hardware, es. chip Super I/O), gruppo (Temperatures, Fans...), sensore */
const GROUPS={temperatures:"temp",fans:"fan",clocks:"clock",load:"load",powers:"power",voltages:"volt",controls:"ctrl",data:"data",smalldata:"data",throughput:"thr",levels:"level",factors:"factor",flows:"flow",frequencies:"clock",current:"current",capacities:"data"};
const GLAB={temp:"Temperature",fan:"Ventole",clock:"Frequenze",load:"Carico / Utilizzo",power:"Consumi Energetici",volt:"Voltaggi",ctrl:"Controlli",data:"Dati / Memoria",thr:"Throughput",level:"Livelli",factor:"Fattori",flow:"Flussi",current:"Corrente",other:"Altri parametri"};
function walk(n,d,hw,sub,grp,out){
 const t=n.Text||"",kids=n.Children&&n.Children.length;
 if(d==2){hw={name:t,img:n.ImageURL||""};sub="";grp=null}
 else if(d>2&&kids){const g=GROUPS[t.toLowerCase()];if(g)grp=g;else{sub=t;grp=null}}
 if(!kids&&n.Value!==undefined&&n.Value!==""&&d>=3&&hw){
  const m=String(n.Value).match(/^(-?[\d.,]+)\s*(.*)$/);
  if(m){const v=parseFloat(m[1].replace(",","."));if(!isNaN(v)){
   const u=m[2].trim(),k=kind(u,grp);
   out.push({hw,sub,n:t,u,v,k})}}
  return}
 (n.Children||[]).forEach(c=>walk(c,d+1,hw,sub,grp,out));
}
function kind(u,g){
 if(u=="°C")return"temp";if(u=="RPM")return"fan";if(u=="MHz"||u=="GHz")return"clock";if(u=="W")return"power";if(u=="V"||u=="mV")return"volt";
 if(u=="%")return g=="ctrl"?"ctrl":g=="level"?"level":"load";
 if(/\/s$/i.test(u))return"thr";if(u=="GB"||u=="MB"||u=="KB")return"data";return g||"other"}
function hwKind(h){
 const im=(h.img||"").toLowerCase(),nm=(h.name||"").toLowerCase();
 if(im.includes("cpu"))return"cpu";
 if(/nvidia|ati|amd|gpu|intel/.test(im)&&!im.includes("cpu")&&!im.includes("mainboard"))return"gpu";
 if(im.includes("mainboard")||im.includes("chip"))return"mb";
 if(/hdd|ssd|nvme|storage/.test(im))return"disk";
 if(/ram|memory/.test(im))return"ram";
 if(/nic|network|wifi|ethernet/.test(im))return"net";
 if(/battery/.test(im))return"battery";
 if(/ryzen|threadripper|epyc|athlon|xeon|pentium|celeron|core\s*(i\d|ultra)/.test(nm))return"cpu";
 if(/nvidia|geforce|radeon|\brtx\b|\bgtx\b|intel.*(arc|iris|uhd|hd\s*graphics|graphics)/.test(nm))return"gpu";
 if(/ssd|nvme|hdd|samsung|crucial|kingston|sandisk|western digital|\bwd\b|seagate|toshiba|sabrent|lexar|sk hynix|micron|corsair mp/.test(nm))return"disk";
 if(/memory|ram|dimm/.test(nm))return"ram";
 if(/ethernet|wi-fi|wifi|wireless|lan|realtek.*family|intel.*wireless|killer/.test(nm))return"net";
 if(/battery|batteria/.test(nm))return"battery";
 return"other"}
const okT=v=>v>0&&v<125&&Math.abs(v-16.85)>0.4;   // scarta il sensore ACPI fittizio di Windows (2900 dK = 16,85 °C, mostrato come 17 °C)
const pick=(L,res)=>{for(const re of res){const x=L.find(s=>re.test(s.n));if(x)return x.v}return null};
const num=v=>typeof v=="number"&&isFinite(v)?v:null;

async function read(){
 const now=Date.now();
 const [ld,mem,sp,net]=await Promise.all([si.currentLoad(),si.mem(),si.cpuCurrentSpeed().catch(()=>({})),si.networkStats().catch(()=>[])]);
 const j=await lhmGet();
 const d={diag:{lhm:false},cpu:ld.currentLoad,ram:(mem.total-mem.available)/mem.total*100,ramT:Math.round(mem.total/1073741824),
  ramUsedGB:+((mem.total-mem.available)/1073741824).toFixed(2),ramAvailGB:+(mem.available/1073741824).toFixed(2),
  swapUsedGB:+((mem.swapused||0)/1073741824).toFixed(2),swapTotGB:+((mem.swaptotal||0)/1073741824).toFixed(2),
  up:Math.floor(os.uptime()/60),
  disk:null,tc:null,tg:null,tgHot:null,tm:null,ts:null,clk:num(sp.avg)||0,gclk:null,vram:null,vramTot:null,gpu:null,watt:null,gwatt:null,
  netRx:0,netTx:0,wifi:0,dact:[],fans:[],volts:[],powers:[],clocks:[],tempsAll:[],loadsAll:[],sens:[],lhm:!!j,procs:[],disks:[],
  sensorSupport:{lhm:!!j,temp:false,volt:false,clock:false,load:true,fan:false,power:false}};

 // processi e dischi (cache)
 if(now-procC.t>4000){procC.t=now;try{const p=await si.processes(),g={};
  p.list.forEach(x=>{if(!x.name||/^(idle|system idle process)$/i.test(x.name))return;const a=g[x.name]||(g[x.name]={n:x.name,cpu:0,mem:0,pids:0});a.cpu+=x.cpu||0;a.mem+=(x.memRss||0)/1024;a.pids++});
  procC.v=Object.values(g).sort((a,b)=>b.cpu-a.cpu).slice(0,10)}catch(e){}}
 if(now-dskC.t>15000){dskC.t=now;try{dskC.v=(await si.fsSize()).filter(x=>x.size>0&&/^[A-Z]:/i.test(x.fs)).map(x=>({n:x.fs,fs:x.type||"",tot:x.size/1073741824,used:x.used/1073741824,usePct:x.use||Math.round(x.used/x.size*100)}))}catch(e){}}
 d.procs=procC.v;d.disks=dskC.v;

 // sensori base (systeminformation)
 const sens=[];
 const pushBase=(hw,hwType,cat,n,u,v)=>{if(v==null||!isFinite(v))return;sens.push({g:`${hw} • ${GLAB[cat]||cat}`,hw,sub:"",hwType,cat,catLabel:GLAB[cat]||cat,n,u,v})};
 (ld.cpus||[]).forEach((c,i)=>pushBase("CPU","cpu","load",`Core #${i} Utilizzo`,"%",c.load));
 pushBase("CPU","cpu","load","CPU Totale Utilizzo","%",ld.currentLoad);
 if(Array.isArray(sp.cores)&&sp.cores.length){
  sp.cores.forEach((c,i)=>{if(c>0)pushBase("CPU","cpu","clock",`Core #${i} Frequenza`,"MHz",Math.round(c*1000))});
 }else if(d.clk>0){
  pushBase("CPU","cpu","clock","CPU Frequenza Media","MHz",Math.round(d.clk*1000));
 }
 pushBase("Memoria RAM","ram","data","Memoria RAM Usata","GB",d.ramUsedGB);
 pushBase("Memoria RAM","ram","data","Memoria RAM Disponibile","GB",d.ramAvailGB);
 pushBase("Memoria RAM","ram","load","Carico Memoria RAM","%",d.ram);
 if(d.swapTotGB>0){
  pushBase("Memoria RAM","ram","data","File di Paging (Swap) Usato","GB",d.swapUsedGB);
 }
 if(net&&net[0]){
  const activeNet=net.find(x=>(x.rx_sec||0)+(x.tx_sec||0)>0)||net[0];
  d.netRx=(activeNet.rx_sec||0)/1048576;
  d.netTx=(activeNet.tx_sec||0)/1048576;
  d.wifi=Math.max(0,Math.min(100,Math.round((d.netRx+d.netTx)*8)));
  pushBase("Rete","net","thr","Velocità Download","KB/s",(activeNet.rx_sec||0)/1024);
  pushBase("Rete","net","thr","Velocità Upload","KB/s",(activeNet.tx_sec||0)/1024);
 }

 if(j){
  const L=[];walk(j,0,null,"",null,L);
  L.forEach(s=>{s.h=hwKind(s.hw)});
  const T=(k,h)=>L.filter(s=>s.k==k&&(!h||s.h==h));
  const temps=h=>T("temp",h).filter(s=>okT(s.v)&&!/distance|tjmax|limit|warning|critical|resolution/i.test(s.n));
  d.tc=pick(temps("cpu"),[/Package/i,/Tctl|Tdie/i,/Core Max/i,/Average/i,/CPU/i,/./]);
  d.tg=pick(temps("gpu"),[/GPU Core/i,/^Core/i,/^(?!.*(hot|mem|junc))/i,/./]);
  d.tgHot=pick(temps("gpu"),[/Hot\s*Spot|Junction/i]);
  d.ts=pick(temps("disk"),[/^Temperature$/i,/Composite/i,/Assembly|Airflow/i,/./]);
  d.tm=pick(temps("mb"),[/System|Chipset|Motherboard|PCH|SYSTIN|TMPIN0/i,/./]);
  // ripiego: sensore "CPU" esposto dalla scheda madre (Super I/O) se la CPU stessa non da' temperature
  if(d.tc==null)d.tc=pick(temps("mb").filter(x=>/cpu|tctl|tdie|core|cputin/i.test(x.n)&&!/fan|vcore|volt/i.test(x.n)),[/Package|Tctl|Tdie|CPUTIN/i,/CPU/i,/./]);
  // diagnostica per l'interfaccia: perche' manca la temperatura CPU
  const hn=k=>[...new Set(L.filter(x=>x.h==k).map(x=>x.hw.name))];
  d.diag={lhm:true,n:L.length,cpuHw:hn("cpu"),gpuHw:hn("gpu"),cpuSens:L.filter(x=>x.h=="cpu").length,cpuTemp:temps("cpu").length,mbTemp:temps("mb").length,hw:[...new Set(L.map(x=>x.hw.name+" ("+x.h+")"))].slice(0,12)};
  const cl=T("clock","cpu").filter(s=>/core/i.test(s.n)&&!/effective/i.test(s.n)&&s.v>0);
  if(cl.length)d.clk=cl.reduce((a,s)=>a+s.v,0)/cl.length/1000;
  const cu=pick(T("load","cpu"),[/Total/i]);if(cu!=null)d.cpu=cu;
  d.gpu=pick(T("load","gpu"),[/GPU Core/i,/D3D 3D/i,/./]);
  d.gclk=pick(T("clock","gpu"),[/GPU Core|^Core/i,/./]);
  const vm=T("data","gpu").find(s=>/Memory Used|D3D Dedicated Memory Used/i.test(s.n));if(vm)d.vram=vm.u=="GB"?vm.v*1024:vm.v;
  const vmt=T("data","gpu").find(s=>/Memory Total/i.test(s.n));if(vmt)d.vramTot=vmt.u=="GB"?vmt.v*1024:vmt.v;
  d.watt=pick(T("power","cpu"),[/Package|PPT|Total/i,/./]);
  d.gwatt=pick(T("power","gpu"),[/Package|GPU Power|Board Power|Total/i,/./]);
  d.disk=pick(T("load","disk"),[/Total Activity/i]);
  // attivita' per singolo disco (per il box "SSD x% • HDD y%")
  d.dact=T("load","disk").filter(s=>/Total Activity/i.test(s.n)).map(s=>({n:/ssd|nvme|m\.2/i.test(s.hw.name)?"SSD":"HDD",hw:s.hw.name,v:s.v}));
  // ventole: solo quelle che girano (le intestazioni vuote leggono 0). Una ventola vista girare resta in elenco anche se si ferma.
  const names={};
  d.fans=T("fan").filter(s=>{const key=s.hw.name+"|"+s.sub+"|"+s.n;if(s.v>0)seenFans.add(key);return seenFans.has(key)}).map(s=>{
   let n=s.n;if(s.h=="gpu"&&!/gpu/i.test(n))n="GPU "+n;names[n]=(names[n]||0)+1;return{n:names[n]>1?n+" ("+names[n]+")":n,hw:s.hw.name,v:Math.round(s.v)}});
  // elenchi specializzati per monitoraggio avanzato e diagnostica
  d.volts=T("volt").filter(s=>s.v>0&&s.v<25).map(s=>({hw:s.hw.name+(s.sub?" / "+s.sub:""),h:s.h,n:s.n,v:s.v,u:s.u||"V"}));
  d.powers=T("power").filter(s=>s.v>=0&&s.v<1500).map(s=>({hw:s.hw.name,h:s.h,n:s.n,v:s.v,u:"W"}));
  d.clocks=T("clock").filter(s=>s.v>0).map(s=>({hw:s.hw.name,h:s.h,n:s.n,v:s.v,u:s.u||"MHz"}));
  d.tempsAll=T("temp").filter(s=>okT(s.v)&&!/distance|tjmax|limit|warning|critical|resolution/i.test(s.n)).map(s=>({hw:s.hw.name+(s.sub?" / "+s.sub:""),h:s.h,n:s.n,v:s.v,u:"°C"}));
  d.loadsAll=T("load").filter(s=>s.v>=0&&s.v<=100).map(s=>({hw:s.hw.name,h:s.h,n:s.n,v:s.v,u:"%"}));

  d.sens=L.filter(s=>s.k!="ctrl"&&s.k!="level"&&s.k!="factor"&&!(s.k=="temp"&&(!okT(s.v)||/distance|tjmax|resolution/i.test(s.n)))&&!(s.k=="fan"&&s.v<=0)).map(s=>{
   const hwName=s.hw.name+(s.sub?" / "+s.sub:"");
   const cat=s.k||"other";
   return{g:hwName+" • "+(GLAB[cat]||cat),hw:hwName,sub:s.sub||"",hwType:s.h,cat,catLabel:GLAB[cat]||cat,n:s.n,u:s.u,v:s.v};
  });
  // se LHM non espone traffico di rete ma systeminformation sì, aggiungilo
  if(!d.sens.some(s=>s.cat=="thr")&&net&&net[0]){
   sens.filter(s=>s.cat=="thr").forEach(s=>d.sens.push(s));
  }
 }else{
  // senza LibreHardwareMonitor: prova tutti i sensori che Windows/systeminformation espone direttamente
  if(now-tmpC.t>4000){tmpC.t=now;try{const t=await si.cpuTemperature();tmpC.v=t&&okT(t.main)?t.main:null;tmpC.cores=Array.isArray(t&&t.cores)?t.cores.filter(okT):[]}catch(e){tmpC.v=null;tmpC.cores=[]}}
  d.tc=tmpC.v;
  if(d.tc!=null){
   pushBase("CPU","cpu","temp","CPU Package","°C",d.tc);
   d.tempsAll.push({hw:"CPU",h:"cpu",n:"CPU Package",v:d.tc,u:"°C"});
  }
  (tmpC.cores||[]).forEach((tv,i)=>{pushBase("CPU","cpu","temp",`Core #${i} Temperatura`,"°C",tv);d.tempsAll.push({hw:"CPU",h:"cpu",n:`Core #${i}`,v:tv,u:"°C"})});

  if(now-gpuC.t>4000){gpuC.t=now;try{const gr=await si.graphics();gpuC.all=gr.controllers||[];gpuC.v=gpuC.all.find(c=>c.temperatureGpu||c.utilizationGpu!=null||c.vram)||gpuC.all[0]||null}catch(e){gpuC.v=null;gpuC.all=[]}}
  const g=gpuC.v;
  if(g){
   const gn=g.model||"GPU";
   d.tg=okT(g.temperatureGpu)?g.temperatureGpu:null;
   d.gpu=num(g.utilizationGpu);
   d.gclk=num(g.clockCore)||null;
   d.vram=num(g.memoryUsed)||null;
   d.vramTot=num(g.memoryTotal)||num(g.vram)||null;
   d.gwatt=num(g.powerDraw)||null;
   if(d.watt==null&&d.gwatt!=null)d.watt=d.gwatt;
   if(d.tg!=null){pushBase(gn,"gpu","temp","GPU Core Temperatura","°C",d.tg);d.tempsAll.push({hw:gn,h:"gpu",n:"GPU Core",v:d.tg,u:"°C"})}
   if(d.gpu!=null){pushBase(gn,"gpu","load","GPU Core Utilizzo","%",d.gpu);d.loadsAll.push({hw:gn,h:"gpu",n:"GPU Core",v:d.gpu,u:"%"})}
   if(num(g.utilizationMemory)!=null)pushBase(gn,"gpu","load","GPU Memory Controller","%",g.utilizationMemory);
   if(d.gclk!=null){pushBase(gn,"gpu","clock","GPU Core Clock","MHz",d.gclk);d.clocks.push({hw:gn,h:"gpu",n:"GPU Core Clock",v:d.gclk,u:"MHz"})}
   if(num(g.clockMemory)>0){pushBase(gn,"gpu","clock","GPU Memory Clock","MHz",g.clockMemory);d.clocks.push({hw:gn,h:"gpu",n:"GPU Memory Clock",v:g.clockMemory,u:"MHz"})}
   if(d.vram!=null)pushBase(gn,"gpu","data","GPU VRAM Usata","MB",d.vram);
   if(d.vramTot!=null)pushBase(gn,"gpu","data","GPU VRAM Totale","MB",d.vramTot);
   if(d.gwatt!=null){pushBase(gn,"gpu","power","GPU Power Draw","W",d.gwatt);d.powers.push({hw:gn,h:"gpu",n:"GPU Power Draw",v:d.gwatt,u:"W"})}
   if(num(g.fanSpeed)>0){pushBase(gn,"gpu","fan","GPU Ventola","RPM",g.fanSpeed)}
  }
  if(now-batC.t>10000){batC.t=now;try{const b=await si.battery();batC.v=b&&b.hasBattery?b:null}catch(e){batC.v=null}}
  if(batC.v){
   if(num(batC.v.voltage)>0){pushBase("Batteria","battery","volt","Tensione Batteria","V",batC.v.voltage);d.volts.push({hw:"Batteria",h:"battery",n:"Tensione Batteria",v:batC.v.voltage,u:"V"})}
   if(num(batC.v.percent)!=null)pushBase("Batteria","battery","data","Carica Batteria","%",batC.v.percent);
  }
  if(now-fsC.t>4000){fsC.t=now;try{fsC.v=await si.disksIO()}catch(e){fsC.v=null}}
  if(fsC.v&&num(fsC.v.tIO_sec)!=null){
   d.disk=Math.min(100,Math.round((fsC.v.tIO_sec||0)/5));
   pushBase("Archiviazione","disk","load","Attività I/O Disco","%",d.disk);
  }
  d.disks.forEach(dk=>{
   pushBase(`Disco ${dk.n}`,"disk","load",`Spazio Occupato (${dk.n})`,"%",dk.usePct);
   pushBase(`Disco ${dk.n}`,"disk","data",`Spazio Usato (${dk.n})`,"GB",+dk.used.toFixed(1));
   pushBase(`Disco ${dk.n}`,"disk","data",`Spazio Libero (${dk.n})`,"GB",+(dk.tot-dk.used).toFixed(1));
  });
  d.clocks=sens.filter(s=>s.cat=="clock").map(s=>({hw:s.hw,h:s.hwType,n:s.n,v:s.v,u:s.u}));
  d.loadsAll=sens.filter(s=>s.cat=="load").map(s=>({hw:s.hw,h:s.hwType,n:s.n,v:s.v,u:s.u}));
  d.sens=sens;
 }

 d.sensorSupport={
  lhm:!!j,
  temp:d.sens.some(s=>s.cat=="temp"),
  volt:d.sens.some(s=>s.cat=="volt"),
  clock:d.sens.some(s=>s.cat=="clock"),
  load:d.sens.some(s=>s.cat=="load"),
  fan:d.sens.some(s=>s.cat=="fan")||d.fans.length>0,
  power:d.sens.some(s=>s.cat=="power")||d.watt!=null||d.gwatt!=null,
  data:d.sens.some(s=>s.cat=="data"),
  thr:d.sens.some(s=>s.cat=="thr")
 };
 return d;
}

const fmt=x=>x?(x/1024)+" KB":"-";
const safe=(p,f)=>p.catch(()=>f);
async function info(){
 const [c,m,b,bi,g,dk,o,ni]=await Promise.all([
  safe(si.cpu(),{cache:{}}),
  safe(si.memLayout(),[]),
  safe(si.baseboard(),{}),
  safe(si.bios(),{}),
  safe(si.graphics(),{controllers:[]}),
  safe(si.diskLayout(),[]),
  safe(si.osInfo(),{}),
  safe(si.networkInterfaces(),[])
 ]);
 const tot=m.reduce((a,x)=>a+(x.size||0),0)/1073741824||Math.round(os.totalmem()/1073741824),up=Math.floor(os.uptime()/3600),ca=c.cache||{};
 const gp=(g.controllers||[]).slice().sort((a,b)=>(b.vram||0)-(a.vram||0))[0];
 const m0=m[0]||{};
 const activeNi=(Array.isArray(ni)?ni:[]).filter(x=>x&&!x.internal&&x.ip4);
 return{
  sum:{cpu:((c.manufacturer||"")+" "+(c.brand||"")).trim(),cores:(c.physicalCores||"?")+" Core / "+(c.cores||"?")+" Thread • "+(c.speedMax||c.speed||"?")+" GHz",gpu:gp?gp.model:"--",ram:Math.round(tot)+" GB "+(m0.type||"")+(m0.clockSpeed?" @ "+m0.clockSpeed+" MHz":""),os:String(o.distro||"Windows").replace(/^Microsoft\s+/i,""),ver:o.build?"Build "+o.build:""},
  cpu:[["Processore",((c.manufacturer||"")+" "+(c.brand||"")).trim()||"-"],["Famiglia / Modello",(c.family||"-")+" / "+(c.model||"-")],["Stepping",c.stepping||"-"],["Socket",c.socket||"-"],["Core fisici / Thread",(c.physicalCores||"-")+" / "+(c.cores||"-")],["Frequenza base / boost",(c.speed||"-")+" / "+(c.speedMax||"-")+" GHz"],["Cache L1d / L1i",fmt(ca.l1d)+" / "+fmt(ca.l1i)],["Cache L2",fmt(ca.l2)],["Cache L3",fmt(ca.l3)],["Virtualizzazione",c.virtualization?"Attiva":"Non attiva"]],
  flags:(c.flags||"").split(/[ ,]+/).filter(Boolean).slice(0,70),
  mem:[["Totale",tot.toFixed(0)+" GB ("+m.length+" moduli)"]].concat(m.map((x,i)=>["Modulo #"+i,(x.size/1073741824).toFixed(0)+" GB "+(x.type||"")+" @ "+(x.clockSpeed||"?")+" MHz • "+(x.manufacturer||"")+" "+(x.partNum||"").trim()+(x.voltageConfigured?" • "+x.voltageConfigured+" V":"")])),
  mb:[["Produttore",b.manufacturer||"-"],["Modello",b.model||"-"],["Versione",b.version||"-"],["Slot RAM massimi",b.memSlots||"-"],["BIOS",(bi.vendor||"")+" "+(bi.version||"")+" • "+(bi.releaseDate||"")]],
  gpu:(g.controllers||[]).flatMap((x,i)=>[["Scheda #"+i,x.model||"-"],["VRAM",(x.vram||0)+" MB"],["Driver",x.driverVersion||"-"],["Bus",x.bus||"-"]]),
  disks:dk.map(x=>[x.type||"Disco",x.name+" • "+(x.size/1e9).toFixed(0)+" GB • "+(x.interfaceType||"")+" • SMART: "+(x.smartStatus||"n/d")]),
  os:[["Sistema",(o.distro||"")+" "+(o.release||"")],["Build",o.build||"-"],["Architettura",o.arch||"-"],["Nome PC",o.hostname||"-"],["Rete attiva",activeNi.map(x=>`${x.iface} (${x.ip4}${x.speed?` • ${x.speed} Mbps`:""})`).join(", ")||"-"],["Uptime",Math.floor(up/24)+" giorni "+up%24+" ore"]],
  raw:{cpu:c,memLayout:m,baseboard:b,bios:bi,graphics:g,diskLayout:dk,osInfo:o,netIfaces:activeNi}
 };
}
module.exports={read,info,lhmOk,_walk:walk,_hwKind:hwKind,GLAB};
