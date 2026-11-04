// Modulo Analisi Avanzata della Rete, Benchmark DNS, Traceroute e Gaming Network Monitor
const dns=require("dns"),cp=require("child_process"),net=require("net");
const si=require("systeminformation");

const run=(cmd,args,opt)=>new Promise(r=>cp.execFile(cmd,args,Object.assign({windowsHide:true,timeout:45000,maxBuffer:8*1024*1024},opt||{}),(err,out,stderr)=>r({err,out:String(out||""),stderr:String(stderr||"")})));
const runPs=(script,timeout=25000)=>run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-Command",`[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'; ${script}`],{timeout});

let netInfoCache={t:0,data:null};
const pingHist=[]; // ultimi 120 campioni {ts, ms, ok, jitter, lossPct}

// Misura tempo di risposta TCP/ICMP rapido o ping nativo
async function measureHostPing(host,count=1){
 const ps=`
 $h = '${String(host).replace(/'/g,"")}'
 $res = @()
 $lost = 0
 for ($i=0; $i -lt ${Math.max(1,Math.min(10,count))}; $i++) {
   try {
     $p = Test-Connection -ComputerName $h -Count 1 -ErrorAction Stop
     $ms = if ($null -ne $p.ResponseTime) { [double]$p.ResponseTime } elseif ($null -ne $p.Latency) { [double]$p.Latency } else { 0 }
     $res += $ms
   } catch { $lost++ }
 }
 @{ rtts=$res; sent=${Math.max(1,Math.min(10,count))}; lost=$lost } | ConvertTo-Json -Compress
 `;
 const r=await runPs(ps,12000);
 try{
  const j=JSON.parse(r.out.trim());
  const rtts=Array.isArray(j.rtts)?j.rtts:(typeof j.rtts==="number"?[j.rtts]:[]);
  const sent=j.sent||count;
  const lost=j.lost!=null?j.lost:(sent-rtts.length);
  const lossPct=Math.round((lost/sent)*100);
  if(!rtts.length)return{host,ok:false,avgMs:null,minMs:null,maxMs:null,jitterMs:null,lossPct:100,rtts:[]};
  const avgMs=+(rtts.reduce((a,b)=>a+b,0)/rtts.length).toFixed(1);
  const minMs=Math.min(...rtts);
  const maxMs=Math.max(...rtts);
  let jitterSum=0;
  for(let i=1;i<rtts.length;i++)jitterSum+=Math.abs(rtts[i]-rtts[i-1]);
  const jitterMs=rtts.length>1?+(jitterSum/(rtts.length-1)).toFixed(1):0;
  return{host,ok:true,avgMs,minMs,maxMs,jitterMs,lossPct,rtts};
 }catch(e){
  return{host,ok:false,avgMs:null,minMs:null,maxMs:null,jitterMs:null,lossPct:100,rtts:[]};
 }
}

// Misura tempo reale di risoluzione DNS verso uno specifico server DNS
function resolveWithDnsServer(dnsIp,domain,timeoutMs=2200){
 return new Promise(resolve=>{
  const resolver=new dns.Resolver();
  try{resolver.setServers([dnsIp])}catch(e){return resolve({ok:false,ms:null,err:"IP DNS non valido"})}
  const t0= process.hrtime.bigint();
  let done=false;
  const timer=setTimeout(()=>{
   if(done)return;done=true;
   try{resolver.cancel()}catch(e){}
   resolve({ok:false,ms:null,err:"Timeout"});
  },timeoutMs);
  resolver.resolve4(domain,{ttl:false},(err,addresses)=>{
   if(done)return;done=true;
   clearTimeout(timer);
   const ms=Number(process.hrtime.bigint()-t0)/1e6;
   if(err||!addresses||!addresses.length)return resolve({ok:false,ms:null,err:err?err.code:"NoRecord"});
   resolve({ok:true,ms:+ms.toFixed(1),ip:addresses[0]});
  });
 });
}

