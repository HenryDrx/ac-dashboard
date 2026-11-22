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

    def test_previous_lap_delta_uses_last_lap_instead_of_best(self):
        recorder = LapDelta()
        self.full_first_lap(recorder)
        self.assertEqual(recorder.previous_delta(.5, 5000), 0)
        for index in range(1, 100):
            recorder.update(1, index / 100, index * 120, 10000)
        recorder.update(2, .001, 10, 12000)
        self.assertEqual(recorder.best_ms, 10000)
        self.assertEqual(recorder.previous_delta(.5, 6000), 0)
        self.assertEqual(recorder.previous_delta(.5, 5500), -.5)
        recorder.update(2, .99, 9900, 12000)
        recorder.update(3, .001, 10, 10000, last_valid=False)
        self.assertIsNone(recorder.previous_delta(.5, 5000))

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
            self.assertAlmostEqual(again.previous_delta(.5,5400),.4,places=2)
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

    def test_ahead_overall_but_losing_time_now(self):
        d=LapDelta();self.full_first_lap(d)
        for i in range(9):
            progress, elapsed = .2 + i * .0025, 1000 + i * 50
            pace=d.previous_pace(progress,elapsed)
        self.assertLess(d.previous_delta(progress,elapsed),0)
        self.assertAlmostEqual(pace,.5,places=3)

    def test_behind_overall_but_gaining_time_now(self):
        d=LapDelta();self.full_first_lap(d)
        for i in range(9):
            progress, elapsed = .2 + i * .0075, 3000 + i * 50
            pace=d.previous_pace(progress,elapsed)
        self.assertGreater(d.previous_delta(progress,elapsed),0)
        self.assertAlmostEqual(pace,-.5,places=3)

    def test_constant_gap_has_neutral_pace(self):
        d=LapDelta();self.full_first_lap(d)
        for i in range(9):
            pace=d.previous_pace(.2+i*.005,1000+i*50)
        self.assertAlmostEqual(pace,0,places=4)
        self.assertEqual(d.previous_delta(.24,1400),-1)

    def test_native_gap_pace_without_recorded_lap(self):
        d=LapDelta()
        for i in range(9):
            pace=d.previous_pace(.2+i*.005,1000+i*50,-1+i*.025)
        self.assertAlmostEqual(pace,.5,places=3)
        self.assertIsNone(d.previous_delta(.24,1400))
        self.assertIsNone(d.previous_pace(.245,1450))

    def test_pace_resets_and_waits_for_fresh_samples(self):
        d=LapDelta()
        self.assertIsNone(d.previous_pace(.2,1000))
        self.full_first_lap(d)
        self.assertIsNone(d.previous_pace(.2,1000))
        for i in range(1,9):pace=d.previous_pace(.2+i*.0025,1000+i*50)
        self.assertEqual(d.previous_pace(.22,1400),pace) # Duplicate packet.
        self.assertIsNone(d.previous_pace(.3,2400)) # Transport gap / jump.
        d.invalid=True
        self.assertIsNone(d.previous_pace(.31,2450))
        d.invalid=False;d.interrupt()
        self.assertIsNone(d.previous_pace(.001,10)) # Lap boundary/reset.
