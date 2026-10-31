"""Run: py -m unittest -v test_dashboard.py"""
import asyncio
import ctypes
import mmap
import os
import struct
import unittest
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer
from ac_memory import ACReader, Physics, Graphics, Static, text16
from lap_delta import LapDelta
from server import create_app


class LayoutTests(unittest.TestCase):
    def test_documented_prefix(self):
        self.assertEqual(ctypes.sizeof(Physics), 580)
        self.assertEqual(ctypes.sizeof(Graphics), 296)
        self.assertEqual(ctypes.sizeof(Static), 508)
        raw = struct.pack('<ifffiiff', 42, .75, .25, 30., 3, 4500, 0., 123.5) + bytes(548)
        p = Physics.from_buffer_copy(raw)
        self.assertEqual((p.packetId, p.gear, p.rpms, p.speedKmh), (42, 3, 4500, 123.5))
        self.assertEqual((p.gas, p.brake), (.75, .25))

    @unittest.skipUnless(os.name == 'nt', 'Windows named memory required')
    def test_windows_reader_fixture_and_stale_recovery(self):
        # Deliberately use test names so a running real game is never touched.
        import ac_memory
        real_mapping = ac_memory.Mapping
        suffix = str(os.getpid())
        names = {'Local\\acpmf_physics': 'Local\\ac_dashboard_test_p_' + suffix,
                 'Local\\acpmf_graphics': 'Local\\ac_dashboard_test_g_' + suffix,
                 'Local\\acpmf_static': 'Local\\ac_dashboard_test_s_' + suffix}
        with mmap.mmap(-1, 580, tagname=names['Local\\acpmf_physics']) as pm, \
             mmap.mmap(-1, 296, tagname=names['Local\\acpmf_graphics']) as gm, \
             mmap.mmap(-1, 508, tagname=names['Local\\acpmf_static']) as sm:
            physics = bytearray(580)
            physics[:32] = struct.pack('<ifffiiff', 42, .75, .25, 30., 3, 4500, 0., 123.5)
            # Independent byte fixtures derived from the documented ordered fields.
            struct.pack_into('<3f', physics, 44, .8, 0., -.4)
            struct.pack_into('<4f', physics, 152, 80., 85., 90., 95.)
            struct.pack_into('<f', physics, 204, 1.)
            struct.pack_into('<f', physics, 252, 1.)
            pm[:] = physics
            graphics = bytearray(296)
            struct.pack_into('<iii', graphics, 0, 1, 2, 2)
            struct.pack_into('<iii', graphics, 132, 2, 4, 32123)
            struct.pack_into('<f', graphics, 248, .35)
            gm[:] = graphics
            static = bytearray(508)
            name = 'test_car'.encode('utf-16-le')
            static[68:68+len(name)] = name
            struct.pack_into('<i', static, 412, 9000)
            sm[:] = static
            def fixture_mapping(api, name, cls):
                if name not in names:
                    raise OSError('Optional CSP bridge not running')
                return real_mapping(api, names[name], cls)
            with patch('ac_memory.Mapping', side_effect=fixture_mapping):
                reader = ACReader()
                try:
                    sample = reader.sample()
                    self.assertEqual(sample['status'], 'live')
                    self.assertEqual((sample['gear'], sample['speed'], sample['throttle'], sample['brake']), ('2', 123.5, 75, 25))
                    self.assertEqual(sample['car'], 'test_car')
                    self.assertEqual(sample['max_rpm'], 9000)
                    self.assertEqual(sample['tyre_temps'], [80, 85, 90, 95])
                    self.assertEqual(sample['g_lateral'], .8)
                    self.assertEqual(sample['g_longitudinal'], -.4)
                    self.assertEqual(sample['lap_ms'], 32123)
                    self.assertEqual(sample['position'], 4)
                    # The shared-memory position can remain at the starting grid.
                    data=bytearray(gm[:]);struct.pack_into('<i',data,Graphics.position.offset,12);gm[:]=data
                    with patch.object(reader.bridge,'sample',side_effect=[
                        {'csp_connected':True,'race_position':12,'is_race':True},
                        {'csp_connected':True,'race_position':3,'is_race':True},
                        {'csp_connected':True,'race_position':2,'is_race':True},
                        {'csp_connected':True,'race_position':0,'is_race':True}]):
                        self.assertEqual([reader.sample()['position'] for _ in range(4)],[12,3,2,None])

                    self.assertIsNone(sample['drs'])
                    gm[:12] = struct.pack('<iii', 2, 3, 0)
                    self.assertIn('paused', reader.sample()['message'])
                    gm[:12] = struct.pack('<iii', 3, 2, 0)
                    reader.changed -= 3
                    self.assertEqual(reader.sample()['status'], 'offline')
                    self.assertIsNone(reader.physics)
                    reader.retry_at = 0
                    self.assertEqual(reader.sample()['status'], 'live')
                finally:
                    reader.close()

    @unittest.skipUnless(os.name == 'nt', 'Windows named memory required')
    def test_missing_mapping_does_not_create(self):
        import ac_memory
        reader = ACReader()
        try:
            with self.assertRaises(OSError):
                ac_memory.Mapping(reader.api, 'Local\\ac_dashboard_missing_' + str(os.getpid()), Physics)
        finally:
            reader.close()


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_mock_http_and_websocket(self):
        async with TestClient(TestServer(create_app(mock=True))) as client:
            for path in ('/', '/app.js', '/style.css', '/manifest.webmanifest'):
                response = await client.get(path)
                self.assertEqual(response.status, 200)
                self.assertTrue(await response.text())
                self.assertEqual(response.headers.get('Cache-Control'), 'no-store')
            self.assertEqual((await client.get('/ac_memory.py')).status, 404)
            async with client.ws_connect('/ws') as ws:
                first = await ws.receive_json(timeout=2)
                await asyncio.sleep(.15)
                second = await ws.receive_json(timeout=2)
                self.assertEqual(first['status'], 'mock')
                self.assertNotEqual(first, second)

    async def test_offline_transport(self):
        with patch('server.ACReader') as cls:
            cls.return_value.sample.return_value = {'status': 'offline', 'message': 'Start AC and click Drive.'}
            async with TestClient(TestServer(create_app())) as client:
                async with client.ws_connect('/ws') as ws:
                    data = await ws.receive_json(timeout=2)
                    self.assertEqual(data['status'], 'offline')
                    self.assertNotIn('speed', data)


