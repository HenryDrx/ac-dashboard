# Dashboard control inventory — version 0.6.2

The list is capability-driven: the bridge reads the current car and session. These are reported adjustment capabilities, not a claim that every entry has been physically exercised. No game settings were changed to collect this list.

## Already wired in this app

| Group | Controls | Availability |
|---|---|---|
| Driving aids | TC mode, ABS mode, front brake bias, engine-braking setting | Only the modes/adjustments exposed by the car |
| Steering feedback | Per-car FFB gain | Current UI permits 0–150% |
| Power / hybrid | DRS, hold-to-deploy KERS/ERS, MGU-K delivery, MGU-K recovery, MGU-H charging mode, adjustable turbo wastegate/boost | Equipment and cockpit-adjustment support required |
| Visibility | Headlights, high beams, flash headlights, indicators/hazards, wiper mode | Extra modes depend on car equipment |
| Pit plan | Three quick-pit presets and all editable pit spinners: fuel, tyre compound, four pressures, repair selections, wing entries when supplied | Actual entries and limits come from CSP |
| Car setup | Every editable setup spinner supplied by the current car | Setup must be editable; fixed setups/session rules can restrict changes |
| Session | Pause/resume, return to pits, go to track; offline restart and next session | AC/session restrictions still apply |

Setup possibilities include fuel/compound/pressures, camber/toe, brake power/bias, wings, spring rates, anti-roll bars, ride height, dampers, differential, gearing and other car-defined entries. This is not a promise that a particular road car exposes race-car adjustments. Setup loading/saving is not wired yet.

## Documented additions we can wire next

| Addition | SDK support and limits |
|---|---|
| Setup files | Save current setup, list/refresh, load and reset to defaults. Loading/reset require editable, non-fixed setup. `saveCurrentSetup`, `loadSetup`, `resetSetupToDefault`. |
| Cockpit view | FOV and reset; seat/view position/orientation, per-car saving. `setFirstPersonCameraFOV`, `get/setOnboardCameraParams`. |
| Mirrors | Adjust supported Real Mirrors; requires Real Mirrors enabled for the car. `getRealMirrorCount`, `get/setRealMirrorParams`. |
| Audio | Channel volume for supported engine/opponents/tyres/wind/etc. `setAudioVolume`. |
| Camera / HUD | Switch supported camera modes, open/close app windows, choose one of four HUD desktops. `setCurrentCamera`, `setWindowOpen`, `setCurrentDesktop`. |
| More car switches | Daytime running lights, neutral command, H-shifter mode; extra mod switches are car-specific and were previously deferred. `setDaytimeLights`, `switchToNeutralGear`, `setHShifterActive`, `setExtraSwitch`. |
| VR | Recenter the VR pose when using VR. `resetVRPose`. |

Replay, time/weather controls and mod-specific extra switches were previously excluded from the requested screen. Replay APIs exist; time/weather depend on offline/server/controller restrictions and need a separate supported design. Choosing cars/tracks and starting a fresh AC process needs the Windows companion/launcher path rather than the running in-game bridge alone.

## Suggested next additions

1. Setup save/load/reset: makes experiments reusable.
2. FOV/seat and mirrors: easy to confirm visually.
3. Audio levels: easy to confirm without leaving the session.

The installed CSP Lua SDK was inspected for these APIs. Public upstream: https://github.com/ac-custom-shaders-patch/acc-lua-sdk . This inventory describes available interfaces; unwired additions still need implementation and live validation.
