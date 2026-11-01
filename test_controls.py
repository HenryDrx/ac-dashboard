import asyncio
import ctypes as C
import json
import mmap
import os
import struct
import unittest
from aiohttp.test_utils import TestClient, TestServer
from ac_memory import ACReader, Mapping
from csp_bridge import CSPBridge, JSONState
from car_metadata import resolve_gears
from server import create_app, offer_latest


class GearTests(unittest.TestCase):
    def test_live_counts_only(self):
        for count in (1,6,7,7.0,8,12,20):
            self.assertEqual(resolve_gears(count),(count,'CSP car physics'))
        for missing in (None,0,-1,21,True,'7',7.5,float('nan')):
            self.assertEqual(resolve_gears(missing),(None,'unavailable'))


class CommandHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client=TestClient(TestServer(create_app(mock=True)))
        await self.client.start_server()
        info=await (await self.client.get('/api/control-info')).json()
        self.car=info['state']['car']
        self.headers={'Origin':str(self.client.make_url('/')).rstrip('/'),
                      'X-AC-Dash-Token':info['token']}

    async def asyncTearDown(self):
        await self.client.close()

    async def send(self,control,value,**kwargs):
        return await self.client.post('/api/control',json={'control':control,'value':value,'car':kwargs.get('car',self.car)},headers=kwargs.get('headers',self.headers))

    async def test_change_and_readback(self):
        response=await self.send('tc',1)
        self.assertEqual(response.status,200)
        reply=await response.json();self.assertTrue(reply['ok'])
        self.assertEqual(next(c for c in reply['state']['controls'] if c['id']=='tc')['value'],1)
        response=await self.send('ffb',75)
        self.assertTrue((await response.json())['ok'])

    async def test_mock_pit_and_cut_reach_websocket(self):
        ws=await self.client.ws_connect('/ws')
        try:
            await self.send('demo-pits',True)
            for _ in range(10):
                sample=await ws.receive_json(timeout=1)
                if sample.get('in_pit'):break
            self.assertTrue(sample['in_pit_lane'])
            await self.send('demo-pits',True)
            await self.send('demo-cut',True)
            for _ in range(10):
                sample=await ws.receive_json(timeout=1)
                if sample.get('track_limits'):break
            self.assertFalse(sample['in_pit'])
            self.assertTrue(sample['current_lap_invalid'])
        finally:await ws.close()

    async def test_reject_invalid_and_changed_car(self):
        for control,value in [('tc',99),('tc',True),('headlights','yes'),('not-a-command',1)]:
            self.assertEqual((await self.send(control,value)).status,400)
        self.assertEqual((await self.send('tc',1,car='different')).status,400)

    async def test_reject_cross_origin_or_missing_token(self):
        self.assertEqual((await self.send('tc',1,headers={})).status,403)
        bad={**self.headers,'Origin':'https://unrelated.example'}
        self.assertEqual((await self.send('tc',1,headers=bad)).status,403)


@unittest.skipUnless(os.name=='nt','Windows mapping')
class JSONBridgeTests(unittest.TestCase):
    def test_json_transport_and_command_encoding(self):
        name='Local\\ACDash_state2_test_'+str(os.getpid())
        payload={'protocol':2,'active':True,'bridge_id':'session-test','car':'test_car','gear_count':7,'controls':[]}
        raw=json.dumps(payload).encode()
        with mmap.mmap(-1,C.sizeof(JSONState),tagname=name) as state:
            state[:8]=struct.pack('<ii',2,len(raw));state[8:8+len(raw)]=raw
            reader=ACReader()
            bridge=CSPBridge(reader.api,lambda api,n,cls:Mapping(api,name,cls))
            try:
                sample=bridge.sample_v2('test_car')
                self.assertEqual(sample['gear_count'],7)
                self.assertEqual(bridge.sample_v2('wrong_car'),{})
                # Keep command test isolated from the actual game mapping.
                bridge.command_mapping=mmap.mmap(-1,8200,tagname='Local\\ACDash_command_test_'+str(os.getpid()))
                command_id=bridge.send_command(sample,'tc',2)
                seq,length=struct.unpack('<ii',bridge.command_mapping[:8])
                command=json.loads(bridge.command_mapping[8:8+length])
                self.assertEqual(seq%2,0)
                self.assertEqual(command['id'],command_id)
                self.assertEqual((command['control'],command['value'],command['bridge_id']),('tc',2,'session-test'))
            finally:bridge.dispose();reader.close()


class LatestSampleTests(unittest.TestCase):
    def test_slow_client_keeps_latest_without_blocking_other_client(self):
        slow=asyncio.Queue(maxsize=1);fast=asyncio.Queue(maxsize=1)
        for i in range(10):
            offer_latest(slow,{'frame':i})
            offer_latest(fast,{'frame':i})
            self.assertEqual(fast.get_nowait()['frame'],i)
        self.assertEqual(slow.qsize(),1)
        self.assertEqual(slow.get_nowait()['frame'],9)