async function getNetworkOverview(targetHost="1.1.1.1"){
 const now=Date.now();
 // Cache configurazione adattatore / gateway / DNS / Wi-Fi per 6 secondi
 if(!netInfoCache.data||now-netInfoCache.t>6000){
  const ps=`
  $out = [ordered]@{
    adapter = ""
    ifIndex = 0
    ipv4 = ""
    gateway = ""
    dnsServers = @()
    dhcpDns = $true
    linkSpeed = ""
    wifi = $null
    bgNetProcs = @()
  }
  try {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
    if ($route) {
      $out.gateway = [string]$route.NextHop
      $out.ifIndex = $route.InterfaceIndex
      $ip = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1
      if ($ip) { $out.ipv4 = [string]$ip.IPAddress }
      $ad = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex
      if ($ad) {
        $out.adapter = [string]$ad.Name
        $out.linkSpeed = [string]$ad.LinkSpeed
      }
      $dnsCfg = Get-DnsClientServerAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4
      if ($dnsCfg -and $dnsCfg.ServerAddresses) {
        $out.dnsServers = @($dnsCfg.ServerAddresses)
      }
    }
  } catch {}
  try {
    $wlan = (netsh wlan show interfaces) -join "\`n"
    if ($wlan -match 'State\\s*:\\s*connected|Stato\\s*:\\s*connesso') {
      $sig = $null; $ssid = ""; $radio = ""; $band = ""; $ch = ""
      if ($wlan -match '(?:Signal|Segnale)\\s*:\\s*(\\d+)%') { $sig = [int]$Matches[1] }
      if ($wlan -match 'SSID\\s*:\\s*([^\\r\\n]+)') { $ssid = $Matches[1].Trim() }
      if ($wlan -match '(?:Radio type|Tipo di radio)\\s*:\\s*([^\\r\\n]+)') { $radio = $Matches[1].Trim() }
      if ($wlan -match '(?:Band|Banda)\\s*:\\s*([^\\r\\n]+)') { $band = $Matches[1].Trim() }
      if ($wlan -match '(?:Channel|Canale)\\s*:\\s*([^\\r\\n]+)') { $ch = $Matches[1].Trim() }
      $out.wifi = @{ ssid=$ssid; signal=$sig; radio=$radio; band=$band; channel=$ch }
    }
  } catch {}
  try {
    $conns = Get-NetTCPConnection -State Established | Where-Object { $_.RemoteAddress -notmatch '^(127\\.|::1|0\\.0)' -and $_.OwningProcess -gt 4 }
    $grp = $conns | Group-Object OwningProcess | Sort-Object Count -Descending | Select-Object -First 8
    foreach ($g in $grp) {
      $pr = Get-Process -Id ([int]$g.Name) -ErrorAction SilentlyContinue
      if ($pr) {
        $out.bgNetProcs += @{ pid=[int]$g.Name; name=[string]$pr.Name; conns=$g.Count; memMB=[math]::Round($pr.WorkingSet64/1MB) }
      }
    }
  } catch {}
  $out | ConvertTo-Json -Depth 4 -Compress
  `;
  const r=await runPs(ps,12000);
  try{netInfoCache={t:now,data:JSON.parse(r.out.trim())}}catch(e){netInfoCache={t:now,data:{}}}
 }

 const cfg=netInfoCache.data||{};
 const sysDns=(cfg.dnsServers&&cfg.dnsServers.length)?cfg.dnsServers:dns.getServers().filter(x=>!x.includes(":"));
 const primaryDns=sysDns[0]||"1.1.1.1";

 // Ping rapido verso target + risoluzione DNS sul server attuale + ping gateway in parallelo
 const [pingTarget,dnsRes,pingGw,netStats]=await Promise.all([
  measureHostPing(targetHost,2),
  resolveWithDnsServer(primaryDns,"www.cloudflare.com",2000),
  cfg.gateway?measureHostPing(cfg.gateway,1):Promise.resolve(null),
  si.networkStats().catch(()=>[])
 ]);

 const activeStat=(netStats||[]).find(x=>(x.rx_sec||0)+(x.tx_sec||0)>0)||netStats[0]||{};
 const rxMBs=+((activeStat.rx_sec||0)/1048576).toFixed(2);
 const txMBs=+((activeStat.tx_sec||0)/1048576).toFixed(2);

 // Aggiorna storico ping/jitter/loss
 const prevOk=pingHist.filter(x=>x.ok);
 let curJitter=pingTarget.jitterMs||0;
 if(pingTarget.ok&&prevOk.length>0){
  const lastMs=prevOk[prevOk.length-1].ms;
  curJitter=+Math.abs(pingTarget.avgMs-lastMs).toFixed(1);
 }
 pingHist.push({
  ts:now,
  time:new Date(now).toLocaleTimeString("it-IT"),
  ms:pingTarget.avgMs,
  ok:pingTarget.ok,
  jitter:curJitter,
  lossPct:pingTarget.lossPct
 });
 if(pingHist.length>120)pingHist.shift();

 // Statistiche finestra recente
 const validPings=pingHist.filter(x=>x.ok&&x.ms!=null);
 const avgPingWin=validPings.length?+(validPings.reduce((a,x)=>a+x.ms,0)/validPings.length).toFixed(1):pingTarget.avgMs;
 const avgJitterWin=validPings.length?+(validPings.reduce((a,x)=>a+(x.jitter||0),0)/validPings.length).toFixed(1):curJitter;
 const totalLossWin=pingHist.length?Math.round(pingHist.filter(x=>!x.ok||x.lossPct>0).length/pingHist.length*100):pingTarget.lossPct;
 const spikesCount=validPings.filter(x=>x.ms>95||x.jitter>35).length;

 // Analisi anomalie Wi-Fi e Rete
 const anomalies=[];
 if(cfg.wifi){
  if(cfg.wifi.signal!=null&&cfg.wifi.signal<62){
   anomalies.push({sev:"warn",msg:`Segnale Wi-Fi debole (${cfg.wifi.signal}% su ${cfg.wifi.ssid}): può causare jitter e packet loss in gioco.`});
  }
  if(/2\.4\s*GHz|802\.11n|802\.11g/i.test((cfg.wifi.band||"")+" "+(cfg.wifi.radio||""))){
   anomalies.push({sev:"warn",msg:"Connessione Wi-Fi su banda 2.4 GHz o standard legacy: consigliato passare a Wi-Fi 5/6 (5 GHz) o cavo Ethernet per il gaming."});
  }
 }
 if(totalLossWin>0){
  anomalies.push({sev:"bad",msg:`Rilevata perdita pacchetti (${totalLossWin}% packet loss): possibili fenomeni di rubberbanding in partita.`});
 }
 if(avgJitterWin>25){
  anomalies.push({sev:"warn",msg:`Jitter elevato (${avgJitterWin} ms): la latenza oscilla sensibilmente.`});
 }
 if(dnsRes&&dnsRes.ms>85){
  anomalies.push({sev:"warn",msg:`Risposta DNS lenta (${dnsRes.ms} ms su ${primaryDns}): usa il Test DNS qui sotto per individuare un DNS più rapido.`});
 }

 let stabilityScore=100;
 if(!pingTarget.ok)stabilityScore=10;
 else{
  if(avgPingWin>50)stabilityScore-=Math.min(30,Math.round((avgPingWin-50)*0.4));
  if(avgJitterWin>8)stabilityScore-=Math.min(25,Math.round((avgJitterWin-8)*0.8));
  if(totalLossWin>0)stabilityScore-=Math.min(45,totalLossWin*3);
 }
 stabilityScore=Math.max(5,Math.min(100,stabilityScore));

 return{
  timestamp:now,
  targetHost,
  adapter:cfg.adapter||activeStat.iface||"Scheda di rete",
  ifIndex:cfg.ifIndex||0,
  ipv4:cfg.ipv4||"--",
  gateway:cfg.gateway||"--",
  gatewayPingMs:pingGw&&pingGw.ok?pingGw.avgMs:null,
  linkSpeed:cfg.linkSpeed||"--",
  dnsServers:sysDns,
  primaryDns,
  dnsLookupMs:dnsRes&&dnsRes.ok?dnsRes.ms:null,
  dnsOk:!!(dnsRes&&dnsRes.ok),
  pingMs:pingTarget.avgMs,
  pingMinMs:validPings.length?Math.min(...validPings.map(x=>x.ms)):pingTarget.minMs,
  pingMaxMs:validPings.length?Math.max(...validPings.map(x=>x.ms)):pingTarget.maxMs,
  jitterMs:avgJitterWin,
  lossPct:totalLossWin,
  rxMBs,
  txMBs,
  wifi:cfg.wifi||null,
  anomalies,
  bgNetProcs:cfg.bgNetProcs||[],
  stabilityScore,
  stabilityStatus:stabilityScore>=85?"ok":stabilityScore>=60?"warn":"bad",
  spikesCount,
  history:pingHist.slice(-60)
 };
}

