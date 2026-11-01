"""Record observed laps; compare elapsed time at equal track distance."""
import bisect
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re


class LapDelta:
    def __init__(self):
        self.root = self.key = None
        self.history = []
        self.storage_error = None
        self.reset()

    def reset(self):
        self.reference = None
        self.best_ms = None
        self.reset_counter = None
        self.interrupt()

    def interrupt(self):
        """Clear a discontinuous partial capture, preserve completed reference."""
        self.last = None
        self.points = []
        self.collecting = False
        self.started = False
        self.invalid = False
        self.state = 'Waiting for lap start'

    def configure(self, context, root):
        key = '--'.join(re.sub(r'[^a-zA-Z0-9_-]', '_', str(x))[:80] for x in context)
        if key == self.key:return
        self.key, self.root = key, Path(root)
        self.history = []
        self.reset()
        try:
            best = json.loads((self.root / f'{key}.best.json').read_text(encoding='utf-8'))
            points = best['points']
            if (best['lap_ms'] > 0 and len(points) >= 2 and points[0][0] == 0 and points[-1][0] == 1
                    and all(math.isfinite(float(v)) for p in points for v in p)
                    and all(points[i][0] < points[i+1][0] and points[i][1] <= points[i+1][1] for i in range(len(points)-1))):
                self.reference = [tuple(p) for p in points]
                self.best_ms = best['lap_ms']
        except (OSError, ValueError, KeyError, TypeError):pass
        try:
            history_path=self.root / f'{key}.laps.jsonl'
            if history_path.exists():self.history=[json.loads(line) for line in history_path.read_text(encoding='utf-8').splitlines()[-100:] if line.strip()]
        except (OSError,ValueError):pass

    def finish(self, completed, duration):
        if not self.points:return
        complete = self.collecting and self.points[-1][0] >= .97 and duration > 0
        eligible = complete and not self.invalid
        points = list(self.points)
        if complete and points[-1][0] < 1:points.append((1., max(duration,points[-1][1])))
        record = dict(lap=completed+1,lap_ms=duration,complete=complete,valid=eligible,
                      status='complete' if eligible else 'invalid' if complete else 'partial',
                      samples=len(points),recorded_at=datetime.now(timezone.utc).isoformat(),points=points)
        self.history.append(record);self.history=self.history[-100:]
        new_best=eligible and (self.best_ms is None or duration < self.best_ms)
        if new_best:self.reference,self.best_ms=points,duration
        if self.root and self.key:
            try:
                self.root.mkdir(parents=True,exist_ok=True)
                with (self.root / f'{self.key}.laps.jsonl').open('a',encoding='utf-8') as out:
                    out.write(json.dumps(record,separators=(',',':'))+'\n')
                if new_best:
                    target=self.root / f'{self.key}.best.json';temp=target.with_suffix('.tmp')
                    temp.write_text(json.dumps(record,separators=(',',':')),encoding='utf-8');temp.replace(target)
                self.storage_error=None
            except OSError as error:self.storage_error=str(error)

    def update(self, completed, progress, current_ms, last_ms, valid=True, last_valid=None, reset_counter=None):
        if reset_counter is not None:
            if self.reset_counter is not None and reset_counter != self.reset_counter:
                self.interrupt()
            self.reset_counter = reset_counter
        if not math.isfinite(progress) or not 0 <= progress <= 1 or current_ms < 0:
            self.interrupt();return None
        previous=self.last
        crossed=previous and (completed==previous[0]+1 or (progress<.1 and previous[1]>.9 and current_ms<previous[2]))
        if crossed:
            if last_valid is False:self.invalid=True
            self.finish(previous[0],last_ms if last_ms>0 else previous[2]);self.interrupt()
        elif previous and (completed<previous[0] or completed>previous[0]+1 or progress<previous[1]-.02 or current_ms<previous[2]-100):
            self.invalid=True # A reset/teleport is not a completed valid lap.
            self.finish(previous[0],previous[2]);self.interrupt()
        if not self.started and valid and progress<=.03 and current_ms<=5000:
            self.started=True;self.collecting=True;self.points=[(0.,0)]
        elif not self.started and progress>.03:
            self.started=True;self.collecting=False
        if self.started and not valid:self.invalid=True
        if not self.points or progress>self.points[-1][0]+.0002:self.points.append((progress,current_ms))
        self.last=(completed,progress,current_ms)
        self.state=('Lap invalid / out lap' if self.invalid else 'Recording first full lap' if self.collecting and self.reference is None else 'Recording lap' if self.collecting else 'Partial lap · next lap will record')
        if self.storage_error:self.state='Lap storage error · check folder access'
        if self.invalid or not valid or not self.reference:return None
        i=bisect.bisect_right(self.reference,(progress,float('inf')))
        if i==0:return None
        if i>=len(self.reference):return round((current_ms-self.best_ms)/1000,3)
        a,b=self.reference[i-1],self.reference[i]
        estimated=a[1]+(b[1]-a[1])*(progress-a[0])/(b[0]-a[0])
        return round((current_ms-estimated)/1000,3)

    def summary(self):
        return dict(state=self.state,reference_ms=self.best_ms,storage_error=self.storage_error,
                    laps=[{k:v for k,v in row.items() if k!='points'} for row in self.history])
