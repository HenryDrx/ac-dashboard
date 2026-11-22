# Cockpit appearance refresh

This revision changes the five-dial cockpit view. The regular dashboard, its layout editor, telemetry sources, controls and lap recording continue to use their existing code.

## Design

- Preserve the reference's five overlapping circular instruments and dominant central tachometer.
- Classic: four tall tyre indicators, speed, RPM/gear/pedals, lap time/current pace/previous-lap gap, heading-up local map.
- Sport and Track: outer instruments show TC and ABS bars; Track enlarges only the centre instrument and rotates the RPM scale. The four side instruments keep their size, and the outer two stay in their Sport positions.
- Use a graphite face, subtle forged-carbon texture, dark titanium rim, warm red scales and off-white numerals. The original thermal zones remain intact, with reduced saturation only in this view. Mean tyre life uses a neutral arc.
- The RPM gear remains to the right of the pivot. Classic and Sport omit the pedals and expand the RPM rails, labels and needle into their former space. Track / Focus places two parallel pedal arcs in the unused RPM sector: brake on the inner radius, throttle on the outer radius. Both fill upward from the lower endpoint. Their combined radial thickness is 20.5 logical pixels, similar to the RPM band, with eight degrees of clearance at either endpoint.
- Use 780 ms instrument transitions, coordinated scale/content fades, short needle interpolation, and reduced-motion support.
- All images and fonts are served locally. No new runtime dependency, API key or external connection is required.

## Run

Use the existing commands from the project folder:

```powershell
py -m pip install -r requirements.txt
py server.py --mock
```

Open `http://localhost:8001/` and choose **Cockpit**. Use **Classic**, **Sport**, or **Track / Focus**. **Hide modes** removes the bottom controls. `M` cycles the cockpit modes, `V` opens/closes the cockpit and Escape closes it. Use `py server.py` for the existing live AC connection.

The development preview uses the already established port 8016; the shipped default remains 8001.

## Wheel mode control

Update the existing AC Dash Bridge with `py install_bridge.py` while AC is closed. Start a driving session and open **AC Dash Bridge** in AC's app sidebar. Click the binding under **Next cockpit mode** and turn the RS V2 **TC CON** knob clockwise one click (input 48). Bind **Previous cockpit mode** by turning it counterclockwise (input 47). CSP stores the bindings. Clear any existing in-game TC assignments for those directions if you want the knob dedicated to the dashboard.

Open **Cockpit** on your phone. The knob cycles through Classic, Sport, and Track / Focus in either direction while AC has focus.

## Current pace versus accumulated gap

The timing needle and coloured arc now show **current gain/loss rate**, not the accumulated time gap. Positive is losing time (red, upward from zero); negative is gaining (green, downward from zero). The scale spans −0.20 to +0.20 seconds per second, saturating at the ends. For example, +0.10 means losing about one tenth of a second each second at this recent pace.

The number below the lap time still shows the accumulated gap against the immediately preceding complete valid lap. It can correctly read **−1.000** while the arc is **red**: you remain one second ahead but are currently losing time. Likewise, a green arc can appear while you are still behind overall.

The implementation derives pace from changes in the unrounded equal-distance gap over about 350 ms, then applies a short 120 ms smoothing filter. It waits for at least 200 ms of fresh samples and clears the trend across invalid laps, reference changes, resets, backward jumps and transport gaps. It uses the same previous-lap reference as the numeric gap; CSP's session-best speed-difference field is not substituted into this comparison.

This is our recorded-lap pace estimate, not a claim to reproduce Kunos' internal algorithm exactly. The distinction between accumulated gap and current gain/loss is also documented by the independent [AC DeltaBar project](https://github.com/jamessanford/assetto-corsa-deltabar).

Restart the Python server after updating, because this revision adds the `previous_lap_pace` telemetry field. The CSP bridge does not need updating for this change.

## Assets and provenance

- `web/assets/mission-dial.png`: generated using the built-in image generation tool, then copied into the project. It contains the blank dial material and rim only; all telemetry, ticks, needles, and transitions remain live application graphics. Original generated file: `exec-443f0711-025a-4625-a538-25f8040c831f.png`.
- `web/fonts/Oxanium-Variable.ttf`: [Oxanium from the official Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/oxanium). The SIL Open Font License is included as `web/fonts/Oxanium-OFL.txt`.
- The supplied Porsche reference screenshots guide the composition; they are not used as backgrounds in the app.

Image-generation prompt:

> Create ONE production UI texture asset, a perfectly circular blank high-end automotive instrument dial, inspired by Porsche Mission concept car instruments. Square image 1024 x 1024. Orthographic straight-on perfectly concentric, center precisely at (512,512), outer diameter 1000px leaving 12px margin. Transparent outside the circle. Completely blank face with NO numerals NO ticks NO needles NO hub NO indicators NO text NO branding NO coloured accents. Very dark graphite charcoal black glass face, smooth near-black centre for placing white telemetry on top later. Almost invisible small-scale forged-carbon texture confined mainly to the outermost 20% of the face; the texture must be extremely subtle and low contrast, premium, no distracting bright shards. Only a THIN sleek brushed dark titanium machined bezel around the outer edge, about 12px thickness, highlighted softly at top-left and bottom-right, dark grey instead of bright white, with fine concentric micro-machined grooves inside the rim. Restrained industrial precision, premium concept car digital instrument surface. No perspective, no surrounding dashboard, no glare over centre, no bulky metallic lip, no photorealistic scene. This is an image asset used behind live vector gauge scales, not a complete gauge.

## Preview evidence

The images in `docs/previews/` are browser captures of the actual app using mock telemetry. The transition GIF uses captured frames with longer holds at the end of each mode for inspection; it is not a frame-rate benchmark.

Desktop captures use 1280 × 720. Phone landscape captures use 844 × 390. This iteration has not been retested in a live AC session or on physical iPhone hardware.
