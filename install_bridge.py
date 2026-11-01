"""Install only AC Dash's bundled Lua app; no game files are replaced."""
import argparse
from pathlib import Path
import shutil
from datetime import datetime
from track_assets import TrackAssets


def install(root=None):
    if root and not (Path(root)/'content'/'tracks').is_dir():
        raise SystemExit('That AC folder has no content/tracks directory. Use the folder containing acs.exe.')
    game=TrackAssets(root).root
    if game is None:
        raise SystemExit('AC folder not found. Run: py install_bridge.py --ac-root "<your Assetto Corsa folder>"')
    if not (game/'extension').is_dir():
        raise SystemExit('CSP extension folder not found. Install CSP through Content Manager first.')
    source=Path(__file__).resolve().parent/'csp-app'/'ACDashBridge'
    target=game/'apps'/'lua'/'ACDashBridge'
    if target.exists():
        backup=Path(__file__).resolve().parent/'bridge-backups'/datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        shutil.copytree(target,backup)
        print(f'Previous bridge backed up to {backup}')
    target.mkdir(parents=True,exist_ok=True)
    for name in ('ACDashBridge.lua','bridge_v2.lua','manifest.ini'):
        shutil.copy2(source/name,target/name)
    print(f'Installed AC Dash Bridge 2.4 to {target}')
    print('Restart the AC driving session. Enable AC Dash Bridge in the Lua-app list if it is not running.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ac-root',help='Original Assetto Corsa installation folder')
    try:install(parser.parse_args().ac_root)
    except PermissionError:raise SystemExit('Windows blocked the copy. Copy csp-app/ACDashBridge into AC/apps/lua manually, approving the Windows prompt.')
