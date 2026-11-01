"""Original Assetto Corsa: read only the documented prefixes we need.

Layout sources and rationale: SOURCES.md. No guessed offsets, no writes.
OpenFileMappingW opens EXISTING mappings (unlike mmap(tagname), which can
silently create empty memory when the game is absent).
"""
import ctypes as C
import math
import os
import time
from pathlib import Path
from ctypes import wintypes as W
from lap_delta import LapDelta
from csp_bridge import CSPBridge
from car_metadata import resolve_gears, resolve_race_position


class Physics(C.LittleEndianStructure):
    _pack_ = 4
    _fields_ = [("packetId", C.c_int32), ("gas", C.c_float),
                ("brake", C.c_float), ("fuel", C.c_float),
                ("gear", C.c_int32), ("rpms", C.c_int32),
                ("steerAngle", C.c_float), ("speedKmh", C.c_float),
                ("velocity", C.c_float * 3), ("accG", C.c_float * 3),
                ("wheelSlip", C.c_float * 4), ("wheelLoad", C.c_float * 4),
                ("wheelsPressure", C.c_float * 4), ("wheelAngularSpeed", C.c_float * 4),
                ("tyreWear", C.c_float * 4), ("tyreDirtyLevel", C.c_float * 4),
                ("tyreCoreTemperature", C.c_float * 4), ("camberRAD", C.c_float * 4),
                ("suspensionTravel", C.c_float * 4), ("drs", C.c_float), ("tc", C.c_float),
                ("heading", C.c_float), ("pitch", C.c_float), ("roll", C.c_float),
                ("cgHeight", C.c_float), ("carDamage", C.c_float * 5),
                ("numberOfTyresOut", C.c_int32), ("pitLimiterOn", C.c_int32),
                ("abs", C.c_float), ("kersCharge", C.c_float), ("kersInput", C.c_float),
                ("autoShifterOn", C.c_int32), ("rideHeight", C.c_float * 2),
                ("turboBoost", C.c_float), ("ballast", C.c_float),
                ("airDensity", C.c_float), ("airTemp", C.c_float), ("roadTemp", C.c_float),
                ("localAngularVel", C.c_float * 3), ("finalFF", C.c_float),
                ("performanceMeter", C.c_float), ("engineBrake", C.c_int32),
                ("ersRecoveryLevel", C.c_int32), ("ersPowerLevel", C.c_int32),
                ("ersHeatCharging", C.c_int32), ("ersIsCharging", C.c_int32),
                ("kersCurrentKJ", C.c_float), ("drsAvailable", C.c_int32),
                ("drsEnabled", C.c_int32), ("brakeTemp", C.c_float * 4),
                ("clutch", C.c_float), ("tyreTempI", C.c_float * 4),
                ("tyreTempM", C.c_float * 4), ("tyreTempO", C.c_float * 4),
                ("isAIControlled", C.c_int32), ("tyreContactPoint", C.c_float * 12),
                ("tyreContactNormal", C.c_float * 12), ("tyreContactHeading", C.c_float * 12),
                ("brakeBias", C.c_float), ("localVelocity", C.c_float * 3)]


class Graphics(C.LittleEndianStructure):
    _pack_ = 4
    _fields_ = [("packetId", C.c_int32), ("status", C.c_int32),
                ("session", C.c_int32),
                ("currentTime", C.c_uint16 * 15), ("lastTime", C.c_uint16 * 15),
                ("bestTime", C.c_uint16 * 15), ("split", C.c_uint16 * 15),
                ("completedLaps", C.c_int32), ("position", C.c_int32),
                ("iCurrentTime", C.c_int32), ("iLastTime", C.c_int32),
                ("iBestTime", C.c_int32), ("sessionTimeLeft", C.c_float),
                ("distanceTraveled", C.c_float), ("isInPit", C.c_int32),
                ("currentSectorIndex", C.c_int32), ("lastSectorTime", C.c_int32),
                ("numberOfLaps", C.c_int32), ("tyreCompound", C.c_uint16 * 33),
                ("replayTimeMultiplier", C.c_float), ("normalizedCarPosition", C.c_float),
                ("carCoordinates", C.c_float * 3), ("penaltyTime", C.c_float),
                ("flag", C.c_int32), ("idealLineOn", C.c_int32),
                ("isInPitLane", C.c_int32), ("surfaceGrip", C.c_float),
                ("mandatoryPitDone", C.c_int32), ("windSpeed", C.c_float),
                ("windDirection", C.c_float)]


