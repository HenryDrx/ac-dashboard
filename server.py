"""One process, one port: dashboard HTTP + telemetry WebSocket."""
import argparse
import asyncio
import contextlib
import math
from pathlib import Path
import time
import secrets
import ipaddress
import socket

try:
    from aiohttp import web
except ImportError:
    raise SystemExit("Missing dependency. Run: py -m pip install -r requirements.txt")
from ac_memory import ACReader
from track_assets import TrackAssets

ROOT = Path(__file__).resolve().parent


def offer_latest(queue, sample):
    """Bound each client's backlog to its most recent telemetry sample."""
    if queue.full():queue.get_nowait()
    queue.put_nowait(sample)


def mock_sample():
    t = time.monotonic()
    speed = (math.sin(t / 5) + 1) * 100
    progress = (t % 92) / 92
    nearby=[]
    for i,(side,forward) in enumerate(((-3.4,7+math.sin(t/3)*9),(3.5,-6+math.cos(t/4)*8),(math.sin(t/5)*4,19+math.sin(t/4)*5)),1):
        nearby.append(dict(id=i,right_m=side,forward_m=forward,distance_m=round(math.hypot(side,forward),1),heading_right=0,heading_forward=1,width_m=1.9,length_m=4.5))
    return {"status": "mock", "message": "MOCK · simulated data", "radar":dict(available=True,range_m=30,cars=nearby,width_m=1.9,length_m=4.5), "speed": round(speed, 1),
            "rpm": int(1500 + speed * 32), "gear": str(min(6, 1 + int(speed / 35))),
            "throttle": round((math.sin(t) + 1) * 50),
            "brake": round(max(0, math.cos(t / 5)) * 60),
            "car": "ks_porsche_911_gt3_rs", "track": "ks_nordschleife", "max_rpm": 8800,
            "fuel": 32.4, "g_lateral": round(math.sin(t / 2) * 1.2, 2),
            "g_longitudinal": round(math.cos(t / 3) * .8, 2),
            "tyre_temps": [round(79 + i * 4 + math.sin(t / 6 + i) * 8, 1) for i in range(4)],
            "tc": 1, "abs": 1, "drs": None, "drs_available": None, "kers": None,
            "session": 0, "position": None, "lap_progress": progress,
            "lap": 3, "lap_ms": int(progress * 92000), "last_lap_ms": 93520,
            "best_lap_ms": 92000, "delta": round(math.sin(t / 7) * .45, 3),
            "delta_reference_ms": 92000, "flag": 0, "in_pit": False,
            "csp_connected": True, "steering_deg": round(math.sin(t/3)*120,1),
            "steering_lock": 450, "gear_count": 7, "tc_mode": int(t/8)%3,
            "tc_modes":2,"abs_modes":3,"abs_mode": 1, "rpm_limit": 8800,
            "tyre_surface": [[80+i*3+math.sin(t/2+i+j)*12 for j in range(3)] for i in range(4)],
            "tyre_optimum": [90,90,90,90], "tyre_wear_fraction": [.12,.15,.25,.2],
            "tyre_flatspot": [0,0,0,0], "tyre_slip_ratio": [0,0,0,0]}


