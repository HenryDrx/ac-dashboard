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
 const nodes={};let isRace=false;
 const sandbox={data,available:x=>typeof x==='number'&&Number.isFinite(x),el:id=>nodes[id]||(nodes[id]={}),document:{querySelector:()=>({classList:{toggle:(name,value)=>isRace=value}})}};
 vm.runInNewContext(raceBlock,sandbox);return {text:nodes['session-value'].textContent,isRace};
}
assert.equal(raceReadout({session:2,is_race:true,position:12}).text,'P12');
assert.equal(raceReadout({session:2,is_race:true,position:3}).text,'P3');
assert.equal(raceReadout({session:2,is_race:true,position:null}).text,'—');
assert.equal(raceReadout({session:2,is_race:false,position:3,lap_progress:.2}).text,'20%');
console.log('Passed: live race-position readout updates and missing ranks do not stick.');
