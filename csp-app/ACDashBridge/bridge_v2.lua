-- AC Dash: documented CSP APIs only. Own telemetry/command mappings, never
-- AC internal memory. Incoming IDs must exist in the current capability list.
local ffi = require('ffi')
local output = ac.writeMemoryMappedFile('AcTools.CSP.Limited.ACDash.state2',
  'int packetId; int length; char data[65536];')
-- Create our own command channel even if Python has not sent a command yet.
-- Opening it read-only here caused a startup deadlock: no telemetry/capabilities
-- could be published until the first command, which needs those capabilities.
local input = ac.writeMemoryMappedFile('AcTools.CSP.Limited.ACDash.command2',
  'int packetId; int length; char data[8192];')
local seq, lastUpdate, lastCommand = 0, -1, nil
local bridgeID = tostring(os.preciseClock()) .. ':' .. tostring(math.random(1, 100000000))
local ack = {id = '', ok = false, message = 'No command yet'}
local deployUntil = nil
local capabilities = {}
local cachedControls, cachedEdit, cachedCar, nextControlsAt = nil, false, nil, 0
local thermalKey, thermalCurves = nil, {}
local radarState, radarAt = nil, -1
local mapCars, mapAt = {}, -1
local function num(v, fallback)
  if type(v) == 'number' and v == v and math.abs(v) < 100000000 then return v end
  return fallback or 0
end
local function nearbyCars(car,sim)
  local range=30
  local cars={}
  for i=1,num(sim.carsCount,1)-1 do
    local other=ac.getCar(i)
    if other and other.isConnected and other.isActive then
      local dx,dz=other.position.x-car.position.x,other.position.z-car.position.z
      local dy=other.position.y-car.position.y
      local distance=math.sqrt(dx*dx+dy*dy+dz*dz)
      if distance<=range and math.abs(dy)<=6 then
        cars[#cars+1]={id=i,right_m=dx*car.side.x+dz*car.side.z,
          forward_m=dx*car.look.x+dz*car.look.z,distance_m=distance,
          heading_right=other.look.x*car.side.x+other.look.z*car.side.z,
          heading_forward=other.look.x*car.look.x+other.look.z*car.look.z,
          width_m=num(other.aabbSize.x,2),length_m=num(other.aabbSize.z,4.5)}
      end
    end
  end
  table.sort(cars,function(a,b)return a.distance_m<b.distance_m end)
  while #cars>16 do table.remove(cars) end
  return {available=true,range_m=range,cars=cars,width_m=num(car.aabbSize.x,2),length_m=num(car.aabbSize.z,4.5)}
