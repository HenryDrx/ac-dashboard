// Synthetic CSP boot test. No AC process or actual car controls are touched.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
const prelude=`
local clock=100
os.preciseClock=function() return clock end
script={}
local maps={}
local car={physicsAvailable=true,racePosition=12,compoundIndex=0,gearCount=7,tractionControlModes=2,tractionControlMode=1,absModes=3,absMode=1,engineBrakeSettingsCount=0,turboCount=0,wiperModes=0,position={x=10,y=0,z=20},look={x=1,z=0},side={x=0,z=1},aabbSize={x=2,z=4.5},wheels={}}
for i=0,3 do car.wheels[i]={tyreWear=0} end
local opponents={
 [1]={isConnected=true,isActive=true,position={x=14,y=0,z=23},look={x=0,z=1},aabbSize={x=2,z=4}},
 [2]={isConnected=false,isActive=true,position={x=11,y=0,z=20},look={x=1,z=0},aabbSize={x=2,z=4}},
 [3]={isConnected=true,isActive=true,position={x=90,y=0,z=20},look={x=1,z=0},aabbSize={x=2,z=4}},
 [4]={isConnected=true,isActive=true,position={x=11,y=8,z=20},look={x=1,z=0},aabbSize={x=2,z=4}}
}
ac={
 SessionType={Race=3},
 writeMemoryMappedFile=function(name,layout) maps[name]=maps[name] or {packetId=0,length=0,data={}};return maps[name] end,
 readMemoryMappedFile=function() error('No command mapping exists yet') end,
 getCar=function(i) return i==0 and car or opponents[i] end,getSim=function() return {carsCount=5,raceSessionType=3} end,getCarID=function() return 'arbitrary_mod' end,
 getTrackID=function() return 'test_track' end,getTrackLayout=function() return 'short' end,
 getPitstopSpinners=function() return {} end,getSetupSpinners=function() return {} end,isSetupAvailableToEdit=function() return false end,
 setTargetCar=function() end,setTC=function(value) car.tractionControlMode=value end,
 INIConfig={carData=function() error('No optional thermal curve') end}
}
local payload,command
JSON={stringify=function(value) payload=value;return '{}' end,parse=function() return command end}
package.preload.ffi=function() return {copy=function() end,string=function() return '{}' end} end
`;
const body=fs.readFileSync(path.join(__dirname,'csp-app/ACDashBridge/bridge_v2.lua'),'utf8');
const checks=`
assert(maps['AcTools.CSP.Limited.ACDash.command2'],'Command channel must exist before first command')
script.update(.05)
assert(payload.active and payload.gear_count==7 and #payload.controls>0,'Boot must publish telemetry without any command')
assert(payload.world_position[1]==10 and payload.world_forward[1]==1)
assert(payload.race_position==12 and payload.is_race)
assert(#payload.map_cars==3,'Map must include far-away active connected cars, including other elevations')
assert(payload.map_cars[1].position[1]==14 and payload.map_cars[2].position[1]==90)
car.racePosition=3;clock=clock+.05;script.update(.05)
assert(payload.race_position==3,'Race ranking must be read again on every telemetry packet')
assert(payload.radar.available and #payload.radar.cars==1,'Only nearby active connected cars on the same level belong on radar')
local nearby=payload.radar.cars[1]
assert(nearby.right_m==3 and nearby.forward_m==4 and nearby.distance_m==5,'Radar must use the player basis and real centre distance')
assert(nearby.heading_right==1 and nearby.heading_forward==0,'Relative heading must use the player basis')
car.gearCount=6;clock=clock+.05;script.update(.05)
assert(payload.gear_count==6,'A new live gear count must replace the previous count without a car catalogue')
command={id='test',bridge_id=payload.bridge_id,frame=maps['AcTools.CSP.Limited.ACDash.state2'].packetId,car='arbitrary_mod',control='tc',value=2}
local input=maps['AcTools.CSP.Limited.ACDash.command2'];input.packetId=2;input.length=2
clock=clock+.05;script.update(.05)
assert(payload.ack.ok and car.tractionControlMode==2,'A command must apply in the synthetic CSP environment')
clock=clock+.05;script.update(.05)
assert(payload.tc_mode==2,'Following telemetry must read back the changed setting')
`;
const status=lauxlib.luaL_dostring(L,to_luastring(prelude+body+checks));
if(status!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));
console.log('Passed: Lua boot before Python, live gear-count changes, synthetic TC readback and nearby-car projection/filtering.');
