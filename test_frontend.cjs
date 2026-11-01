// Developer checks only; Node is not required to run the dashboard.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'web/app.js'),'utf8');
const gesture=source.slice(source.indexOf('function swipePage(direction)'),source.indexOf('setInterval(updateControlContext,500);'));
const listeners={};const context={innerWidth:844,activePage:'dashboard',document:{addEventListener(name,fn){listeners[name]=fn;}},showPage(name){context.activePage=name;}};
vm.runInNewContext(gesture,context);
const event=(x,y,interactive=false)=>({pointerType:'touch',clientX:x,clientY:y,target:{closest(){return interactive;}}});
const swipe=(x1,y1,x2,y2,interactive=false)=>{listeners.pointerdown(event(x1,y1,interactive));listeners.pointerup(event(x2,y2,interactive));};
swipe(100,100,240,105);assert.equal(context.activePage,'map');
swipe(250,100,100,105);assert.equal(context.activePage,'dashboard');
swipe(250,100,100,105);assert.equal(context.activePage,'controls');
swipe(100,100,240,105);assert.equal(context.activePage,'dashboard');
swipe(100,100,140,300);assert.equal(context.activePage,'dashboard');
swipe(5,100,200,100);assert.equal(context.activePage,'dashboard');
swipe(835,100,650,100);assert.equal(context.activePage,'dashboard');
swipe(100,100,250,100,true);assert.equal(context.activePage,'dashboard');
listeners.pointerdown(event(100,100));listeners.pointercancel();listeners.pointerup(event(250,100));assert.equal(context.activePage,'dashboard');
listeners.keydown({...event(0,0),key:'ArrowLeft'});assert.equal(context.activePage,'map');
listeners.keydown({...event(0,0),key:'ArrowRight'});assert.equal(context.activePage,'dashboard');
const pointFunction=source.slice(source.indexOf('function mapPoint('),source.indexOf('function drawMap('));
vm.runInNewContext(pointFunction,context);
assert.deepEqual(Array.from(context.mapPoint([300,150],{offset_x:100,offset_z:-50,scale:2},{x:20,y:30,scale:.5})),[120,55]);
console.log('Passed: three-screen navigation, edge/scroll/input guards, cancellation, keyboard and AC map coordinates.');

const gearFunction=source.slice(source.indexOf('function gearNeighbours('),source.indexOf('function lapTime('));
vm.runInNewContext(gearFunction,context);
assert.equal(context.gearNeighbours('1',7).next,'2 3');
assert.equal(context.gearNeighbours('6',7).next,'7');
assert.equal(context.gearNeighbours('7',7).next,'');
assert.equal(context.gearNeighbours('6',6).next,'');
assert.equal(context.gearNeighbours('1',null).next,'');
assert.equal(context.gearNeighbours('N',8).next,'1 2');
console.log('Passed: gear neighbours for first/top gear, changed live maximum and unavailable metadata.');

const radarFunction=source.slice(source.indexOf('function radarPoint('),source.indexOf('function drawRadar('));
vm.runInNewContext(radarFunction,context);
assert.deepEqual(Array.from(context.radarPoint({right_m:10,forward_m:20},40,200,100,80)),[220,60]);
console.log('Passed: radar puts right-hand cars right and cars ahead above the player.');

const raceBlock=source.slice(source.indexOf('  const racePosition ='),source.indexOf("  el('progress-fill').style.width",source.indexOf('  const racePosition =')));
function raceReadout(data){
 const nodes={};
 const sandbox={data,available:x=>typeof x==='number'&&Number.isFinite(x),el:id=>nodes[id]||(nodes[id]={})};
 vm.runInNewContext(raceBlock,sandbox);return nodes;
}
let race=raceReadout({session:2,is_race:true,position:12,lap_progress:.25});
assert.equal(race['race-position'].textContent,'P12');assert.equal(race['session-value'].textContent,'25%');assert.equal(race['race-line'].hidden,false);
assert.equal(raceReadout({is_race:true,position:3})['race-position'].textContent,'P3');
assert.equal(raceReadout({is_race:true,position:null})['race-position'].textContent,'—');
assert.equal(raceReadout({is_race:false,lap_progress:.2})['race-line'].hidden,true);
console.log('Passed: live race position and lap progress coexist.');
const events=source.slice(source.indexOf('let previousPit='),source.indexOf('const niceName'));
const eventNodes={},pages=[],alerts=[];
const eventContext={navigationBusy:false,performance:{now:()=>100},controlContext:'driving',controlTab:'assists',activePage:'dashboard',el:id=>eventNodes[id]||(eventNodes[id]={classList:{toggle(){},remove(){},add(){}},querySelector(){return {textContent:''}}}),showPage:p=>{pages.push(p);eventContext.activePage=p;}};
vm.runInNewContext(events,eventContext);
vm.runInNewContext('sessionAlert=message=>{}',eventContext);
eventContext.updateSessionEvents({car:'a',track:'t',lap:1,in_pit:false},false);
eventContext.updateSessionEvents({car:'a',track:'t',lap:1,in_pit_lane:true},false);assert.equal(pages.at(-1),'controls');
eventContext.updateSessionEvents({car:'a',track:'t',lap:1,in_pit_lane:true},false);assert.equal(pages.length,1);
eventContext.updateSessionEvents({car:'a',track:'t',lap:1,in_pit:false},false);assert.equal(pages.at(-1),'dashboard');
console.log('Passed: pit-lane entry auto-opens controls once and exit returns to dashboard.');

// Exercise the actual pan/pinch handlers with synthetic pointer inputs.
const mapHandlers={},buttonHandlers={};
const mapNode={addEventListener:(n,fn)=>mapHandlers[n]=fn,setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:800,height:400})};
const zoomContext={Map,Math,swipeStart:null,mapView:{zoom:1,x:0,y:0},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),resetMap(){},el:id=>id==='map-canvas'?mapNode:{addEventListener:(n,fn)=>buttonHandlers[id]=fn}};
const mapHandlersBlock=source.slice(source.indexOf('const mapPointers='),source.indexOf('function drawDamage('));
vm.runInNewContext(mapHandlersBlock,zoomContext);
const pointer=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,preventDefault(){}});
mapHandlers.pointerdown(pointer(1,300,200));mapHandlers.pointermove(pointer(1,340,210));
assert.equal(zoomContext.mapView.x,40);assert.equal(zoomContext.mapView.y,10);
mapHandlers.pointerup(pointer(1,340,210));zoomContext.mapView={zoom:1,x:0,y:0};
mapHandlers.pointerdown(pointer(1,300,200));mapHandlers.pointerdown(pointer(2,500,200));
mapHandlers.pointermove(pointer(2,700,200));assert.equal(zoomContext.mapView.zoom,2);
mapHandlers.pointercancel(pointer(1,300,200));mapHandlers.pointercancel(pointer(2,700,200));
buttonHandlers['map-zoom-in']();assert.equal(zoomContext.mapView.zoom,2.8);
console.log('Passed: one-finger map pan, two-finger pinch, pointer cancellation and zoom buttons.');