/* ---------- TEST E CONFRONTO DNS ---------- */
const DEFAULT_DNS_PROVIDERS=[
 {id:"cloudflare",name:"Cloudflare DNS",ip:"1.1.1.1",sec:"1.0.0.1"},
 {id:"google",name:"Google Public DNS",ip:"8.8.8.8",sec:"8.8.4.4"},
 {id:"quad9",name:"Quad9 Security DNS",ip:"9.9.9.9",sec:"149.112.112.112"},
 {id:"opendns",name:"Cisco OpenDNS",ip:"208.67.222.222",sec:"208.67.220.220"}
];
const TEST_DOMAINS=["www.cloudflare.com","www.google.com","store.steampowered.com","www.epicgames.com","www.microsoft.com"];

async function benchmarkDns(customServers=[]){
 const ov=await getNetworkOverview();
 const curDnsIp=(ov.dnsServers&&ov.dnsServers[0])||"1.1.1.1";
 const list=[
  {id:"current",name:`DNS Attuale (${curDnsIp})`,ip:curDnsIp,sec:ov.dnsServers[1]||"",isCurrent:true},
  ...DEFAULT_DNS_PROVIDERS.filter(d=>d.ip!==curDnsIp)
 ];
 (customServers||[]).forEach((c,idx)=>{
  const ip=String(c.ip||c||"").trim();
  if(ip&&/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)&&!list.some(x=>x.ip===ip)){
   list.push({id:`custom_${idx}`,name:c.name||`DNS Personalizzato (${ip})`,ip,sec:c.sec||"",isCustom:true});
  }
 });

 const results=[];
 for(const item of list){
  const pingRes=await measureHostPing(item.ip,3);
  const resTimes=[];
  let timeouts=0;
  for(const dom of TEST_DOMAINS){
   const r=await resolveWithDnsServer(item.ip,dom,2000);
   if(r.ok&&r.ms!=null)resTimes.push(r.ms);
   else timeouts++;
  }
  const avgResolveMs=resTimes.length?+(resTimes.reduce((a,b)=>a+b,0)/resTimes.length).toFixed(1):null;
  const minResolveMs=resTimes.length?Math.min(...resTimes):null;
  const maxResolveMs=resTimes.length?Math.max(...resTimes):null;
  const resolveJitter=resTimes.length>1?+(maxResolveMs-minResolveMs).toFixed(1):0;
  const successRate=Math.round((resTimes.length/TEST_DOMAINS.length)*100);
  // Punteggio combinato (più basso è meglio per l'ordinamento)
  const rankMetric=(avgResolveMs!=null?avgResolveMs:999)+(pingRes.avgMs!=null?pingRes.avgMs*0.6:300)+(timeouts*150);
  results.push({
   id:item.id,
   name:item.name,
   ip:item.ip,
   sec:item.sec||"",
   isCurrent:!!item.isCurrent,
   isCustom:!!item.isCustom,
   pingMs:pingRes.avgMs,
   pingJitterMs:pingRes.jitterMs,
   resolveAvgMs:avgResolveMs,
   resolveMinMs:minResolveMs,
   resolveMaxMs:maxResolveMs,
   resolveJitterMs:resolveJitter,
   successRate,
   timeouts,
   status:timeouts===0&&(avgResolveMs||99)<45?"ok":timeouts<=1&&(avgResolveMs||99)<110?"warn":"bad",
   rankMetric
  });
 }

 results.sort((a,b)=>a.rankMetric-b.rankMetric);
 results.forEach((r,i)=>{r.rank=i+1;r.recommended=i===0&&r.timeouts===0});
 return{
  testedAt:new Date().toLocaleString("it-IT"),
  adapter:ov.adapter,
  ifIndex:ov.ifIndex,
  currentDns:ov.dnsServers,
  best:results[0]||null,
  results
 };
}

