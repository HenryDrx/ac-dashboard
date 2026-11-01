# V7 checks

24 Python tests passed; Node frontend/tyre tests and synthetic Fengari Lua boot/control/telemetry tests passed.
New checks cover last-lap validity, reset discontinuities, invalid-lap latching, CSP native delta fallback, pit-lane flags surviving pit-box false, mock pit/cut WebSocket data, race position + progress, one-finger map pan and two-finger pinch.
Browser checked at 844x390 and 390x844. No horizontal overflow; dashboard timing finishes before RPM strip at 844x390. Buttons for map zoom/Fit, mock pit entry (auto In pits/pit-plan) and exit (auto dashboard) and track-limits overlay exercised. Current lap colour red verified in DOM. Screenshots are simulated, not a live driving claim.
Live AC was not running during development. Real pit entry, server opponent updates/damage and lap delta still require an in-game smoke test. Camera touch control and cockpit-theme extraction are research only.
