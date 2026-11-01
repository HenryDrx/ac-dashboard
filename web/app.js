'use strict';
const el = id => document.getElementById(id);
const available = x => typeof x === 'number' && Number.isFinite(x);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const defaults = {maxRpm:null, shift:90, low:75, high:100, history:10};
let scaleLimit = null;
let prefs = {...defaults}, carKey = '', current = null, history = [], gTrail = [];
let lastMessage = 0, lastFrame = 0, connected = false, offlineMessage = '';
let previousPit=null,previousInvalid=false,pitOwnsPage=false,lapIdentity='',alertUntil=0;
function pitState(data){return !!(data?.in_pit||data?.in_pit_lane);}
function sessionAlert(message){
  const node=el('session-alert');node.querySelector('strong').textContent=message;
  node.hidden=false;node.classList.remove('announce');void node.offsetWidth;node.classList.add('announce');
  alertUntil=performance.now()+1700;
}
function updateSessionEvents(data,changedCar){
  const pit=pitState(data),identity=`${data.car}/${data.track}/${data.session}/${data.lap}`;
  if(changedCar){previousPit=null;previousInvalid=false;pitOwnsPage=false;}
  if(identity!==lapIdentity){lapIdentity=identity;previousInvalid=false;}
  const invalid=!!(data.current_lap_invalid||data.lap_valid===false||data.track_limits);
  el('lap-time').classList.toggle('invalid',invalid);
  if(data.track_limits&&!previousInvalid&&!pit)sessionAlert('TRACK LIMITS');
  previousInvalid=invalid;
  if(navigationBusy)return; // Retry pit transitions after a manual slide finishes.
  if(pit&&previousPit!==true){
    if(previousPit===false)sessionAlert('PITS');
    controlContext='auto';controlTab='pitplan';showPage('controls');pitOwnsPage=true;
  }else if(!pit&&previousPit===true&&pitOwnsPage){if(activePage==='controls')showPage('dashboard');pitOwnsPage=false;}
  previousPit=pit;
}
const niceName = s => (s || '').replace(/^ks_/, '').replaceAll('_', ' ').replace(/\s+/g, ' ').trim().toUpperCase();
function tyreColour(temp,curve,optimum){
  if(!available(temp))return '#46505d';
  let hot=false,amount=0;
  if(Array.isArray(curve)&&curve.length>1){
    const peak=Math.max(...curve.map(p=>p[1]));
    const top=curve.filter(p=>p[1]>=peak*.9995);
    const low=top[0][0],high=top.at(-1)[0];
    if(temp>=low&&temp<=high)return 'rgb(0,255,0)';
    hot=temp>high;
    let grip=curve[0][1];
    if(temp>=curve.at(-1)[0])grip=curve.at(-1)[1];
    else for(let i=1;i<curve.length;i++)if(temp<=curve[i][0]){
      const a=curve[i-1],b=curve[i];grip=a[1]+(b[1]-a[1])*clamp((temp-a[0])/(b[0]-a[0]),0,1);break;
    }
    // Explicit UI policy: progressively tint outside peak; 2% thermal-grip
    // loss reaches the end colour. These are NOT claimed Kunos C++ thresholds.
    amount=clamp((1-grip/peak)/.02,0,1);
  }else{
    const centre=available(optimum)?optimum:(prefs.low+prefs.high)/2;
    hot=temp>centre;amount=clamp((Math.abs(temp-centre)-2)/8,0,1);
  }
  const colours=hot?[[0,255,0],[255,128,0],[255,0,0]]:[[0,255,0],[0,128,255],[0,0,255]];
  const i=amount<.5?0:1,t=amount<.5?amount*2:(amount-.5)*2;
  return `rgb(${colours[i].map((v,j)=>Math.round(v+(colours[i+1][j]-v)*t)).join(',')})`;
}
function gearNeighbours(gear,count){
  const maximum=Number.isInteger(count)&&count>0?count:null;
  const gears=['R','N',...Array.from({length:maximum||Math.max(1,Number(gear)||1)},(_,i)=>String(i+1))];
  const index=gears.indexOf(gear);
  return {previous:index<0?'':gears.slice(Math.max(0,index-2),index).join(' '),next:index<0||maximum===null?'':gears.slice(index+1,index+3).join(' ')};
}
function lapTime(ms) {
  if (!available(ms)) return '—:—.---';
  ms = Math.max(0, Math.round(ms));
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
}
function loadPrefs(car) {
  const key = `ac-dash-v3:${car || 'unknown'}`;
  if (key === carKey) return;
  carKey = key;
  prefs = {...defaults};
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && [saved.shift,saved.low,saved.high,saved.history].every(available)
        && saved.low < saved.high && [5,10,20].includes(saved.history)
        && saved.shift >= 50 && saved.shift <= 100
        && saved.low >= 20 && saved.high <= 200
        && (saved.maxRpm === null || available(saved.maxRpm) && saved.maxRpm >= 1000 && saved.maxRpm <= 30000)) prefs = {...defaults,...saved};
  } catch {} // Storage can be disabled in Safari private/restricted contexts.
  el('history-length').textContent = `${prefs.history} SEC`;
}
function setAid(id, value, mode='setting') {
  const node = el(id), b = node.querySelector('b');
  node.className = '';
  b.textContent = '—';
  if (value === null || value === undefined) return;
  if (mode === 'charge') {b.textContent = `${Math.round(value * 100)}%`; node.classList.add('enabled');}
  else if (mode === 'switch') {b.textContent = value ? 'ON' : 'OFF'; if (value) node.classList.add('active');}
  else {b.textContent = value > 0 ? 'ON' : 'OFF'; if (value > 0) node.classList.add('enabled');}
}
function clear(message) {
  if (offlineMessage === message && !current) return;
  offlineMessage = message;
  current = null; history = []; gTrail = [];
  previousPit=null;previousInvalid=false;pitOwnsPage=false;
  el('race-line').hidden=true;el('lap-time').classList.remove('invalid');el('session-alert').hidden=true;
  for(const id of ['throttle','brake']){el(`${id}-fill`).style.height='0%';el(`${id}-pct`).textContent='—';}
  el('delta-meter-fill').style.width='0%';
  el('badge').textContent = 'OFFLINE'; el('badge').className = '';
  el('status').textContent = message;
  el('footer-state').textContent = message;
  for (const id of ['speed','gear','rpm','max-rpm','lap','fuel','best','lap-time','delta','session-value','rpm-percent','g-value','throttle','brake']) el(id).textContent = '—';
  el('steering-angle').textContent='—°';el('steering-marker').style.left='50%';
  el('steering-marker').hidden=true;buildRpmScale(null);
  for (const id of ['tc','abs','drs','kers']) setAid(id,null);
  for (let i=0;i<4;i++) {
    el(`tyre-${i}`).querySelector('b').textContent = '—';
    el(`tyre-${i}`).style.borderColor = '#46505d';
    el(`tyre-${i}`).style.color = '';
    el(`tyre-${i}`).querySelector('.tyre-fill').style.height='0%';
    el(`tyre-${i}`).querySelector('small').textContent='';
    el(`tyre-${i}`).className='tyre';
  }
  el('gear-prev').textContent = ''; el('gear-next').textContent = '';
  el('progress-fill').style.width = '0%'; el('rpm-fill').style.width = '0%';
  el('rpm-strip').classList.remove('shift'); el('shift-label').textContent = 'NO DATA';
  el('delta').className = ''; el('delta-note').textContent = 'Waiting for telemetry';
  el('flag').textContent = '';
}
function render(data) {
  if(data.controller){controllerCache=data.controller;controllerUpdated=Date.now();}
  if (!['live','mock'].includes(data.status)) return clear(data.message || 'No telemetry.');
  if(data.status==='mock'&&!data.csp_connected){
    const t=performance.now()/1000;
    data={...data,csp_connected:true,steering_deg:Math.sin(t/3)*130,steering_lock:450,
      gear_count:7,tc_mode:2,tc_modes:2,abs_mode:1,abs_modes:3,tyre_surface:[[77,82,87],[86,91,94],[90,95,99],[85,89,93]],
      tyre_optimum:[90,90,90,90],tyre_wear_fraction:[.08,.12,.2,.15],tyre_flatspot:[0,0,0,0]};
  }
  if (!available(data.speed) || !available(data.rpm) || typeof data.gear !== 'string') throw new Error('Invalid core readings');
  const changedCar = current && (current.car !== data.car || current.track !== data.track || current.session !== data.session || current.status !== data.status);
  if (changedCar) {history=[]; gTrail=[];}
  current = data; offlineMessage = '';
  loadPrefs(data.car);
  el('badge').textContent = data.status.toUpperCase(); el('badge').className = data.status;
  el('status').textContent = data.status === 'mock' ? 'SIMULATED SESSION' : data.csp_connected ? 'TELEMETRY + BRIDGE CONNECTED' : 'BASIC TELEMETRY · BRIDGE OFFLINE';
  el('footer-state').textContent = data.status === 'mock' ? 'DEMO DATA · NO GAME CONNECTION' : 'LOCAL TELEMETRY · ORIGINAL ASSETTO CORSA';
  el('car').textContent = niceName(data.car) || 'ASSETTO CORSA';
  updateCarBadge(data.car);
  el('track').textContent = niceName(data.track) || 'Metadata unavailable';
  el('speed').textContent = Math.round(data.speed); el('rpm').textContent = Math.round(data.rpm).toLocaleString();
  el('gear').textContent = data.gear;
  const count = Number.isInteger(data.gear_count) && data.gear_count > 0 ? data.gear_count : null;
  const neighbours=gearNeighbours(data.gear,count);
  el('gear-prev').textContent=neighbours.previous;
  el('gear-next').textContent=neighbours.next;
  document.querySelector('.gear-trace').textContent = count ? `GEAR / ${count}` : 'GEAR —';
  el('lap').textContent = available(data.lap) ? String(data.lap).padStart(2,'0') : '—';
  el('lap-time').textContent = lapTime(data.lap_ms); el('best').textContent = lapTime(data.best_lap_ms);
  el('fuel').textContent = available(data.fuel) ? `${data.fuel.toFixed(1)} L` : '—';
  el('delta').textContent = available(data.delta) ? `${data.delta >= 0 ? '+' : '−'}${Math.abs(data.delta).toFixed(3)}` : data.current_lap_invalid?'INVALID':data.delta_reference_ms?'WAIT':'LEARN';
  el('delta').className = available(data.delta) ? (data.delta < 0 ? 'ahead' : 'behind') : '';
  el('delta-note').textContent = available(data.delta) ? `vs ${data.delta_source||'recorded best'}` : data.delta_state || (data.delta_reference_ms ? 'Delta unavailable' : 'Learning lap');
  el('delta').title=el('delta-note').textContent;
  const meter=el('delta-meter-fill'),fraction=available(data.delta)?clamp(Math.abs(data.delta)/2,0,1)*50:0;
  meter.style.width=`${fraction}%`;meter.style.left=data.delta<0?`${50-fraction}%`:'50%';meter.style.background=data.delta<0?'var(--green)':'var(--red)';
  const racePosition = typeof data.is_race==='boolean'?data.is_race:data.session===2;
  el('race-line').hidden=!racePosition;
  el('race-position').textContent=available(data.position)&&data.position>0?`P${data.position}`:'—';
  el('session-label').textContent='LAP PROGRESS';
  el('session-value').textContent=available(data.lap_progress)?`${Math.round(data.lap_progress*100)}%`:'—';
  el('progress-fill').style.width = `${available(data.lap_progress) ? clamp(data.lap_progress*100,0,100) : 0}%`;
  el('flag').textContent = data.in_pit ? 'PIT' : ({1:'BLUE FLAG',2:'YELLOW FLAG',3:'BLACK FLAG',4:'WHITE FLAG',5:'CHEQUERED',6:'PENALTY'}[data.flag] || '');
  setAid('tc',data.tc_mode??null); setAid('abs',data.abs_mode??null); setAid('drs',data.drs,'switch'); setAid('kers',data.kers,'charge');
  for(const id of ['tc','abs']) if(Number.isInteger(data[`${id}_mode`])) {
    const mode=data[`${id}_mode`],total=data[`${id}_modes`];
    el(id).querySelector('b').textContent=total===0?'N/A':mode===0?'OFF':`${mode}${Number.isInteger(total)&&total>0?'/'+total:''}`;
    el(id).className=mode>0?'enabled':'';
  }
  if (data.drs === false && data.drs_available) {el('drs').querySelector('b').textContent='READY'; el('drs').className='enabled';}
  const steering=data.steering_deg;
  el('steering-angle').textContent=available(steering)?`${steering<0?'−':'+'}${Math.abs(steering).toFixed(0)}°`:'—°';
  el('steering-marker').hidden=!available(steering);
  el('steering-marker').style.left=`${available(steering)?50+clamp(steering/(data.steering_lock||450),-1,1)*47:50}%`;
  el('steering-angle').title=available(steering)?'Steering-wheel rotation in degrees; not the front road-wheel angle.':'Enable AC Dash Bridge in CSP to receive steering-wheel degrees.';
  el('tyre-source').textContent=data.csp_connected?'SURFACE / LIFE':'CORE °C · BRIDGE OFFLINE';
  for (let i=0;i<4;i++) {
    const node=el(`tyre-${i}`), surface=data.tyre_surface?.[i],optimum=data.tyre_optimum?.[i];
    const curve=data.thermal_curves?.[i<2?'front':'rear'];
    const colour=v=>tyreColour(v,curve,optimum);
    const zones=surface?.length===3?(i%2===0?[...surface].reverse():surface):Array(3).fill(data.tyre_temps?.[i]);
    const fill=node.querySelector('.tyre-fill');
    fill.style.background=`linear-gradient(90deg,${colour(zones[0])} 0% 33.33%,${colour(zones[1])} 33.33% 66.66%,${colour(zones[2])} 66.66% 100%)`;
    const worn=data.tyre_wear_fraction?.[i],remaining=available(worn)?clamp((1-worn)*100,0,100):null;
    fill.style.height=`${remaining??100}%`;
    node.querySelector('b').textContent=remaining===null?(available(data.tyre_temps?.[i])?`${Math.round(data.tyre_temps[i])}°`:'—'):`${Math.round(remaining)}%`;
    const flat=available(data.tyre_flatspot?.[i])&&data.tyre_flatspot[i]>.01;
    const locking=data.brake>10&&data.speed>20&&available(data.tyre_slip_ratio?.[i])&&data.tyre_slip_ratio[i]<-.3;
    node.className=`tyre${locking?' locking':''}${flat?' flatspot':''}`;
    node.querySelector('small').textContent=locking?'LOCK?':flat?'FLAT':'';
    node.style.borderColor='#46505d';node.style.color='';
    node.title=`${['Front left','Front right','Rear left','Rear right'][i]} · surface I/M/O ${surface?surface.map(v=>available(v)?v.toFixed(1):'—').join('/'):'unavailable'} °C · remaining ${remaining===null?'unavailable':remaining.toFixed(1)+'%'}${flat?' · flat spot reported':''}${locking?' · estimated lockup':''}`;
  }
  const limit = prefs.maxRpm || data.rpm_limit || data.max_rpm;
  buildRpmScale(limit);
  el('max-rpm').textContent=available(limit)?Math.round(limit).toLocaleString():'—';
  const pct = available(limit) && limit > 0 ? clamp(data.rpm/limit*100,0,100) : null;
  document.querySelector('.delta-box').classList.toggle('learning',!available(data.delta));
  const shift = available(pct) && pct >= prefs.shift && data.gear !== 'N' && data.gear !== 'R';
  el('rpm-fill').style.width = `${pct ?? 0}%`; el('rpm-percent').textContent = pct === null ? '—%' : `${Math.round(pct)}%`;
  el('rpm-strip').classList.toggle('shift',shift); el('shift-label').textContent = shift ? 'SHIFT' : pct === null ? 'SET RPM LIMIT' : 'RPM';
  el('g-value').textContent = available(data.g_lateral) && available(data.g_longitudinal) ? `${Math.hypot(data.g_lateral,data.g_longitudinal).toFixed(2)} G` : '—';
  for (const id of ['throttle','brake']) el(id).textContent = available(data[id]) ? `${Math.round(data[id])}%` : '—';
  for(const id of ['throttle','brake']){el(`${id}-fill`).style.height=`${available(data[id])?clamp(data[id],0,100):0}%`;el(`${id}-pct`).textContent=available(data[id])?`${Math.round(data[id])}%`:'—';}
  const now=performance.now();
  history.push({t:now,throttle:data.throttle,brake:data.brake,gear:data.gear==='R' ? -1 : data.gear==='N' ? 0 : Number(data.gear)});
  history=history.filter(s=>now-s.t<=20000);
  if (available(data.g_lateral) && available(data.g_longitudinal)) gTrail.push({t:now,x:data.g_lateral,y:data.g_longitudinal});
  gTrail=gTrail.filter(s=>now-s.t<15000);
  updateSessionEvents(data,changedCar);
}
function canvasFor(id) {
  const canvas=el(id), box=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio || 1;
  const width=Math.round(box.width*dpr),height=Math.round(box.height*dpr);
  if (canvas.width!==width || canvas.height!==height) {canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,box.width,box.height);
  return [ctx,box.width,box.height];
}
function buildRpmScale(limit) {
  const value=available(limit)&&limit>0?limit:null;
  if(value===scaleLimit && document.querySelector('.rpm-ticks').childElementCount)return;
  scaleLimit=value;
  const ticks=document.querySelector('.rpm-ticks');ticks.replaceChildren();
  if(!value)return;
  for(let n=1000;n<value;n+=1000){
    const tick=document.createElement('span');tick.style.left=`${n/value*100}%`;
    const label=document.createElement('small');label.textContent=n/1000;tick.appendChild(label);ticks.appendChild(tick);
  }
}
function drawG(now) {
  const [c,w,h]=canvasFor('g-canvas'), x=w/2,y=h/2,r=Math.max(8,Math.min(w,h)/2-3);
  c.strokeStyle='#303741'; c.lineWidth=1;
  for (const ratio of [.5,1]) {c.beginPath();c.arc(x,y,r*ratio,0,Math.PI*2);c.stroke();}
  c.beginPath();c.moveTo(x-r-5,y);c.lineTo(x+r+5,y);c.moveTo(x,y-r-5);c.lineTo(x,y+r+5);c.stroke();
  c.font='8px system-ui';c.fillStyle='#8b94a1';c.fillText('2G',x+r-12,y-4);
  if (!current) return;
  function point(s){return [x+clamp(s.x/2,-1,1)*r,y-clamp(s.y/2,-1,1)*r];}
  const trail=gTrail.filter(s=>now-s.t<1200);
  // Recent 15-second directional envelope, separate from the short moving trail.
  const bins=Array(36).fill(0);
  for(const s of gTrail.filter(s=>now-s.t<15000)){const angle=(Math.atan2(s.y,s.x)+Math.PI*2)%(Math.PI*2),i=Math.floor(angle/(Math.PI*2)*36);bins[i]=Math.max(bins[i],Math.hypot(s.x,s.y));}
  c.beginPath();bins.forEach((v,i)=>{const a=(i+.5)/36*Math.PI*2,p=point({x:Math.cos(a)*v,y:Math.sin(a)*v});i?c.lineTo(...p):c.moveTo(...p);});c.closePath();c.fillStyle='#74b9ef20';c.strokeStyle='#74b9ef99';c.fill();c.stroke();
  c.lineWidth=1.5;c.strokeStyle='#bba544';c.beginPath();trail.forEach((s,i)=>{const p=point(s);i?c.lineTo(...p):c.moveTo(...p);});c.stroke();
  if (trail.length){const p=point(trail.at(-1));c.fillStyle='#f4d34c';c.beginPath();c.arc(...p,4,0,Math.PI*2);c.fill();}
}
function drawHistory(now) {
  const [c,w,h]=canvasFor('history-canvas');
  c.strokeStyle='#272d35';c.lineWidth=1;
  for(let i=0;i<=4;i++){const y=3+(h-8)*i/4;c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
  for(let i=1;i<10;i++){const x=w*i/10;c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}
  if(!current)return;
  const values=history.filter(s=>now-s.t<=prefs.history*1000);
  for (const [key,colour] of [['gear','#f0f2f5'],['throttle','#68edac'],['brake','#ff6975']]) {
    if(key==='gear'&&!available(current.gear_count))continue;
    c.strokeStyle=colour;c.lineWidth=key==='gear'?1.3:1.7;c.beginPath();let previous=null;
    for (const s of values) {
      if(!available(s[key])) {previous=null;continue;}
      const x=w*(1-(now-s.t)/(prefs.history*1000));
      const normalized=key==='gear' ? clamp(s.gear,0,current.gear_count)/current.gear_count : clamp(s[key],0,100)/100;
      const y=h-4-normalized*(h-8);
      if(previous && s.t-previous.t<350){if(key==='gear')c.lineTo(x,previous.y);c.lineTo(x,y);}else c.moveTo(x,y);
      previous={t:s.t,y};
    }c.stroke();
  }
}
function frame(now) {
  if(now>alertUntil)el('session-alert').hidden=true;
  if(now-lastFrame>25){if(activePage==='dashboard'){drawG(now);drawHistory(now);}else if(activePage==='map'){drawMap();drawRadar();drawDamage();}lastFrame=now;}
  requestAnimationFrame(frame);
}
function connect() {
  let socket;
  try {
    const url=new URL('/ws',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    // URL inherits the page hostname and port, so the same code works on iPhone.
    socket=new WebSocket(url.href);
  } catch {clear('Cannot connect. Open this page from the Python server.');return;}
  socket.onopen=()=>{connected=true;lastMessage=Date.now();};
  socket.onmessage=e=>{try{render(JSON.parse(e.data));lastMessage=Date.now();}catch{clear('Unreadable telemetry. Reconnecting…');socket.close();}};
  socket.onerror=()=>socket.close();
  socket.onclose=()=>{connected=false;clear('Server disconnected. Reconnecting…');setTimeout(connect,1000);};
}
setInterval(()=>{if(connected && Date.now()-lastMessage>2500)clear('No recent data. Check the Python server and AC session.');},500);
el('settings-open').addEventListener('click',()=>{
  el('max-rpm-setting').value=prefs.maxRpm || '';el('shift-setting').value=prefs.shift;
  el('tyre-low-setting').value=prefs.low;el('tyre-high-setting').value=prefs.high;el('history-setting').value=prefs.history;
  el('settings-error').textContent='';el('settings').showModal();
});
el('settings-close').addEventListener('click',()=>el('settings').close());
el('lap-log-open').addEventListener('click',async()=>{
  el('settings').close();el('lap-log').showModal();
  try{const response=await fetch('/api/laps',{cache:'no-store'}),data=await response.json();
    el('lap-log-state').textContent=`${data.state} · reference ${lapTime(data.reference_ms)}`;
    const list=el('lap-log-list');list.replaceChildren();
    for(const row of [...data.laps].reverse()){
      const p=document.createElement('p');p.textContent=`Lap ${row.lap} · ${lapTime(row.lap_ms)} · ${row.status} · ${row.samples} samples`;list.appendChild(p);
    }if(!data.laps.length)list.textContent='No completed lap recorded yet. Start a full lap with the server running.';
  }catch{el('lap-log-state').textContent='Could not load lap records. Restart the updated Python server.';}
});
el('lap-log-close').addEventListener('click',()=>el('lap-log').close());
el('settings-form').addEventListener('submit',e=>{
  e.preventDefault();
  const low=Number(el('tyre-low-setting').value),high=Number(el('tyre-high-setting').value);
  if(low>=high){el('settings-error').textContent='The maximum temperature must be higher than the minimum.';return;}
  prefs={maxRpm:el('max-rpm-setting').value?Number(el('max-rpm-setting').value):null,shift:Number(el('shift-setting').value),low,high,history:Number(el('history-setting').value)};
  try{localStorage.setItem(carKey || 'ac-dash-v2:unknown',JSON.stringify(prefs));}catch{}
  el('history-length').textContent=`${prefs.history} SEC`;
  el('settings').close();
});
clear('Connecting to server…');
requestAnimationFrame(frame);connect();

// Supported live controls arrive as capabilities from the CSP bridge.
let controllerToken='',controllerCache={},controllerBusy=false,controllerUpdated=0;
async function refreshController(){
  try{const response=await fetch('/api/control-info',{cache:'no-store'});if(!response.ok)return;
    const data=await response.json();controllerToken=data.token;controllerCache=data.state||{};controllerUpdated=Date.now();
  }catch{}
}
function controllerState(){return Date.now()-controllerUpdated<2000?(current?.controller||controllerCache):{};}
function dynamicGroups(mode){
  const state=controllerState();
  if(!state.csp_connected||!Array.isArray(state.controls))return {};
  const names={assists:'Assists',power:'Power',visibility:'Lights & wipers',pitplan:'Pit plan',setup:'Car setup',session:'Session'};
  const groups={};
  for(const source of state.controls){
    if(source.group==='setup'&&mode!=='pits')continue;
    const key=source.group||'assists';
    groups[key]??={label:names[key]||key,title:names[key]||key,note:key==='setup'?'Actual editable setup entries from this car.':'Current car limits · values read back from AC.',items:[]};
    groups[key].items.push({...source,car:state.car,note:'',step:source.step||1,unit:source.unit||''});
  }
  return groups;
}
const controlValues=new Map();
let controlContext='auto',controlTab='assists',controlMode='driving';
const step=(id,label,value,min,max,unit='',step=1,note='')=>({id,label,value,min,max,unit,step,note,type:'step'});
const toggle=(id,label,value=false,note='')=>({id,label,value,note,type:'toggle'});
const select=(id,label,options,value=options[0],note='')=>({id,label,options,value,note,type:'select'});
const action=(id,label,note='')=>({id,label,note,type:'action'});
const drivingGroups={
  assists:{label:'Assists',title:'Grip & balance',note:'Example values. Live ranges will follow the selected car.',items:[
    step('tc','Traction control',2,0,12,'',1,'0 = OFF · numbered car modes'),
    step('abs','ABS',1,0,12,'',1,'0 = OFF · numbered car modes'),
    step('bias','Front brake bias',62,40,80,'%',.5),
    step('engine-brake','Engine braking',2,0,8),
    {id:'ffb',label:'Force feedback · this car',type:'slider',value:100,min:0,max:150,unit:'%',note:'Per-car strength; separate from wheelbase settings.'},
    {id:'steer-assist',label:'Steering assist',type:'slider',value:100,min:0,max:100,unit:'%',note:'Car-specific FFB steering assist.'}]},
  power:{label:'Power',title:'Deployment & boost',note:'Only fitted systems will be available in the connected version.',items:[
    step('boost','Turbo boost',80,0,100,'%',10),toggle('drs','DRS'),
    {id:'kers',label:'KERS / ERS deploy',type:'hold',note:'Press and hold to deploy in this preview.'},
    step('delivery','MGU-K delivery',3,0,10),step('recovery','MGU-K recovery',5,0,10),
    select('mguh','MGU-H charging',['Battery','Motor'])]},
  visibility:{label:'Lights & wipers',title:'Visibility',note:'No car-mod extra switches in this design.',items:[
    toggle('headlights','Headlights'),toggle('high-beams','High beams'),
    action('flash','Flash headlights'),toggle('daylights','Daytime lights',true),
    select('indicators','Indicators',['Off','Left','Right','Hazards']),step('wipers','Wiper speed',0,0,4)]},
  pitplan:{label:'Pit plan',title:'Next stop',note:'Plans the next service; does not alter fitted tyres or fuel now.',items:[
    select('pit-preset','Quick-pit preset',['Preset 1','Preset 2','Preset 3']),
    step('pit-fuel','Fuel to add',25,0,120,'L',1),select('pit-compound','Tyre compound',['No change','Soft','Medium','Hard','Wet']),
    toggle('repair-body','Repair bodywork',true),toggle('repair-suspension','Repair suspension',true),
    toggle('repair-engine','Repair engine',true),
    ...['FL','FR','RL','RR'].map((corner,i)=>step(`pit-pressure-${i}`,`${corner} target pressure`,26,15,40,'psi',.5)),
    step('pit-front-wing','Front wing at stop',2,0,15),step('pit-rear-wing','Rear wing at stop',4,0,15)]},
  session:{label:'Session',title:'Session actions',note:'Preview only. Live availability depends on the session.',items:[
    action('pause','Pause / resume'),action('return-pits','Return to pits'),
    action('restart','Restart session','Offline sessions only.'),action('advance','Next session','When allowed by the session.')]}
};
const pitGroups={
  strategy:{...drivingGroups.pitplan,label:'Strategy',title:'Prepare your next run'},
  tyres:{label:'Tyres & fuel',title:'Contact & range',note:'Example setup. Connected mode will list the car’s editable settings.',items:[
    select('setup-compound','Fitted compound',['Soft','Medium','Hard','Wet']),step('setup-fuel','Starting fuel',35,0,120,'L'),
    ...['FL','FR','RL','RR'].map((corner,i)=>step(`setup-pressure-${i}`,`${corner} pressure`,26,15,40,'psi',.5)),
    action('tyre-change','Fit fresh tyres'),action('repairs','Repair car')]},
  chassis:{label:'Chassis',title:'Springs & dampers',note:'Representative adjustments; availability and units vary by car.',items:[
    step('front-arb','Front anti-roll bar',3,0,10),step('rear-arb','Rear anti-roll bar',2,0,10),
    step('front-height','Front ride height',60,30,150,'mm'),step('rear-height','Rear ride height',70,30,150,'mm'),
    step('front-spring','Front spring rate',100,30,300,'N/mm',5),step('rear-spring','Rear spring rate',120,30,300,'N/mm',5),
    ...['Front','Rear'].flatMap(axle=>['Bump','Rebound','Fast bump','Fast rebound'].map(kind=>step(`${axle}-${kind}`,`${axle} ${kind.toLowerCase()}`,5,0,20))),
    step('front-packer','Front packer / bump stop',10,0,50,'mm'),step('rear-packer','Rear packer / bump stop',10,0,50,'mm'),
    step('heave-spring','Heave spring',100,0,300,'N/mm',5)]},
  alignment:{label:'Alignment',title:'Wheel geometry',note:'Individual corner settings are shown where the car supports them.',items:[
    ...['FL','FR','RL','RR'].flatMap(corner=>[step(`camber-${corner}`,`${corner} camber`,-2,-5,1,'°',.1),step(`toe-${corner}`,`${corner} toe`,.05,-.5,.5,'°',.01)]),
    step('caster','Caster',7,0,15,'°',.5)]},
  drivetrain:{label:'Drivetrain',title:'Gearing & differential',note:'Gear count and editable ratios must come from the actual car.',items:[
    step('final-drive','Final drive',3.8,2,6,'',.05),
    ...Array.from({length:7},(_,i)=>step(`ratio-${i+1}`,`Gear ${i+1} ratio`,Number((3.5-i*.35).toFixed(2)),.5,5,'',.05)),
    step('diff-power','Differential power',40,0,100,'%',5),step('diff-coast','Differential coast',30,0,100,'%',5),
    step('diff-preload','Differential preload',80,0,300,'Nm',10),step('awd-share','AWD front share',30,0,100,'%',5)]},
  aero:{label:'Aero & brakes',title:'Balance & braking',note:'Only adjustable equipment will be exposed in the live setup.',items:[
    step('front-wing','Front wing',2,0,15),step('rear-wing','Rear wing',4,0,15),
    step('setup-bias','Front brake bias',62,40,80,'%',.5),step('brake-power','Brake power',100,70,100,'%',1),
    step('front-duct','Front brake ducts',3,0,8),step('rear-duct','Rear brake ducts',3,0,8)]},
  electronics:{...drivingGroups.assists,label:'Electronics',title:'Electronics & steering'},
  setup:{label:'Setup files',title:'Keep a setup ready',note:'Demo actions. Live support will use the car’s actual setup entries.',items:[
    select('setup-file','Saved setup',['Baseline','Qualifying','Race','Wet']),action('load-setup','Load setup'),
    action('save-setup','Save current setup'),action('reset-setup','Reset to baseline'),action('drive','Go to track')]}
};
function resolvedControlMode(){return controlContext==='auto'?(pitState(current)?'pits':'driving'):controlContext;}
let activePage='dashboard',navigationBusy=false;
const pageOrder=['map','dashboard','controls'];
function pageNode(page){return el(page==='dashboard'?'dashboard':`${page}-page`);}
function showPage(page){
  if(navigationBusy||page===activePage)return;
  const previous=activePage,from=pageNode(previous),to=pageNode(page);
  activePage=page;to.hidden=false;
  if(page==='controls'){refreshController().then(()=>{if(activePage==='controls')renderControls();});renderControls();}
  else if(page==='map'){ensureMap();drawMap();drawRadar();}
  else{drawG(performance.now());drawHistory(performance.now());}
  const finish=()=>{
    from.hidden=true;from.inert=false;from.removeAttribute('aria-hidden');
    from.classList.remove('page-transition','page-outgoing');to.classList.remove('page-transition','page-incoming');
    navigationBusy=false;
    el(page==='controls'?'dashboard-open':page==='map'?'map-dashboard':previous==='map'?'map-open':'controls-open').focus({preventScroll:true});
  };
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce||typeof to.animate!=='function'){finish();return;}
  navigationBusy=true;from.inert=true;from.setAttribute('aria-hidden','true');
  from.classList.add('page-transition','page-outgoing');to.classList.add('page-transition','page-incoming');
  const sign=pageOrder.indexOf(page)>pageOrder.indexOf(previous)?1:-1;
  const options={duration:280,easing:'cubic-bezier(.22,.75,.25,1)',fill:'both'};
  const outgoing=from.animate([{transform:'translateX(0)'},{transform:`translateX(${-sign*100}%)`}],options);
  const incoming=to.animate([{transform:`translateX(${sign*100}%)`},{transform:'translateX(0)'}],options);
  Promise.all([outgoing.finished,incoming.finished]).catch(()=>{}).then(()=>{outgoing.cancel();incoming.cancel();finish();});
}
let controlSignature='';
function currentControlSignature(){
  const state=controllerState();return JSON.stringify([resolvedControlMode(),state.car,!!state.csp_connected,(state.controls||[]).map(x=>[x.id,x.type,x.min,x.max,x.options])]);
}
function updateControlContext(){
  if(el('controls-page').hidden)return;
  const mode=resolvedControlMode();
  if(mode!==controlMode)controlTab=mode==='pits'?'pitplan':'assists';
  if(currentControlSignature()!==controlSignature)renderControls();
  if(!controllerBusy)document.querySelectorAll('.control-card').forEach(card=>card.refreshReading?.());
}
function previewValue(item){
  const actual=controllerState().controls?.find(x=>x.id===item.id);
  return controlValues.has(item.id)?controlValues.get(item.id):(actual?.value??item.value);
}
async function commitControl(item,value,output){
  if(!controllerToken||!controllerState().csp_connected){el('control-feedback').textContent='Bridge offline. Install AC Dash Bridge and restart the AC session.';return;}
  if(['restart','advance','return-pits'].includes(item.id)&&!window.confirm(`${item.label}? This affects your current driving session.`))return;
  if(controllerBusy&&item.type!=='hold'){el('control-feedback').textContent='Waiting for AC to acknowledge the previous change…';return;}
  controllerBusy=true;el('control-feedback').textContent=`Sending ${item.label}…`;
  try{
    const response=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-AC-Dash-Token':controllerToken},body:JSON.stringify({control:item.id,value,car:item.car})});
    const reply=await response.json();
    if(reply.state){controllerCache=reply.state;controllerUpdated=Date.now();if(current)current.controller=reply.state;}
    controlValues.delete(item.id);
    el('control-feedback').textContent=reply.message||'AC did not confirm the change.';
    if(!reply.ok)el('control-feedback').textContent=`Not applied: ${reply.message}`;
    if(output)output();
  }catch(error){el('control-feedback').textContent='Connection lost; change not confirmed. Check the Python server.';}
  finally{controllerBusy=false;}
}
function renderControls(){
  controlSignature=currentControlSignature();
  controlMode=resolvedControlMode();
  const groups=dynamicGroups(controlMode),state=controllerState(),mock=!!state.mock;
  document.querySelector('.preview-badge').textContent=state.csp_connected?(mock?'MOCK CONTROLS':'CONNECTED'):'BRIDGE OFFLINE';
  document.querySelector('.preview-notice').textContent=state.csp_connected?(mock?'MOCK MODE · changes are simulated; no game is controlled.':'LIVE CONTROLS · changes are sent to your current AC car. Only supported settings are listed.'):'Install AC Dash Bridge and restart the AC session. Basic telemetry still works without it.';
  if(!groups[controlTab])controlTab=Object.keys(groups)[0];
  el('control-context').textContent=controlMode==='pits'?'IN THE PITS / SETUP':'DRIVING / LIVE ADJUSTMENTS';
  el('control-title').textContent=controlMode==='pits'?'Set up. Head out.':'Your car. In reach.';
  el('control-car').textContent=`${niceName(state.car||current?.car)||'ASSETTO CORSA'} · ${state.csp_connected?'supported controls':'bridge not connected'}`;
  document.querySelectorAll('[data-context]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.context===controlContext)));
  const tabs=el('control-tabs');tabs.replaceChildren();
  for(const [key,group]of Object.entries(groups)){
    const b=document.createElement('button');b.type='button';b.textContent=group.label;b.setAttribute('aria-selected',String(key===controlTab));
    b.addEventListener('click',()=>{controlTab=key;renderControls();});tabs.appendChild(b);
  }
  const content=el('control-content');content.replaceChildren();
  if(!groups[controlTab]){content.textContent='Bridge not connected. Enter a driving session and open AC Dash Bridge from the in-game Lua app list. After installing this update, restart AC and Python. CSP itself is already installed.';content.className='control-content control-empty';return;}
  content.className='control-content';
  const group=groups[controlTab],heading=document.createElement('div');heading.className='control-group-heading';
  const title=document.createElement('h3');title.textContent=group.title;heading.appendChild(title);
  const note=document.createElement('p');note.textContent=group.note;heading.appendChild(note);content.appendChild(heading);
  const grid=document.createElement('div');grid.className='control-grid';content.appendChild(grid);
  for(const item of group.items){
    const card=document.createElement('div');card.className=`control-card ${item.type}`;
    const label=document.createElement('label');label.className='card-label';label.textContent=item.label;label.htmlFor=`ctl-${item.id}`;card.appendChild(label);
    const value=previewValue(item);
    if(item.type==='step'){
      const row=document.createElement('div');row.className='stepper';
      const output=document.createElement('output');output.id=`ctl-${item.id}`;output.setAttribute('aria-label',item.label);
      const display=()=>{output.textContent=item.id==='tc'||item.id==='abs'?previewValue(item)===0?'OFF':previewValue(item):previewValue(item);const unit=document.createElement('small');unit.textContent=item.unit;output.appendChild(unit);};
      for(const sign of [-1,1]){
        const b=document.createElement('button');b.type='button';b.textContent=sign<0?'−':'+';b.setAttribute('aria-label',`${sign<0?'Decrease':'Increase'} ${item.label}`);
        b.addEventListener('click',()=>{const next=Number(clamp(Number(previewValue(item))+sign*item.step,item.min,item.max).toFixed(3));commitControl(item,next,display);});
        if(sign<0){row.appendChild(b);row.appendChild(output);}else row.appendChild(b);
      }display();card.refreshReading=display;card.appendChild(row);
    }else if(item.type==='slider'){
      const row=document.createElement('div');row.className='slider-reading';const hint=document.createElement('span');hint.textContent=`${item.min}–${item.max}${item.unit}`;
      const out=document.createElement('output');out.textContent=`${value}${item.unit}`;row.append(hint,out);card.appendChild(row);
      const input=document.createElement('input');input.type='range';input.id=`ctl-${item.id}`;input.min=item.min;input.max=item.max;input.value=value;input.setAttribute('aria-label',item.label);
      input.addEventListener('input',()=>{out.textContent=`${input.value}${item.unit} pending`;});
      input.addEventListener('change',()=>commitControl(item,Number(input.value),()=>{input.value=previewValue(item);out.textContent=`${previewValue(item)}${item.unit}`;}));card.refreshReading=()=>{if(document.activeElement!==input){input.value=previewValue(item);out.textContent=`${previewValue(item)}${item.unit}`;}};card.appendChild(input);
    }else if(item.type==='select'){
      const input=document.createElement('select');input.id=`ctl-${item.id}`;input.setAttribute('aria-label',item.label);
      for(const option of item.options){const o=document.createElement('option');o.textContent=option;o.value=option;input.appendChild(o);}input.value=value;
      input.addEventListener('change',()=>commitControl(item,input.value,()=>{input.value=previewValue(item);}));card.appendChild(input);
    }else{
      const b=document.createElement('button');b.id=`ctl-${item.id}`;b.type='button';b.className=item.type==='toggle'?'toggle-control':'action-control';
      if(item.type==='toggle'){
        const update=()=>{b.replaceChildren();const text=document.createElement('span');text.textContent=item.label;const state=document.createElement('b');state.textContent=previewValue(item)?'ON':'OFF';b.append(text,state);b.setAttribute('aria-pressed',String(!!previewValue(item)));};
        b.addEventListener('click',()=>commitControl(item,!previewValue(item),update));card.refreshReading=update;update();
      }else if(item.type==='hold'){
        b.textContent='Hold to deploy';let held=false,lease=null;
        const end=()=>{if(!held)return;held=false;clearInterval(lease);lease=null;b.textContent='Hold to deploy';commitControl(item,false);};
        const begin=()=>{held=true;b.textContent='DEPLOYING';commitControl(item,true);lease=setInterval(()=>{if(held&&!controllerBusy)commitControl(item,true);},180);};
        b.addEventListener('pointerdown',e=>{if(!held)begin();b.setPointerCapture(e.pointerId);});
        for(const event of ['pointerup','pointercancel','lostpointercapture','blur'])b.addEventListener(event,end);
        b.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!held)begin();}});b.addEventListener('keyup',end);
        window.addEventListener('blur',end);document.addEventListener('visibilitychange',()=>{if(document.hidden)end();});
      }else{b.textContent=item.label;b.addEventListener('click',()=>commitControl(item,true));}card.appendChild(b);
    }
    if(item.note){const note=document.createElement('p');note.className='card-note';note.textContent=item.note;card.appendChild(note);}grid.appendChild(card);
  }
}
el('controls-open').addEventListener('click',async()=>{await refreshController();showPage('controls');});
el('dashboard-open').addEventListener('click',()=>showPage('dashboard'));
document.querySelectorAll('[data-context]').forEach(b=>b.addEventListener('click',()=>{controlContext=b.dataset.context;controlTab='';renderControls();}));
el('control-reset').textContent='Refresh from AC';
el('control-reset').addEventListener('click',async()=>{await refreshController();controlValues.clear();renderControls();el('control-feedback').textContent='Values refreshed from AC.';});
let badgeCar=null;
function updateCarBadge(car){
  if(car===badgeCar)return;badgeCar=car;
  const image=el('car-badge');image.hidden=true;image.removeAttribute('src');
  if(!car)return;
  image.onload=()=>{if(badgeCar===car)image.hidden=false;};image.onerror=()=>image.hidden=true;
  image.src='/api/car-badge?'+new URLSearchParams({car});
}
let mapKey='',mapInfo=null,mapImage=null,mapGeneration=0;
let mapView={zoom:1,x:0,y:0};
function resetMap(){mapView={zoom:1,x:0,y:0};}
function trackKey(data){return data?.status==='mock'?'demo':`${data?.track||''}/${data?.track_layout||''}`;}
async function ensureMap(){
  if(!current)return;
  const key=trackKey(current);if(key===mapKey)return;
  mapKey=key;mapInfo=null;mapImage=null;resetMap();const generation=++mapGeneration;
  if(current.status==='mock'){mapInfo={available:true,demo:true};return;}
  el('map-message').textContent='Loading the current track layout…';
  try{
    const query=new URLSearchParams({track:current.track||'',layout:current.track_layout||''});
    const response=await fetch('/api/map-info?'+query,{cache:'no-store'});const info=await response.json();
    if(generation!==mapGeneration)return;mapInfo=info;
    if(info.available){const image=new Image();image.onload=()=>{if(generation===mapGeneration)mapImage=image;};image.onerror=()=>{if(generation===mapGeneration)mapInfo={available:false,message:'Track image could not be loaded.'};};image.src=info.image;}
  }catch{if(generation===mapGeneration)mapInfo={available:false,message:'Map server unavailable. Check the Python server.'};}
}
function mapPoint(position,info,fit){
  return [fit.x+(position[0]+info.offset_x)/info.scale*fit.scale,fit.y+(position[1]+info.offset_z)/info.scale*fit.scale];
}
function drawMap(){
  ensureMap();const [c,w,h]=canvasFor('map-canvas');if(w<2||h<2)return;
  el('map-live').textContent=current?.status==='mock'?'MOCK':current?'LIVE':'OFFLINE';
  el('map-title').textContent=current?.status==='mock'?'DEMO CIRCUIT':niceName(current?.track||mapInfo?.track)||'TRACK MAP';
  el('map-speed').textContent=current?`${Math.round(current.speed)} KM/H`:'— KM/H';
  el('map-caption').textContent=current?.status==='mock'?'SIMULATED CIRCUIT / POSITION · SWIPE LEFT TO RETURN':`${niceName(current?.track_layout||mapInfo?.layout)||'CURRENT LAYOUT'} · SWIPE LEFT TO RETURN`;
  let point=null,forward=null;
  c.save();c.translate(w/2+mapView.x,h/2+mapView.y);c.scale(mapView.zoom,mapView.zoom);c.translate(-w/2,-h/2);
  function opponent(p,look,label){
    c.save();c.translate(...p);c.fillStyle='#74b9ef';c.strokeStyle='#090c10';c.lineWidth=1.5/mapView.zoom;
    c.beginPath();c.arc(0,0,4/mapView.zoom,0,Math.PI*2);c.fill();c.stroke();
    if(look&&look.every(available)){c.rotate(Math.atan2(look[1],look[0]));c.beginPath();c.moveTo(10/mapView.zoom,0);c.lineTo(3/mapView.zoom,-3/mapView.zoom);c.lineTo(3/mapView.zoom,3/mapView.zoom);c.fill();}
    c.restore();c.font=`700 ${11/mapView.zoom}px Rajdhani`;c.fillStyle='#b5d9f5';c.fillText(label,p[0]+7/mapView.zoom,p[1]-7/mapView.zoom);
  }
  if(mapInfo?.demo){
    const rx=Math.max(20,w*.36),ry=Math.max(20,h*.34),cx=w/2,cy=h/2;
    c.strokeStyle='#303946';c.lineWidth=16;c.beginPath();c.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);c.stroke();
    c.strokeStyle='#d8dfe8';c.lineWidth=2;c.stroke();
    if(current){const angle=current.lap_progress*Math.PI*2;point=[cx+rx*Math.cos(angle),cy+ry*Math.sin(angle)];forward=[-rx*Math.sin(angle),ry*Math.cos(angle)];}
    if(current)for(let i=1;i<=3;i++){const a=(current.lap_progress+i*.18)*Math.PI*2;opponent([cx+rx*Math.cos(a),cy+ry*Math.sin(a)],[-rx*Math.sin(a),ry*Math.cos(a)],`P${i+1}`);}
    el('map-message').textContent=current?'Mock mode · live sessions use the installed track map.':'Connection lost · position unavailable';
  }else if(mapInfo?.available&&mapImage){
    const scale=Math.min((w-40)/mapInfo.width,(h-40)/mapInfo.height);
    const fit={x:(w-mapInfo.width*scale)/2,y:(h-mapInfo.height*scale)/2,scale};
    c.drawImage(mapImage,fit.x,fit.y,mapInfo.width*scale,mapInfo.height*scale);
    for(const other of current?.map_cars||[]){
      if(Array.isArray(other.position)&&other.position.length===2&&other.position.every(available))opponent(mapPoint(other.position,mapInfo,fit),other.forward,other.race_position>0?`P${other.race_position}`:`#${other.id}`);
    }
    const position=current?.world_position,look=current?.world_forward;
    if(Array.isArray(position)&&position.length===2&&position.every(available))point=mapPoint(position,mapInfo,fit);
    if(Array.isArray(look)&&look.length===2&&look.every(available))forward=look;
    const outside=point&&(point[0]<0||point[0]>w||point[1]<0||point[1]>h);
    if(outside)point=null;
    el('map-message').textContent=!current?'Connection lost · position unavailable':outside?'Car position is outside this map. Check the selected track layout.':!point?'Car position unavailable · waiting for telemetry.':!forward?'Direction unavailable · enable AC Dash Bridge.':'';
  }else el('map-message').textContent=mapInfo?.message||(!current?'Waiting for a live driving session…':'Loading track map…');
  if(!point){c.restore();return;}
  c.save();c.translate(...point);c.shadowColor='#000';c.shadowBlur=8;
  c.fillStyle='#f4d34c';c.strokeStyle='#080a0d';c.lineWidth=2;c.beginPath();c.arc(0,0,6,0,Math.PI*2);c.fill();c.stroke();
  if(forward&&Math.hypot(...forward)>.001){
    c.rotate(Math.atan2(forward[1],forward[0]));c.fillStyle='#fff';c.beginPath();c.moveTo(18,0);c.lineTo(4,-7);c.lineTo(4,7);c.closePath();c.fill();c.stroke();
  }c.restore();c.restore();
}
// Gestures only move the circuit viewport, and never navigate the page strip.
const mapPointers=new Map();let mapGesture=null;
function mapGestureStart(){
  const p=[...mapPointers.values()];if(!p.length){mapGesture=null;return;}
  const centre=p.length>1?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}:p[0];
  mapGesture={...mapView,cx:centre.x,cy:centre.y,distance:p.length>1?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0};
}
function zoomMap(factor,x,y){
  const old=mapView.zoom,next=clamp(old*factor,1,8),ratio=next/old;
  mapView.x=x-(x-mapView.x)*ratio;mapView.y=y-(y-mapView.y)*ratio;mapView.zoom=next;
}
const mapCanvas=el('map-canvas');
mapCanvas.addEventListener('pointerdown',e=>{e.preventDefault();swipeStart=null;mapCanvas.setPointerCapture(e.pointerId);mapPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});mapGestureStart();});
mapCanvas.addEventListener('pointermove',e=>{
  if(!mapPointers.has(e.pointerId))return;e.preventDefault();mapPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const p=[...mapPointers.values()],g=mapGesture;if(!g)return;
  const cx=p.length>1?(p[0].x+p[1].x)/2:p[0].x,cy=p.length>1?(p[0].y+p[1].y)/2:p[0].y;
  mapView={zoom:g.zoom,x:g.x+cx-g.cx,y:g.y+cy-g.cy};
  if(p.length>1&&g.distance>0){const box=mapCanvas.getBoundingClientRect();zoomMap(Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)/g.distance,cx-box.left-box.width/2,cy-box.top-box.height/2);}
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])mapCanvas.addEventListener(event,e=>{mapPointers.delete(e.pointerId);mapGestureStart();});
mapCanvas.addEventListener('wheel',e=>{e.preventDefault();const b=mapCanvas.getBoundingClientRect();zoomMap(Math.exp(-e.deltaY*.002),e.clientX-b.left-b.width/2,e.clientY-b.top-b.height/2);},{passive:false});
el('map-zoom-in').addEventListener('click',()=>zoomMap(1.4,0,0));el('map-zoom-out').addEventListener('click',()=>zoomMap(1/1.4,0,0));el('map-reset').addEventListener('click',resetMap);

