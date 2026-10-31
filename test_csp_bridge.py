import ctypes as C
import mmap
import os
import struct
import unittest
from unittest.mock import patch
from ac_memory import Mapping, ACReader
from csp_bridge import CSPBridge, ExtraState


@unittest.skipUnless(os.name=='nt','Windows shared memory')
class BridgeTests(unittest.TestCase):
    def test_schema_and_freshness(self):
        self.assertEqual(C.sizeof(ExtraState),228)
        name='Local\\ACDash_fixture_'+str(os.getpid())
        with mmap.mmap(-1,228,tagname=name) as mm:
            raw=bytearray(228)
            struct.pack_into('<6i3f',raw,0,2,1,1,7,2,1,-90.,450.,8800.)
            struct.pack_into('<12f',raw,36,*range(80,92))
            struct.pack_into('<4f',raw,84,90,90,90,90)
            struct.pack_into('<4f',raw,100,.1,.2,.3,.4)
            raw[148:156]=b'test_car'
            mm[:]=raw
            reader=ACReader()
            bridge=CSPBridge(reader.api,lambda api,n,cls:Mapping(api,name,cls))
            try:
                data=bridge.sample('test_car')
                self.assertEqual(data['steering_deg'],-90)
                self.assertEqual(data['gear_count'],7)
                self.assertEqual(data['tc_mode'],2)
                self.assertEqual(data['tyre_surface'][0],[80,81,82])
                self.assertEqual(data['tyre_wear_fraction'],[.1,.2,.3,.4])
                self.assertEqual(bridge.sample('wrong_car'),{})
                mm[:4]=struct.pack('<i',3) # Reject half-written snapshots.
                self.assertEqual(bridge.sample('test_car'),{})
                mm[:4]=struct.pack('<i',2)
                bridge.changed-=2
                self.assertEqual(bridge.sample('test_car'),{})
                self.assertIsNone(bridge.mapping)
            finally:
                bridge.close();reader.close()

    def test_missing_bridge_is_optional(self):
        reader=ACReader()
        def absent(*args):raise OSError('Not installed')
        bridge=CSPBridge(reader.api,absent)
        try:self.assertEqual(bridge.sample('car'),{})
        finally:bridge.close();reader.close()