class Static(C.LittleEndianStructure):
    _pack_ = 4
    _fields_ = [("smVersion", C.c_uint16 * 15), ("acVersion", C.c_uint16 * 15),
                ("numberOfSessions", C.c_int32), ("numCars", C.c_int32),
                ("carModel", C.c_uint16 * 33), ("track", C.c_uint16 * 33),
                ("playerName", C.c_uint16 * 33), ("playerSurname", C.c_uint16 * 33),
                ("playerNick", C.c_uint16 * 33), ("sectorCount", C.c_int32),
                ("maxTorque", C.c_float), ("maxPower", C.c_float),
                ("maxRpm", C.c_int32), ("maxFuel", C.c_float),
                ("suspensionMaxTravel", C.c_float * 4), ("tyreRadius", C.c_float * 4),
                ("maxTurboBoost", C.c_float), ("deprecated1", C.c_float),
                ("deprecated2", C.c_float), ("penaltiesEnabled", C.c_int32),
                ("aidFuelRate", C.c_float), ("aidTireRate", C.c_float),
                ("aidMechanicalDamage", C.c_float), ("aidAllowTyreBlankets", C.c_int32),
                ("aidStability", C.c_float), ("aidAutoClutch", C.c_int32),
                ("aidAutoBlip", C.c_int32), ("hasDRS", C.c_int32),
                ("hasERS", C.c_int32), ("hasKERS", C.c_int32)]


def text16(value):
    return bytes(value).decode('utf-16-le', errors='replace').split('\0', 1)[0]


def finite(value, low=-1e6, high=1e6):
    return round(value, 3) if math.isfinite(value) and low <= value <= high else None


class Mapping:
    def __init__(self, api, name, struct):
        self.api, self.struct = api, struct
        self.handle = api.OpenFileMappingW(4, False, name)  # FILE_MAP_READ
        self.address = None
        if not self.handle:
            raise C.WinError(C.get_last_error())
        self.address = api.MapViewOfFile(self.handle, 4, 0, 0, C.sizeof(struct))
        if not self.address:
            error = C.WinError(C.get_last_error())
            self.close()
            raise error

    def read(self):
        if self.struct is Static:  # Static page has no packetId header.
            return self.struct.from_buffer_copy(C.string_at(self.address, C.sizeof(self.struct)))
        # Retry if the packet changes while copying. The game owns the writer;
        # this is a best-effort snapshot, not a cross-page atomic transaction.
        for _ in range(3):
            before = C.c_int32.from_address(self.address).value
            value = self.struct.from_buffer_copy(C.string_at(self.address, C.sizeof(self.struct)))
            after = C.c_int32.from_address(self.address).value
            if before == value.packetId == after:
                return value
        raise ValueError("Telemetry changed during read; waiting for next sample.")

    def close(self):
        if self.address:
            self.api.UnmapViewOfFile(self.address)
            self.address = None
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


def offline(message):
    return {"status": "offline", "message": message}


