import json
from pathlib import Path
import tempfile
import unittest
from lap_delta import LapDelta


class RecordingTests(unittest.TestCase):
    def test_last_lap_validity_rejects_late_cut(self):
        d=LapDelta();d.update(0,.001,10,0)
        d.update(0,.99,9900,0)
        d.update(1,.001,10,10000,last_valid=False)
        self.assertIsNone(d.reference)
        self.assertEqual(d.history[-1]['status'],'invalid')

    def test_reset_cannot_create_a_reference(self):
        d=LapDelta();d.update(0,.001,10,0,reset_counter=0)
        d.update(0,.99,9900,0,reset_counter=0)
        d.update(1,.001,10,10000,reset_counter=1)
        self.assertIsNone(d.reference)

    def test_invalid_lap_stays_invalid_after_rejoining(self):
        d=LapDelta();self.full_first_lap(d)
        d.update(1,.4,4000,10000,False)
        self.assertIsNone(d.update(1,.5,5100,10000,True))

    def full_first_lap(self,d):
        d.update(0,0,0,0,valid=False) # Waiting in pits before driving.
        d.update(0,.001,10,0,valid=True)
        for i in range(1,100):d.update(0,i/100,i*100,0)
        d.update(1,.001,10,10000)

    def test_delta_works_on_second_lap_and_persists(self):
        with tempfile.TemporaryDirectory() as root:
            d=LapDelta();d.configure(('car','track',0),root)
            self.full_first_lap(d)
            self.assertEqual(d.best_ms,10000)
            self.assertAlmostEqual(d.update(1,.505,5550,10000),.5,places=2)
            files=list(Path(root).glob('*.laps.jsonl'));self.assertEqual(len(files),1)
            record=json.loads(files[0].read_text().splitlines()[0])
            self.assertTrue(record['complete']);self.assertTrue(record['valid'])
            self.assertGreater(len(record['points']),90)
            d.interrupt();self.assertEqual(d.best_ms,10000)
            again=LapDelta();again.configure(('car','track',0),root)
            self.assertEqual(again.best_ms,10000)
            self.assertAlmostEqual(again.update(4,.5,5400,10000),.4,places=2)

    def test_mid_lap_capture_logged_but_not_reference(self):
        d=LapDelta();d.update(0,.5,5000,0);d.update(0,.99,9900,0)
        d.update(1,.001,10,10000)
        self.assertIsNone(d.reference)
        self.assertEqual(d.history[0]['status'],'partial')

    def test_invalid_lap_logged_and_not_promoted(self):
        d=LapDelta();d.update(0,.001,10,0)
        d.update(0,.5,5000,0,False);d.update(0,.99,9900,0)
        d.update(1,.001,10,10000)
        self.assertIsNone(d.reference)
        self.assertEqual(d.history[0]['status'],'invalid')