function drawDamage(){
  const [c,w,h]=canvasFor('damage-canvas');if(w<2||h<2)return;
  const body=current?.damage_body,hasBody=Array.isArray(body)&&body.length>=4&&body.every(available);
  const scale=Math.min(w/130,h/200),cx=w/2,cy=h/2;
  c.save();c.translate(cx,cy);c.scale(scale,scale);
  const colour=v=>!available(v)?'#3d4652':v<=0?'#68edac':v<20?'#f4d34c':'#ff6975';
  c.fillStyle='#151e28';c.strokeStyle='#607084';c.lineWidth=2;
  c.beginPath();c.moveTo(-27,-70);c.lineTo(27,-70);c.lineTo(35,-40);c.lineTo(35,55);c.lineTo(26,73);c.lineTo(-26,73);c.lineTo(-35,55);c.lineTo(-35,-40);c.closePath();c.fill();c.stroke();
  c.strokeStyle='#607084';c.strokeRect(-22,-28,44,49);
  for(const [i,x,y,bw,bh] of [[0,-27,-73,54,8],[1,-27,68,54,8],[2,-38,-46,7,100],[3,31,-46,7,100]]){c.fillStyle=colour(hasBody?body[i]:null);c.fillRect(x,y,bw,bh);}
  for(let i=0;i<4;i++){c.fillStyle=colour(current?.damage_suspension?.[i]);c.fillRect(i%2===0?-47:37,i<2?-48:37,10,23);}
  c.font='700 12px Rajdhani';c.textAlign='center';
  const engine=current?.engine_life,gearbox=current?.gearbox_damage;
  c.fillStyle=available(engine)?colour((1000-engine)/10):'#607084';c.fillText('ENG',0,-7);
  c.fillStyle=available(gearbox)?colour(gearbox*100):'#607084';c.fillText('GEAR',0,12);
  c.restore();
  el('damage-status').textContent=!current?'OFFLINE':!hasBody?'Body data unavailable':body.some(v=>v>0)?'BODY DAMAGE':'NO BODY DAMAGE';
}
function radarPoint(car,range,cx,cy,radius){
  return [cx+car.right_m/range*radius,cy-car.forward_m/range*radius];
}
function drawRadar(){
  const [c,w,h]=canvasFor('radar-canvas');if(w<2||h<2)return;
  const radar=current?.radar,ready=!!radar?.available;
  const range=ready&&available(radar.range_m)?clamp(radar.range_m,10,60):30;
  const cx=w/2,cy=h/2,radius=Math.max(10,Math.min(w-36,h-32)/2),scale=radius/range;
  c.strokeStyle='#303b49';c.lineWidth=1;
  for(const meters of [10,20,range]){
    if(meters>range)continue;
    c.beginPath();c.arc(cx,cy,meters*scale,0,Math.PI*2);c.stroke();
  }
  c.beginPath();c.moveTo(cx-radius,cy);c.lineTo(cx+radius,cy);c.moveTo(cx,cy-radius);c.lineTo(cx,cy+radius);c.stroke();
  c.fillStyle='#8b98a9';c.font='700 11px Rajdhani';c.textAlign='center';c.fillText('AHEAD',cx,11);c.fillText(`${range} m`,cx+radius-8,cy-5);
  const cars=ready&&Array.isArray(radar.cars)?radar.cars.filter(v=>[v.right_m,v.forward_m,v.distance_m].every(available)&&v.distance_m>=0&&v.distance_m<=range).slice(0,16):[];
  function body(x,y,angle,width,length,colour){
    const bw=Math.max(5,clamp(width||2,1,4)*scale),bl=Math.max(10,clamp(length||4.5,2,12)*scale);
    c.save();c.translate(x,y);c.rotate(angle);c.fillStyle=colour;c.strokeStyle='#0b0d10';c.lineWidth=1;
    c.beginPath();c.rect(-bw/2,-bl/2,bw,bl);c.fill();c.stroke();
    c.fillStyle='#fff';c.beginPath();c.moveTo(0,-bl/2-4);c.lineTo(-3,-bl/2+1);c.lineTo(3,-bl/2+1);c.closePath();c.fill();c.restore();
  }
  for(const other of [...cars].sort((a,b)=>b.distance_m-a.distance_m)){
    const [x,y]=radarPoint(other,range,cx,cy,radius);
    const angle=available(other.heading_right)&&available(other.heading_forward)?Math.atan2(other.heading_right,other.heading_forward):0;
    const colour=other.distance_m<4?'#ff6975':other.distance_m<8?'#f4d34c':'#74b9ef';
    body(x,y,angle,other.width_m,other.length_m,colour);
    c.font='700 12px Rajdhani';c.textAlign=x<cx?'right':'left';c.fillStyle=colour;
    c.fillText(`${other.distance_m.toFixed(1)} m`,x+(x<cx?-9:9),y+4);
  }
  body(cx,cy,0,radar?.width_m,radar?.length_m,ready?'#f0f2f5':'#46505d');
  el('radar-count').textContent=ready?`${cars.length} NEARBY`:'UNAVAILABLE';
  el('radar-status').textContent=!current?'Offline · waiting for telemetry':!ready?'Enable / update AC Dash Bridge':cars.length?`${current.status==='mock'?'MOCK · ':''}Nearest ${Math.min(...cars.map(v=>v.distance_m)).toFixed(1)} m · car-to-car`:`No cars within ${range} m`;
}
el('map-open').addEventListener('click',()=>showPage('map'));
el('map-dashboard').addEventListener('click',()=>showPage('dashboard'));
function swipePage(direction){
  const pages=['map','dashboard','controls'];
  const index=pages.indexOf(activePage)+(direction==='left'?1:-1);
  if(index>=0&&index<pages.length)showPage(pages[index]);
}
let swipeStart=null;
document.addEventListener('pointerdown',e=>{
  if(e.pointerType!=='touch'||e.clientX<24||e.clientX>innerWidth-24||e.target.closest('button,input,select,dialog,#map-canvas'))return;
  swipeStart={x:e.clientX,y:e.clientY};
},{passive:true});
document.addEventListener('pointerup',e=>{
  if(!swipeStart)return;const dx=e.clientX-swipeStart.x,dy=e.clientY-swipeStart.y;swipeStart=null;
  if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.7)swipePage(dx>0?'right':'left');
},{passive:true});
document.addEventListener('pointercancel',()=>swipeStart=null,{passive:true});
document.addEventListener('keydown',e=>{
  if(e.target.closest('input,select,textarea,dialog'))return;
  if(e.key==='ArrowRight')swipePage('left');else if(e.key==='ArrowLeft')swipePage('right');
});
setInterval(updateControlContext,500);
refreshController();