class DeltaTests(unittest.TestCase):
    def test_full_lap_then_interpolated_delta(self):
        d = LapDelta()
        self.assertIsNone(d.update(0,.5,5000,0))  # Cannot use half-observed lap.
        d.update(1,.001,10,10000)
        for i in range(1,100):
            d.update(1,i/100,i*100,10000)
        d.update(2,.001,10,10000)
        # Finish capture and compare at an equal distance, 0.5 seconds slower.
        self.assertEqual(d.best_ms,10000)
        self.assertAlmostEqual(d.update(2,.505,5550,10000), .5, places=2)
        d.update(0,.1,1000,0)  # A restart may preserve the same-car recorded best.
        self.assertIsNotNone(d.reference)

    def test_invalid_or_teleported_lap_not_used(self):
        d=LapDelta()
        d.update(0,.9,9000,0);d.update(1,.001,10,10000)
        d.update(1,.5,5000,10000,valid=False)
        d.update(1,.99,9900,10000);d.update(2,.001,10,10000)
        self.assertIsNone(d.reference)
        d.update(2,.8,8000,10000);d.update(2,.2,2000,10000)
        d.update(2,.99,9900,10000);d.update(3,.001,10,10000)
        self.assertIsNone(d.reference)


if __name__ == '__main__':
    unittest.main()