def create_app(mock=False, ac_root=None):
    app = web.Application()
    clients = {}
    reader = None if mock else ACReader()
    latest = {"status": "offline", "message": "Waiting for telemetry…"}
    token = secrets.token_urlsafe(32)
    command_lock = asyncio.Lock()
    assets = TrackAssets(ac_root)
    mock_controls = [
        dict(id='tc',label='Traction control',type='step',value=2,min=0,max=2,step=1,unit='',group='assists'),
        dict(id='abs',label='ABS',type='step',value=1,min=0,max=3,step=1,unit='',group='assists'),
        dict(id='ffb',label='Force feedback · this car',type='slider',value=100,min=0,max=150,step=1,unit='%',group='assists'),
        dict(id='headlights',label='Headlights',type='toggle',value=False,group='visibility'),
        dict(id='drs',label='DRS',type='toggle',value=False,group='power'),
        dict(id='kers',label='KERS / ERS deploy',type='hold',value=False,group='power'),
        dict(id='setup:PRESSURE_LF',label='Front left pressure',type='step',value=26,min=15,max=40,step=.5,unit='psi',group='setup'),
    ]

    def control_state():
        if mock:
            return dict(csp_connected=True,car='ks_porsche_911_gt3_rs',controls=mock_controls,
                        setup_editable=True,mock=True,in_pit=False)
        state = reader.bridge.sample_v2()
        return state if isinstance(state,dict) else {}

    def check_host(request):
        hostname = request.url.host.lower()
        if hostname in ('localhost',socket.gethostname().lower(),socket.getfqdn().lower()):return
        try:
            if ipaddress.ip_address(hostname).is_private:return
        except ValueError:pass
        raise web.HTTPForbidden(text='Use the PC local address to access controls.')

    async def control_info(request):
        check_host(request)
        return web.json_response(dict(token=token,state=control_state()),headers={'Cache-Control':'no-store'})

    async def control_command(request):
        check_host(request)
        # Browser-only same-origin endpoint with a per-process capability token.
        # Cross-origin pages cannot read the token; no CORS permission is granted.
        if request.headers.get('Origin') != f'{request.scheme}://{request.host}':
            raise web.HTTPForbidden(text='Open the control page from this server.')
        if not secrets.compare_digest(request.headers.get('X-AC-Dash-Token',''),token):
            raise web.HTTPForbidden(text='Reload the dashboard to reconnect controls.')
        if request.content_length and request.content_length > 4096:
            raise web.HTTPRequestEntityTooLarge(max_size=4096,actual_size=request.content_length)
        try:
            body = await request.json()
            if not isinstance(body,dict):raise ValueError('Invalid command')
            control_id,value = body.get('control'),body.get('value')
            if not isinstance(control_id,str) or len(control_id)>160:raise ValueError('Invalid control ID')
            async with command_lock:
                state = control_state()
                if not state.get('csp_connected'):
                    return web.json_response(dict(ok=False,message='AC Dash Bridge is not connected. Install it and restart the driving session.'),status=503)
                if body.get('car') != state.get('car'):
                    raise ValueError('The car changed. Refresh controls before sending another command.')
                spec = next((x for x in state.get('controls',[]) if x.get('id')==control_id),None)
                if not spec:raise ValueError('This control is not currently available for this car/session.')
                kind = spec['type']
                if kind in ('step','slider'):
                    if type(value) not in (int,float) or not math.isfinite(value) or not spec['min']<=value<=spec['max']:
                        raise ValueError('Value is outside the current car limits.')
                elif kind in ('toggle','hold'):
                    if type(value) is not bool:raise ValueError('Expected an on/off value.')
                elif kind=='select':
                    if value not in spec.get('options',[]):raise ValueError('Invalid option.')
                elif kind=='action':
                    if value is not True:raise ValueError('Invalid action request.')
                else:raise ValueError('Unsupported control type.')
                if mock:
                    if kind!='action':spec['value']=value
                    return web.json_response(dict(ok=True,message='Simulated change applied — mock mode.',state=control_state()))
                command_id = reader.bridge.send_command(state,control_id,value)
                deadline = time.monotonic()+2
                while time.monotonic()<deadline:
                    await asyncio.sleep(.04)
                    fresh = control_state()
                    ack = fresh.get('ack',{})
                    if ack.get('id')==command_id:
                        # One further publish gives the game time to refresh readback.
                        await asyncio.sleep(.06)
                        return web.json_response(dict(ok=bool(ack.get('ok')),message=ack.get('message','AC replied'),state=control_state()))
                return web.json_response(dict(ok=False,message='No acknowledgement from AC. The change is unconfirmed; check the bridge window.'),status=504)
        except (ValueError,TypeError,KeyError) as error:
            return web.json_response(dict(ok=False,message=str(error)),status=400)

    async def index(request):
        return web.FileResponse(ROOT / "web" / "index.html", headers={"Cache-Control": "no-store"})

    async def asset(request):
        return web.FileResponse(ROOT / "web" / request.match_info["name"], headers={"Cache-Control": "no-store"})

    async def websocket(request):
        ws = web.WebSocketResponse(heartbeat=10)
        await ws.prepare(request)
        queue=asyncio.Queue(maxsize=1)
        clients[ws]=queue
        offer_latest(queue,latest)
        async def write_latest():
            try:
                while True:
                    sample=await queue.get()
                    await asyncio.wait_for(ws.send_json(sample),timeout=1)
            except (ConnectionError,RuntimeError,asyncio.TimeoutError):
                await ws.close()
        writer=asyncio.create_task(write_latest())
        try:
            async for _ in ws:
                pass
        finally:
            clients.pop(ws,None)
            writer.cancel()
            with contextlib.suppress(asyncio.CancelledError):await writer
        return ws

    async def publish():
        nonlocal latest
        previous = None
        next_publish=time.monotonic()
        while True:
            latest = mock_sample() if mock else reader.sample()
            latest['controller'] = control_state()
            if mock:
                latest['tc_mode']=mock_controls[0]['value']
                latest['abs_mode']=mock_controls[1]['value']
            state = latest["message"]
            if state != previous:
                print(state, flush=True)
                previous = state
            for queue in tuple(clients.values()):offer_latest(queue,latest)
            next_publish+=.02
            if time.monotonic()-next_publish>.1:next_publish=time.monotonic()
            await asyncio.sleep(max(0,next_publish-time.monotonic()))  # Target 50 Hz without cumulative timer drift.

    async def lifecycle(app):
        task = asyncio.create_task(publish())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await asyncio.gather(*(ws.close() for ws in tuple(clients)))
        if reader:
            reader.close()
            reader.bridge.dispose()

    app.cleanup_ctx.append(lifecycle)
    app.router.add_get("/", index)
    app.router.add_get("/{name:app.js|style.css|manifest.webmanifest}", asset)
    app.router.add_get("/ws", websocket)
    app.router.add_get('/api/control-info',control_info)
    app.router.add_post('/api/control',control_command)
    async def lap_history(request):
        data=reader.delta.summary() if reader else dict(state='Mock mode',reference_ms=92000,laps=[])
        return web.json_response(data,headers={'Cache-Control':'no-store'})
    app.router.add_get('/api/laps',lap_history)
    async def map_info(request):
        track=request.query.get('track',latest.get('track') or '')
        layout=request.query.get('layout',latest.get('track_layout') or '')
        try:
            return web.json_response(assets.map_info(track,layout),headers={'Cache-Control':'no-store'})
        except (ValueError,OSError,KeyError) as error:
            return web.json_response(dict(available=False,message=str(error)),headers={'Cache-Control':'no-store'})
    async def map_image(request):
        try:
            track=request.query.get('track','');layout=request.query.get('layout','')
            assets.map_info(track,layout)
            return web.FileResponse(assets.track_folder(track,layout)/'map.png',headers={'Cache-Control':'no-store'})
        except (ValueError,OSError,KeyError):raise web.HTTPNotFound()
    async def car_badge(request):
        try:path=assets.badge(request.query.get('car',latest.get('car') or ''))
        except ValueError:path=None
        if not path:raise web.HTTPNotFound()
        return web.FileResponse(path)
    app.router.add_get('/api/map-info',map_info)
    app.router.add_get('/api/map-image',map_image)
    app.router.add_get('/api/car-badge',car_badge)
    app.router.add_static('/fonts/',ROOT/'web'/'fonts')
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mock", action="store_true", help="Simulate readings; no game needed")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument('--ac-root',help='AC installation folder, if automatic detection fails')
    args = parser.parse_args()
    print(f"PC: http://localhost:{args.port} | Phone: http://<PC IPv4 address>:{args.port}")
    print("Keep this window open. Ctrl+C stops the server.")
    try:
        web.run_app(create_app(args.mock,args.ac_root), host="0.0.0.0", port=args.port)
    except OSError as error:
        raise SystemExit(f"Cannot start server: {error}. Stop the old server with Ctrl+C or try --port 8002.")