async function applyDnsToWindows(ifIndex,adapterName,primaryIp,secondaryIp){
 if(!primaryIp)return{ok:false,msg:"Indirizzo DNS primario mancante."};
 const target=ifIndex>0?`-InterfaceIndex ${ifIndex}`:`-InterfaceAlias '${String(adapterName).replace(/'/g,"''")}'`;
 const addrs=secondaryIp?`@('${primaryIp}','${secondaryIp}')`:`@('${primaryIp}')`;
 const ps=`
 try {
   Set-DnsClientServerAddress ${target} -ServerAddresses ${addrs} -ErrorAction Stop
   Clear-DnsClientCache -ErrorAction SilentlyContinue
   'OK'
 } catch {
   $_.Exception.Message
 }
 `;
 const r=await runPs(ps,15000);
 netInfoCache.t=0;
 const out=(r.out||"").trim();
 if(out==="OK")return{ok:true,msg:`DNS impostato con successo su ${primaryIp}${secondaryIp?`, ${secondaryIp}`:""} (cache DNS svuotata).`};
 return{ok:false,msg:`Impossibile applicare il DNS (richiede privilegi di Amministratore): ${out}`};
}

async function resetDnsToDhcp(ifIndex,adapterName){
 const target=ifIndex>0?`-InterfaceIndex ${ifIndex}`:`-InterfaceAlias '${String(adapterName).replace(/'/g,"''")}'`;
 const ps=`
 try {
   Set-DnsClientServerAddress ${target} -ResetServerAddresses -ErrorAction Stop
   Clear-DnsClientCache -ErrorAction SilentlyContinue
   'OK'
 } catch {
   $_.Exception.Message
 }
 `;
 const r=await runPs(ps,15000);
 netInfoCache.t=0;
 const out=(r.out||"").trim();
 if(out==="OK")return{ok:true,msg:"DNS ripristinato su automatico (DHCP)."};
 return{ok:false,msg:`Errore durante il ripristino DNS: ${out}`};
}