end
local function curvesFor(car)
  local key=ac.getCarID(0)..':'..tostring(car.compoundIndex)
  if key==thermalKey then return thermalCurves end
  thermalKey=key;thermalCurves={}
  local ok,data=pcall(function()
    local cfg=ac.INIConfig.carData(0,'tyres.ini')
    local result={}
    for _,axle in ipairs({'FRONT','REAR'}) do
      local suffix=car.compoundIndex>0 and '_'..car.compoundIndex or ''
      local section='THERMAL_'..axle..suffix
      local lut=cfg:tryGetLut(section,'PERFORMANCE_CURVE')
      if lut then
        local points={}
        local offset=cfg:get(section,'OPTIMAL_TEMP_OFFSET',0)
        for i=0,255 do
          local x,y=lut:getPointInput(i),lut:getPointOutput(i)
          if x~=x or y~=y then break end
          points[#points+1]={x+offset,y}
        end
        if #points>1 then result[axle:lower()]=points end
      end
    end
    return result
  end)
  if ok then thermalCurves=data end
  return thermalCurves
end
local function add(list, id, label, kind, value, min, max, step, unit, group, options)
  local item = {id=id, label=label, type=kind, value=value, min=min, max=max,
    step=step or 1, unit=unit or '', group=group or 'assists', options=options}
  list[#list+1] = item
  capabilities[id] = item
end
local function controls(car, sim)
  local list = {}
  capabilities = {}
  if car.tractionControlModes > 0 then add(list,'tc','Traction control','step',car.tractionControlMode,0,car.tractionControlModes,1) end
  if car.absModes > 0 then add(list,'abs','ABS','step',car.absMode,0,car.absModes,1) end
  if car.hasUserBrakeBias then add(list,'bias','Front brake bias','step',num(car.brakeBias)*100,0,100,0.5,'%') end
  if car.engineBrakeSettingsCount > 0 then add(list,'engine-brake','Engine braking','step',car.currentEngineBrakeSetting,0,car.engineBrakeSettingsCount-1,1) end
  add(list,'ffb','Force feedback · this car','slider',num(car.ffbMultiplier,1)*100,0,150,1,'%')
  if car.drsPresent then add(list,'drs','DRS','toggle',car.drsActive,nil,nil,nil,nil,'power') end
  if car.kersPresent then add(list,'kers','KERS / ERS deploy','hold',false,nil,nil,nil,nil,'power') end
  if car.hasCockpitERSDelivery and car.mgukDeliveryCount > 0 then add(list,'delivery','MGU-K delivery','step',car.mgukDelivery,0,car.mgukDeliveryCount-1,1,'','power') end
  if car.hasCockpitERSRecovery then add(list,'recovery','MGU-K recovery','step',car.mgukRecovery,0,10,1,'','power') end
  if car.hasCockpitMGUHMode then add(list,'mguh','MGU-H charging','toggle',car.mguhChargingBatteries,nil,nil,nil,nil,'power') end
  if car.turboCount > 0 and ac.isTurboWastegateAdjustable(0) then add(list,'boost','Turbo boost','slider',num(car.turboWastegates[0])*100,0,100,1,'%','power') end
  add(list,'headlights','Headlights','toggle',car.headlightsActive,nil,nil,nil,nil,'visibility')
  if car.hasLowBeams then add(list,'high-beams','High beams','toggle',car.highBeams,nil,nil,nil,nil,'visibility') end
  add(list,'flash','Flash headlights','action',false,nil,nil,nil,nil,'visibility')
  if car.hasTurningLights then
    local mode = car.hazardLights and 'Hazards' or car.turningLeftLights and 'Left' or car.turningRightLights and 'Right' or 'Off'
    add(list,'indicators','Indicators','select',mode,nil,nil,nil,nil,'visibility',{'Off','Left','Right','Hazards'})
  end
  if car.wiperModes > 1 then add(list,'wipers','Wiper speed','step',car.wiperSelectedMode,0,car.wiperModes-1,1,'','visibility') end
  local preset = num(sim.currentQuickPitPreset)
  add(list,'pit-preset','Quick-pit preset','select','Preset '..(preset+1),nil,nil,nil,nil,'pitplan',{'Preset 1','Preset 2','Preset 3'})
  local ok, spinners = pcall(ac.getPitstopSpinners)
  if ok and spinners then
    for _,s in ipairs(spinners) do
      if not s.readOnly then
        add(list,'pit:'..s.name,s.name,'step',num(s.value),num(s.min),num(s.max),1,'','pitplan')
      end
    end
  end
  local edit = ac.isSetupAvailableToEdit()
  local setupOK, setups = pcall(ac.getSetupSpinners)
  if setupOK and setups then
    for _,s in ipairs(setups) do
      if edit and not s.readOnly then
        local factor=num(s.displayMultiplier,1);if factor==0 then factor=1 end
        local low,high=num(s.min)*factor,num(s.max)*factor
        add(list,'setup:'..s.name,s.label or s.name,'step',num(s.value)*factor,math.min(low,high),math.max(low,high),math.max(math.abs(num(s.step,1)*factor),0.001),s.units or '','setup')
        capabilities['setup:'..s.name].display_multiplier=factor
      end
    end
  end
  add(list,'pause',sim.isPaused and 'Resume' or 'Pause','action',false,nil,nil,nil,nil,'session')
  add(list,'return-pits','Return to pits','action',false,nil,nil,nil,nil,'session')
  if not sim.isOnlineRace then
    add(list,'restart','Restart session','action',false,nil,nil,nil,nil,'session')
    add(list,'advance','Next session','action',false,nil,nil,nil,nil,'session')
  end
  if car.isInPit then add(list,'drive','Go to track','action',false,nil,nil,nil,nil,'session') end
  return list, edit
end
local function apply(id, value, car, sim)
  local spec = capabilities[id]
  if not spec then error('This control is not available for this car/session') end
  if spec.type == 'step' or spec.type == 'slider' then
    if type(value) ~= 'number' or value ~= value or value < spec.min or value > spec.max then error('Value outside current car limits') end
  elseif spec.type == 'toggle' or spec.type == 'hold' then
    if type(value) ~= 'boolean' then error('Expected on/off value') end
  elseif spec.type == 'select' then
    local found = false
    for _,v in ipairs(spec.options) do if v == value then found = true end end
    if not found then error('Invalid option') end
  end
  ac.setTargetCar(0)
  local result
  if id == 'tc' then ac.setTC(value)
  elseif id == 'abs' then ac.setABS(value)
  elseif id == 'bias' then ac.setBrakeBias(value/100)
  elseif id == 'engine-brake' then ac.setEngineBrakeSetting(value)
  elseif id == 'ffb' then ac.setFFBMultiplier(value/100)
  elseif id == 'drs' then ac.setDRS(value)
  elseif id == 'kers' then deployUntil = value and os.preciseClock()+0.4 or nil; ac.setKERS(value)
  elseif id == 'delivery' then ac.setMGUKDelivery(value)
  elseif id == 'recovery' then ac.setMGUKRecovery(value)
  elseif id == 'mguh' then ac.setMGUHCharging(value)
  elseif id == 'boost' then ac.setTurboWastegate(value/100,0)
  elseif id == 'headlights' then ac.setHeadlights(value)
  elseif id == 'high-beams' then ac.setHighBeams(value)
  elseif id == 'flash' then ac.flashLights()
  elseif id == 'indicators' then ac.setTurningLights(({Off=0,Left=1,Right=2,Hazards=3})[value])
  elseif id == 'wipers' then ac.setWiperMode(value)
  elseif id == 'pit-preset' then result = ac.setCurrentQuickPitPreset(tonumber(value:match('%d+'))-1)
  elseif id:sub(1,4) == 'pit:' then result = ac.setPitstopSpinnerValue(id:sub(5),value)
  elseif id:sub(1,6) == 'setup:' then
    if not ac.isSetupAvailableToEdit() then error('Setup is not editable now; park in the pit box') end
    result = ac.setSetupSpinnerValue(id:sub(7),value/(spec.display_multiplier or 1))
  elseif id == 'pause' then result = ac.tryToPause(not sim.isPaused)
  elseif id == 'return-pits' then result = ac.tryToTeleportToPits()
  elseif id == 'restart' then result = ac.tryToRestartSession()
  elseif id == 'advance' then result = ac.tryToSkipSession()
  elseif id == 'drive' then result = ac.tryToStart()
  else error('Unsupported command') end
  if result == false then error('AC rejected this change in the current session') end
end

function script.update(dt)
  local now = os.preciseClock()
  if deployUntil then
    if now < deployUntil then ac.setKERS(true) else ac.setKERS(false);deployUntil=nil end
  end
  if now-lastUpdate < 1/60 then return end
  lastUpdate = now-lastUpdate>.1 and now or lastUpdate+1/60
  local car, sim = ac.getCar(0), ac.getSim()
  local active = car and car.physicsAvailable and not sim.isReplayActive
  local payload = {protocol=2,active=active and true or false,bridge_id=bridgeID,ack=ack}
  if active then
    local id = ac.getCarID(0)
    if not cachedControls or cachedCar~=id or now>=nextControlsAt then
      cachedControls,cachedEdit=controls(car,sim);cachedCar=id;nextControlsAt=now+.2
    end
    local list, edit = cachedControls,cachedEdit
    payload.car=id;payload.controls=list;payload.setup_editable=edit
    payload.gear_count=car.gearCount;payload.steering_deg=num(car.steer)
    payload.race_position=num(car.racePosition)
    -- Also replace the legacy shared-memory position in older Python servers.
    payload.position=payload.race_position;payload.position_source='CSP live ranking'
    payload.is_race=sim.raceSessionType==ac.SessionType.Race
    payload.track=ac.getTrackID();payload.track_layout=ac.getTrackLayout() or ''
    payload.world_position={car.position.x,car.position.z}
    payload.world_forward={car.look.x,car.look.z}
    if not radarState or now-radarAt>=1/30 then
      local radarOK,radar=pcall(nearbyCars,car,sim)
      radarState=radarOK and radar or {available=false,message='Nearby-car telemetry unavailable'}
      radarAt=now
    end
    payload.radar=radarState
    payload.steering_lock=num(car.steerLock,450);payload.rpm_limit=num(car.rpmLimiter)
    payload.tc_mode=car.tractionControlMode;payload.abs_mode=car.absMode
    payload.tc_modes=car.tractionControlModes;payload.abs_modes=car.absModes
    payload.lap_valid=car.isLapValid;payload.last_lap_valid=car.isLastLapValid
    payload.native_delta=car.performanceMeter;payload.native_best_ms=car.bestLapTimeMs
    payload.delta_speed_ms=car.performanceMeterSpeedDifferenceMs
    payload.damage_body={};payload.damage_suspension={}
    for i=0,3 do
      if car.damage then payload.damage_body[i+1]=num(car.damage[i]) end
      payload.damage_suspension[i+1]=num(car.wheels[i].suspensionDamage)
    end
    payload.engine_life=car.engineLifeLeft;payload.gearbox_damage=car.gearboxDamage
    if now-mapAt>=.1 then
      mapCars={}
      for i=1,num(sim.carsCount,1)-1 do
        local other=ac.getCar(i)
        if other and other.isConnected and other.isActive then
          mapCars[#mapCars+1]={id=i,position={other.position.x,other.position.z},forward={other.look.x,other.look.z},race_position=other.racePosition}
        end
      end
      mapAt=now
    end
    payload.map_cars=mapCars;payload.is_online=sim.isOnlineRace
    payload.reset_counter=car.resetCounter
    payload.thermal_curves=curvesFor(car)
    payload.in_pit=car.isInPit;payload.in_pit_lane=car.isInPitlane;payload.paused=sim.isPaused
    payload.tyre_surface={};payload.tyre_optimum={};payload.tyre_wear_fraction={};payload.tyre_flatspot={};payload.tyre_slip_ratio={}
    for i=0,3 do
      local w=car.wheels[i]
      payload.tyre_surface[i+1]={num(w.tyreInsideTemperature),num(w.tyreMiddleTemperature),num(w.tyreOutsideTemperature)}
      payload.tyre_optimum[i+1]=num(w.tyreOptimumTemperature)
      payload.tyre_wear_fraction[i+1]=num(w.tyreWear)
      payload.tyre_flatspot[i+1]=num(w.tyreFlatSpot)
      payload.tyre_slip_ratio[i+1]=num(w.slipRatio)
    end
    local before = input.packetId
    if before > 0 and before%2 == 0 and input.length > 0 and input.length <= 8192 then
      local raw = ffi.string(input.data,input.length)
      if before == input.packetId then
        local parseOK, cmd = pcall(JSON.parse,raw)
        if parseOK and type(cmd)=='table' and cmd.id and cmd.id~=lastCommand then
          lastCommand=cmd.id
          local success,err=pcall(function()
            if cmd.bridge_id~=bridgeID or cmd.car~=id or type(cmd.frame)~='number' or math.abs(seq-cmd.frame)>100 then error('Expired command or session changed') end
            apply(cmd.control,cmd.value,car,sim)
            cachedControls=nil -- Refresh actual control readback on the next packet.
          end)
          ack={id=cmd.id,ok=success,message=success and 'AC command acknowledged; readback follows' or tostring(err)}
          payload.ack=ack
        end
      end
    end
  end
  local ok,raw = pcall(JSON.stringify,payload)
  if not ok or #raw >= 65536 then return end
  seq=(seq+2)%2000000000;if seq==0 then seq=2 end
  output.packetId=seq-1
  ffi.copy(output.data,raw,#raw);output.data[#raw]=0
  output.length=#raw;output.packetId=seq
end

function script.windowMain()
  ui.text('AC Dash: telemetry + supported car controls')
  ui.text('Phone commands only apply when you tap a control.')
  ui.text('Last command: '..ack.message)
end
