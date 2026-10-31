import json
from pathlib import Path
import struct
import tempfile
import unittest
from track_assets import TrackAssets


class TrackAssetTests(unittest.TestCase):
    def test_layout_offsets_dimensions_and_badge(self):
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'content/tracks/test/short';(folder/'data').mkdir(parents=True)
            (folder/'map.png').write_bytes(b'\x89PNG\r\n\x1a\n'+b'\x00'*8+struct.pack('>II',1000,500))
            (folder/'data/map.ini').write_text('[PARAMETERS]\nSCALE_FACTOR=2\nX_OFFSET=100\nZ_OFFSET=-50\n')
            assets=TrackAssets(root);info=assets.map_info('test','short')
            self.assertEqual((info['width'],info['height'],info['scale']),(1000,500,2))
            self.assertEqual((info['offset_x'],info['offset_z']),(100,-50))
            with self.assertRaises(ValueError):assets.map_info('test','wrong-layout')
            with self.assertRaises(ValueError):assets.map_info('test','')
            self.assertIsNone(assets.badge('mod-without-badge'))
            badge=Path(root)/'content/cars/a_mod/ui/badge.png';badge.parent.mkdir(parents=True);badge.write_bytes(b'badge')
            self.assertEqual(assets.badge('a_mod'),badge)
            for invalid in ('../test','..','test/short','C:\\private'):
                with self.assertRaises(ValueError):assets.map_info(invalid)
                with self.assertRaises(ValueError):assets.badge(invalid)

    def test_bad_scale_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'content/tracks/test';(folder/'data').mkdir(parents=True)
            (folder/'map.png').write_bytes(b'x')
            (folder/'data/map.ini').write_text('[PARAMETERS]\nSCALE_FACTOR=0\nX_OFFSET=0\nZ_OFFSET=0\n')
            with self.assertRaises(ValueError):TrackAssets(root).map_info('test')
