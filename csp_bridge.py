"""Read-only consumer of our own, versioned CSP telemetry mapping.

No offsets into CSP internals. Layout is authored together with bridge.lua.
"""
import ctypes as C
import math
import time
import json
import mmap
import uuid


class JSONState(C.LittleEndianStructure):
    _pack_ = 4
    _fields_ = [('packetId', C.c_int32), ('length', C.c_int32), ('data', C.c_char * 65536)]


class ExtraState(C.LittleEndianStructure):
    _pack_ = 4
    _fields_ = [("packetId", C.c_int32), ("version", C.c_int32), ("active", C.c_int32),
                ("gear_count", C.c_int32), ("tc_mode", C.c_int32), ("abs_mode", C.c_int32),
                ("steer_deg", C.c_float), ("steer_lock", C.c_float), ("rpm_limit", C.c_float),
                ("surface", C.c_float * 12), ("optimum", C.c_float * 4),
                ("wear", C.c_float * 4), ("flatspot", C.c_float * 4),
                ("slip_ratio", C.c_float * 4), ("car_id", C.c_char * 80)]


class CSPBridge:
    def __init__(self, api, mapping_factory):
        self.api, self.factory = api, mapping_factory
        self.mapping = None
        self.packet = None
        self.changed = self.retry_at = 0
        self.json_mapping = None
        self.json_packet = None
        self.json_changed = self.json_retry = 0
        self.command_mapping = None
        self.command_seq = 0

    def close(self):
        if self.mapping:
            self.mapping.close()
        self.mapping = None
        self.packet = None
        if self.json_mapping:
            self.json_mapping.close()
        self.json_mapping = None
        self.json_packet = None

    def dispose(self):
        self.close()
        if self.command_mapping:
            self.command_mapping.close()
            self.command_mapping = None

    def sample_v2(self, car_id=None):
        now = time.monotonic()
        if not self.api or now < self.json_retry:
            return {}
        try:
            if self.json_mapping is None:
                self.json_mapping = self.factory(self.api, 'Local\\AcTools.CSP.Limited.ACDash.state2', JSONState)
            state = self.json_mapping.read()
            if state.packetId <= 0 or state.packetId % 2 or not 0 < state.length < 65536:
                return {}
            if state.packetId != self.json_packet:
                self.json_packet, self.json_changed = state.packetId, now
            if now - self.json_changed > 1.5:
                self.json_mapping.close()
                self.json_mapping = None
                self.json_packet = None
                self.json_retry = now + .5
                return {}
            payload = json.loads(bytes(state.data)[:state.length].decode('utf-8'))
            if payload.get('protocol') != 2 or not payload.get('active'):
                return {}
            if car_id and payload.get('car') != car_id:
                return {}
            payload['csp_connected'] = True
            payload['bridge_frame'] = state.packetId
            return payload
        except (OSError, ValueError, TypeError, AttributeError):
            if self.json_mapping:
                self.json_mapping.close()
            self.json_mapping = None
            self.json_retry = now + 1
            return {}

    def send_command(self, state, control_id, value):
        if not state.get('bridge_id') or not state.get('csp_connected'):
            raise ValueError('AC Dash Bridge is not connected. Restart the AC session after installing it.')
        command_id = uuid.uuid4().hex
        message = json.dumps({'id': command_id, 'bridge_id': state['bridge_id'],
                              'frame': state['bridge_frame'], 'car': state['car'],
                              'control': control_id, 'value': value}, allow_nan=False).encode('utf-8')
        if len(message) > 8000:
            raise ValueError('Command is too large')
        if self.command_mapping is None:
            self.command_mapping = mmap.mmap(-1, 8200, tagname='Local\\AcTools.CSP.Limited.ACDash.command2')
        import struct
        self.command_seq = (self.command_seq + 2) % 2000000000 or 2
        self.command_mapping[:4] = struct.pack('<i', self.command_seq - 1)
        self.command_mapping[4:8] = struct.pack('<i', len(message))
        self.command_mapping[8:8+len(message)] = message
        self.command_mapping[:4] = struct.pack('<i', self.command_seq)
        return command_id

    def sample(self, car_id):
        extended = self.sample_v2(car_id)
        if extended:
            return extended
        now = time.monotonic()
        if not self.api:
            return {}
        try:
            if self.mapping is None:
                if now < self.retry_at:
                    return {}
                self.retry_at = now + 1
                self.mapping = self.factory(self.api, 'Local\\AcTools.CSP.Limited.ACDash.v1', ExtraState)
            state = self.mapping.read()
            if state.packetId <= 0 or state.packetId % 2 or state.version != 1:
                return {}
            if state.packetId != self.packet:
                self.packet, self.changed = state.packetId, now
            if now - self.changed > 1:
                self.close()
                self.retry_at = now + 1
                return {}
            name = bytes(state.car_id).decode('utf-8', errors='replace')
            if not state.active or not car_id or name != car_id[:79]:
                return {}
            def number(v, low=-10000, high=30000):
                return round(v, 3) if math.isfinite(v) and low <= v <= high else None
            return {'csp_connected': True,
                    'steering_deg': number(state.steer_deg, -2000, 2000),
                    'steering_lock': number(state.steer_lock, 1, 2000),
                    'gear_count': state.gear_count if 1 <= state.gear_count <= 20 else None,
                    'tc_mode': state.tc_mode if 0 <= state.tc_mode <= 100 else None,
                    'abs_mode': state.abs_mode if 0 <= state.abs_mode <= 100 else None,
                    'rpm_limit': number(state.rpm_limit, 1000, 30000),
                    'tyre_surface': [[number(state.surface[i*3+j], 1, 500) for j in range(3)] for i in range(4)],
                    'tyre_optimum': [number(v, 1, 500) for v in state.optimum],
                    'tyre_wear_fraction': [number(v, 0, 1) for v in state.wear],
                    'tyre_flatspot': [number(v, 0, 100) for v in state.flatspot],
                    'tyre_slip_ratio': [number(v, -100, 100) for v in state.slip_ratio]}
        except (OSError, ValueError):
            self.close()
            self.retry_at = now + 1
            return {}
