"""Read AC's installed map and badge assets; never guess a track layout."""
import configparser
import math
import os
from pathlib import Path
import re
import struct
from urllib.parse import urlencode


class TrackAssets:
    def __init__(self, root=None):
        candidates=[root,os.environ.get('AC_ROOT'),r'D:\SteamLibrary\steamapps\common\assettocorsa',r'C:\Program Files (x86)\Steam\steamapps\common\assettocorsa']
        self.root=next((Path(p) for p in candidates if p and (Path(p)/'content'/'tracks').is_dir()),None)

    @staticmethod
    def identifier(value,empty=False):
        if value=='' and empty:return value
        if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}',value):
            raise ValueError('Invalid content identifier')
        return value

    def track_folder(self,track,layout=''):
        track=self.identifier(track);layout=self.identifier(layout,True)
        if self.root is None:raise ValueError('AC folder not found. Start Python with --ac-root pointing to your AC installation.')
        folder=(self.root/'content'/'tracks'/track)
        if layout:folder=folder/layout
        base=(self.root/'content'/'tracks').resolve()
        resolved=folder.resolve()
        if base not in resolved.parents:raise ValueError('Track path is outside AC content')
        return resolved

    def map_info(self,track,layout=''):
        folder=self.track_folder(track,layout)
        image=folder/'map.png';ini=folder/'data'/'map.ini'
        if not image.is_file() or not ini.is_file():
            raise ValueError('This track layout has no readable map.png and data/map.ini. No other layout is substituted.')
        parser=configparser.ConfigParser(interpolation=None,strict=False)
        parser.read(ini,encoding='utf-8-sig')
        config=parser['PARAMETERS']
        values={key:float(config[key]) for key in ('SCALE_FACTOR','X_OFFSET','Z_OFFSET')}
        if not all(math.isfinite(v) for v in values.values()) or values['SCALE_FACTOR']<=0:
            raise ValueError('Invalid map scale or offsets')
        with image.open('rb') as stream:header=stream.read(24)
        if len(header)!=24 or header[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError('Invalid track PNG')
        width,height=struct.unpack('>II',header[16:24])
        if not 1<=width<=32768 or not 1<=height<=32768:raise ValueError('Invalid map dimensions')
        return dict(available=True,track=track,layout=layout,width=width,height=height,
                    scale=values['SCALE_FACTOR'],offset_x=values['X_OFFSET'],offset_z=values['Z_OFFSET'],
                    image='/api/map-image?'+urlencode(dict(track=track,layout=layout)))

    def badge(self,car):
        car=self.identifier(car)
        if self.root is None:return None
        base=(self.root/'content'/'cars').resolve()
        path=(base/car/'ui'/'badge.png').resolve()
        if base not in path.parents:raise ValueError('Badge is outside AC content')
        return path if path.is_file() else None