/* ---------- TRACEROUTE ---------- */
async function runTraceroute(targetHost="1.1.1.1"){
 const cleanHost=String(targetHost||"1.1.1.1").replace(/[^a-zA-Z0-9.\-]/g,"");
 const r=await run("tracert.exe",["-d","-h","18","-w","700",cleanHost],{timeout:60000});
 const lines=(r.out||"").split(/\r?\n/);
 const hops=[];
 for(const ln of lines){
  const m=ln.match(/^\s*(\d+)\s+(.+)$/);
  if(!m)continue;
  const hopNum=parseInt(m[1],10);
  const rest=m[2].trim();
  if(/\*\s+\*\s+\*/.test(rest)){
   hops.push({hop:hopNum,ip:"Richiesta scaduta (Timeout ICMP)",rtts:[],avgMs:null,status:"timeout"});
   continue;
  }
  const rtts=[];
  const msMatches=[...rest.matchAll(/(?:<\s*1|\d+)\s*ms/gi)];
  msMatches.forEach(mm=>{
   const n=mm[0].includes("<")?0.5:parseFloat(mm[0]);
   if(Number.isFinite(n))rtts.push(n);
  });
  const ipMatch=rest.match(/(\d{1,3}(?:\.\d{1,3}){3})\s*$/);
  const ip=ipMatch?ipMatch[1]:"Nodo intermedio";
  const avgMs=rtts.length?+(rtts.reduce((a,b)=>a+b,0)/rtts.length).toFixed(1):null;
  const status=avgMs==null?"timeout":avgMs>110?"bad":avgMs>55?"warn":"ok";
  hops.push({hop:hopNum,ip,rtts,avgMs,status});
 }
 return{
  targetHost:cleanHost,
  completedAt:new Date().toLocaleString("it-IT"),
  hops
 };
}