class ACReader:
    def __init__(self):
        self.physics = self.graphics = self.static = None
        self.delta = LapDelta()
        self.context = None
        self.packet = None
        self.changed = time.monotonic()
        self.retry_at = 0
        self.api = None
        if os.name == "nt":
            self.api = C.WinDLL("kernel32", use_last_error=True)
            self.api.OpenFileMappingW.argtypes = [W.DWORD, W.BOOL, W.LPCWSTR]
            self.api.OpenFileMappingW.restype = W.HANDLE
            self.api.MapViewOfFile.argtypes = [W.HANDLE, W.DWORD, W.DWORD, W.DWORD, C.c_size_t]
            self.api.MapViewOfFile.restype = C.c_void_p
            self.api.UnmapViewOfFile.argtypes = [C.c_void_p]
            self.api.UnmapViewOfFile.restype = W.BOOL
            self.api.CloseHandle.argtypes = [W.HANDLE]
            self.api.CloseHandle.restype = W.BOOL
        self.bridge = CSPBridge(self.api, Mapping)

    def close(self):
        self.bridge.close()
        for mapping in (self.physics, self.graphics, self.static):
            if mapping:
                mapping.close()
        self.physics = self.graphics = self.static = None
        self.packet = None

    def sample(self):
        if not self.api:
            return offline("Live mode needs Windows. Try --mock on this computer.")
        now = time.monotonic()
        if self.physics is None:
            if now < self.retry_at:
                return offline("Waiting for AC. Start original Assetto Corsa and enter a driving session.")
            try:
                self.physics = Mapping(self.api, "Local\\acpmf_physics", Physics)
                self.graphics = Mapping(self.api, "Local\\acpmf_graphics", Graphics)
                self.changed = now
            except OSError as error:
                self.close()
                self.retry_at = now + 1
                return offline(f"Cannot open AC memory (Windows error {error.winerror}). Start AC and enter a driving session; run both programs as the same Windows user.")
        try:
            p, g = self.physics.read(), self.graphics.read()
            if self.static is None:
                try:
                    self.static = Mapping(self.api, "Local\\acpmf_static", Static)
                except OSError:
                    pass  # Keep core telemetry working even without metadata.
            s = self.static.read() if self.static else None
            if p.packetId != self.packet:
                self.packet, self.changed = p.packetId, now
            if now - self.changed > 2:
                self.close()  # Release old pages so a restarted game can reconnect.
                self.retry_at = now + 0.5
                return offline("Telemetry stopped. Resume driving or restart the AC session.")
            if g.status != 2:
                if g.status != 3:self.delta.interrupt()
                return offline({0: "AC is offline. Enter a driving session.",
                                1: "Replay active. Enter a live driving session.",
                                3: "AC is paused. Resume driving."}.get(g.status, "Waiting for a live AC session."))
            if not all(math.isfinite(v) for v in (p.speedKmh, p.gas, p.brake)):
                raise ValueError("Invalid telemetry; waiting for AC.")
            context = (text16(s.carModel), text16(s.track), g.session) if s else ('', '', g.session)
            extra=self.bridge.sample(context[0])
            context=(context[0],extra.get('track') or context[1],context[2],extra.get('track_layout') or '')
            if context != self.context:
                self.delta.configure(context,Path(__file__).resolve().parent/'lap-recordings')
                self.context = context
            delta = self.delta.update(g.completedLaps, g.normalizedCarPosition,
                                      g.iCurrentTime, g.iLastTime,
                                      p.numberOfTyresOut <= 2 and g.penaltyTime <= 0 and not (g.isInPit or g.isInPitLane) and extra.get('lap_valid',True),
                                      last_valid=extra.get('last_lap_valid'),reset_counter=extra.get('reset_counter'))
            delta_source='recorded best' if delta is not None else None
            # CSP documents performanceMeter in seconds against AC's session best.
            # Useful when this app joined mid-lap and has no sampled reference yet.
            native=extra.get('native_delta')
            if delta is None and not self.delta.invalid and extra.get('lap_valid') is True and extra.get('native_best_ms',0)>0 and isinstance(native,(float,int)) and math.isfinite(native):
                delta=round(native,3);delta_source='AC session best'
            result = {"status": "live", "message": "LIVE · Assetto Corsa",
                    "speed": round(max(0, p.speedKmh), 1), "rpm": max(0, p.rpms),
                    "gear": "R" if p.gear == 0 else "N" if p.gear == 1 else str(p.gear - 1),
                    "throttle": round(min(1, max(0, p.gas)) * 100),
                    "brake": round(min(1, max(0, p.brake)) * 100),
                    "car": context[0] or None, "track": context[1] or None,
                    "track_layout":context[3],
                    "world_position":[finite(g.carCoordinates[0]),finite(g.carCoordinates[2])],
                    "max_rpm": s.maxRpm if s and s.maxRpm > 0 else None,
                    "fuel": finite(p.fuel, 0, 1000),
                    "g_lateral": finite(p.accG[0], -20, 20),
                    "g_longitudinal": finite(p.accG[2], -20, 20),
                    "tyre_temps": [finite(v, 1, 500) for v in p.tyreCoreTemperature],
                    "tc": finite(p.tc, 0, 100), "abs": finite(getattr(p, 'abs'), 0, 100),
                    "drs": bool(p.drsEnabled or p.drs > .5) if s and s.hasDRS else None,
                    "drs_available": bool(p.drsAvailable) if s and s.hasDRS else None,
                    "kers": finite(p.kersCharge, 0, 1) if s and (s.hasKERS or s.hasERS) else None,
                    "session": g.session, "position": g.position if g.position > 0 else None,
                    "lap_progress": finite(g.normalizedCarPosition, 0, 1),
                    "lap": max(1, g.completedLaps + 1),
                    "lap_ms": max(0, g.iCurrentTime),
                    "last_lap_ms": g.iLastTime if g.iLastTime > 0 else None,
                    "best_lap_ms": g.iBestTime if g.iBestTime > 0 else None,
                    "delta": delta, "delta_reference_ms": self.delta.best_ms,
                    "delta_source":delta_source,"current_lap_invalid":self.delta.invalid,
                    "track_limits":p.numberOfTyresOut>2 or (extra.get('lap_valid') is False and not (g.isInPit or g.isInPitLane)),
                    "damage_body":[finite(v,0,100000) for v in p.carDamage[:4]],
                    "delta_state": self.delta.state, "recorded_laps":len(self.delta.history),
                    "flag": g.flag, "in_pit": bool(g.isInPit or g.isInPitLane)}
            result.update(extra)
            result['in_pit']=bool(g.isInPit or g.isInPitLane or extra.get('in_pit') or extra.get('in_pit_lane'))
            result['gear_count'], result['gear_count_source'] = resolve_gears(result.get('gear_count'))
            result['position'], result['position_source'] = resolve_race_position(g.position,extra)
            return result
        except (OSError, ValueError) as error:
            return offline(str(error))
