# Camera and car-specific cockpit UI exploration

Inspected the installed CSP Lua-app SDK (CSP 0.2.11), declarations in `ac_apps/lib.lua`. Public upstream: https://github.com/ac-custom-shaders-patch/acc-lua-sdk . These are documented interfaces, not proof of end-to-end phone performance.

## Finger-controlled AC camera

Feasible with the existing browser → validated command → CSP bridge route. `ac.setCameraDirection(look, up)` orients the free camera; `setCameraPosition` moves it. `ac.grabCamera(reason)` exposes a camera holder that must be disposed when finished. `getOnboardCameraParams` / `setOnboardCameraParams` and `ac.SeatParams` also expose pitch/yaw for car-specific onboard positioning, with optional saving.

A future explicit Camera pad could send bounded yaw/pitch at a controlled rate, with drag capture, reset, release/disconnect handling and an obvious exit back to the game camera. It should avoid permanently saving seat changes during a look-around gesture. Free-camera availability and online restrictions need live checks. The current command route waits for acknowledgements; a smooth high-rate camera controller should use a separate latest-value lease rather than queueing every finger sample. No camera control was added in V7; map dragging pans only the circuit view.

## Reusing the actual car's dashboard

Not a universal import. Many AC gauges are animated 3D meshes/textures; some cars use CSP dynamic display scripts. Their assets are not HTML widgets. The SDK documents dynamic textures such as `carN::dynamic::X`, canvases and rendered image access, but that does not identify a standard named RPM/dashboard texture for every car or provide a ready browser stream.

Two possible projects:

1. Build selectable browser themes inspired by a particular car, driven by the telemetry we already have. This is the reliable, responsive approach; visual work is needed per theme, with a generic fallback. It does not require a hardcoded gear catalogue.
2. Investigate a specific car's display texture, capture/crop or render it on Windows, and stream it. This adds GPU capture, image/video encoding, bandwidth and latency. Some cars have no single display texture to capture; protected assets and redistribution permissions also matter. It is not a simple setting to turn on for all cars.

No extraction or game-asset redistribution was added. Car badges and circuit maps are still read locally.

## New telemetry references

CSP documents `isInPitlane` (pits area), `isInPit` (parked in pit place), `isLapValid`, `isLastLapValid`, `resetCounter`, `performanceMeter` (seconds vs best), and `performanceMeterSpeedDifferenceMs` (native performance app bar). V7's requested magnitude bar uses delta seconds instead of that speed-difference value. `damage` has four useful zones, in maximum-collision-speed units; `engineLifeLeft` is 1000 new / 0 broken, `gearboxDamage` is 0 new / 1 non-functional. Suspension values have no documented universal percentage scale, so they are shown only as severity colouring.