function formatNetworkReportTxt(payload){
 const {overview,dnsBench,traceroute,stabilitySummary}=payload||{};
 const sep="=".repeat(80);
 const sub="-".repeat(80);
 const lines=[
  sep,
  "  PEPPEZ HARDWARE ANALYTICS - RAPPORTO AVANZATO DIAGNOSTICA DI RETE E DNS",
  sep,
  `Data e ora report : ${new Date().toLocaleString("it-IT")}`,
  ""
 ];
 if(overview){
  lines.push(sep,"  1. PARAMETRI DI CONNESSIONE E QUALITÀ DELLA RETE",sub);
  lines.push(`Scheda di rete attiva : ${overview.adapter} (${overview.linkSpeed})`);
  lines.push(`Indirizzo IPv4 locale : ${overview.ipv4} | Gateway: ${overview.gateway} (${overview.gatewayPingMs!=null?overview.gatewayPingMs+" ms":"n/d"})`);
  lines.push(`DNS configurati       : ${(overview.dnsServers||[]).join(", ")||"Automatico"}`);
  lines.push(`Risoluzione DNS       : ${overview.dnsLookupMs!=null?overview.dnsLookupMs+" ms":"Timeout"}`);
  lines.push(`Ping / Latenza (${overview.targetHost}) : ${overview.pingMs!=null?overview.pingMs+" ms":"Timeout"} (Min: ${overview.pingMinMs||"--"} ms | Max: ${overview.pingMaxMs||"--"} ms)`);
  lines.push(`Jitter                : ${overview.jitterMs!=null?overview.jitterMs+" ms":"--"}`);
  lines.push(`Packet Loss           : ${overview.lossPct}%`);
  lines.push(`Traffico Attuale      : Download ${overview.rxMBs} MB/s | Upload ${overview.txMBs} MB/s`);
  lines.push(`Punteggio Stabilità   : ${overview.stabilityScore}/100 [${overview.stabilityStatus.toUpperCase()}]`);
  if(overview.wifi){
   lines.push(`Dettagli Wi-Fi        : SSID ${overview.wifi.ssid} | Segnale ${overview.wifi.signal}% | Radio ${overview.wifi.radio} ${overview.wifi.band}`);
  }
  if(overview.anomalies&&overview.anomalies.length){
   lines.push("","Anomalie di rete rilevate:");
   overview.anomalies.forEach(a=>lines.push(`  - [${a.sev.toUpperCase()}] ${a.msg}`));
  }
  lines.push("");
 }
 if(stabilitySummary){
  lines.push(sep,"  2. TEST DI STABILITÀ DELLA CONNESSIONE",sub);
  lines.push(`Target: ${stabilitySummary.target} | Durata: ${stabilitySummary.duration} | Campioni: ${stabilitySummary.samples}`);
  lines.push(`Ping Medio: ${stabilitySummary.avgPing} ms | Min: ${stabilitySummary.minPing} ms | Max: ${stabilitySummary.maxPing} ms`);
  lines.push(`Jitter Medio: ${stabilitySummary.avgJitter} ms | Packet Loss: ${stabilitySummary.lossPct}% | Picchi (>100ms): ${stabilitySummary.spikes}`);
  lines.push(`Esito: ${stabilitySummary.verdict}`);
  lines.push("");
 }
 if(dnsBench&&Array.isArray(dnsBench.results)){
  lines.push(sep,"  3. BENCHMARK COMPARATIVO SERVER DNS",sub);
  lines.push(`${"#".padEnd(3)} | ${"Provider DNS".padEnd(28)} | ${"IP Primario".padEnd(15)} | ${"Risoluzione".padStart(12)} | ${"Ping".padStart(9)} | ${"Stabilità".padStart(10)}`);
  lines.push(sub);
  dnsBench.results.forEach(r=>{
   lines.push(`${String(r.rank).padEnd(3)} | ${r.name.slice(0,28).padEnd(28)} | ${r.ip.padEnd(15)} | ${(r.resolveAvgMs!=null?r.resolveAvgMs+" ms":"Timeout").padStart(12)} | ${(r.pingMs!=null?r.pingMs+" ms":"--").padStart(9)} | ${(r.successRate+"%").padStart(10)}${r.recommended?" [CONSIGLIATO]":""}`);
  });
  lines.push("");
 }
 if(traceroute&&Array.isArray(traceroute.hops)){
  lines.push(sep,`  4. TRACEROUTE VERSO ${traceroute.targetHost}`,sub);
  traceroute.hops.forEach(h=>{
   lines.push(`Hop ${String(h.hop).padStart(2)} : ${h.ip.padEnd(34)} | Media: ${h.avgMs!=null?h.avgMs+" ms":"* * *"} [${h.status.toUpperCase()}]`);
  });
  lines.push("");
 }
 lines.push(sep,"Generato da PeppeZ Hardware Analytics",sep);
 return lines.join("\r\n");
}

module.exports={
 getNetworkOverview,
 measureHostPing,
 benchmarkDns,
 applyDnsToWindows,
 resetDnsToDhcp,
 runTraceroute,
 formatNetworkReportTxt
};

