# Interface references

This prototype targets original Assetto Corsa, not ACC or EVO.

- [AC shared-memory layout](https://github.com/mdjarv/assettocorsasharedmemory): Physics.cs and Graphics.cs provide a checked sequential Pack=4 layout; the reader uses explicit UTF-16 fields and opens existing mappings read-only.
- [Microsoft OpenFileMappingW](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-openfilemappingw) and [MapViewOfFile](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile): existing mapping/read access. The app does not create fake AC telemetry mappings.
- [CSP Lua SDK](https://github.com/ac-custom-shaders-patch/acc-lua-sdk): installed SDK declarations were checked for StateCar/StateWheel, current racePosition, forward gearCount, position/look/side, setup and pit spinners, command APIs, and this app's own memory-mapped channels. CSP's SessionType enum differs from the original shared-memory enum; the bridge exports an explicit is_race flag.
- [Comfy Map author source](https://github.com/Tuttertep/comfy_map): corroborates the native map coordinate convention, `(world X/Z + offsets) / SCALE_FACTOR`, fitted to the actual map PNG dimensions. This prototype renders its own map UI; it does not bundle that app or its maps.
- Original AC's installed `system/cfg/tyres_app.ini` supplies a blue/cyan/green/orange/red palette. Compound PERFORMANCE_CURVE data is read through CSP when available. The prototype's 2% thermal-grip-loss colour sensitivity is a UI policy, not a verified internal Kunos threshold.
- [Rajdhani / Google Fonts](https://github.com/google/fonts/tree/main/ofl/rajdhani): locally served font files, with the SIL Open Font License included under `web/fonts/OFL.txt`.

## Important boundaries

Game maps/badges stay in the user's AC installation and are served locally. They are not redistributed in this repository. Missing live data is unavailable; fabricated opponents and readings are limited to labelled mock mode.

Race ranking prefers CSP's current computed racePosition over the original shared-memory position, which was observed remaining at the starting position during development. Regression fixtures hold that older reading at P12 while CSP moves to P3/P2.

Radar uses relative vehicle positions and facing vectors. Its distances are position-to-position measurements rather than bumper clearance. Its distance/height thresholds are prototype display policies rather than official collision-detection logic.

Lua startup/control/radar tests use a synthetic SDK environment. Live session rules and car support can still restrict actions. Interface documentation and mock tests do not prove every car, device or online-session combination.
