(() => {
  const dialog = el('mission');
  const canvases = [...dialog.querySelectorAll('canvas')];
  const buttons = [...dialog.querySelectorAll('[data-mode]')];
  const red = '#ed514b', green = '#8fb5a3', white = '#e8e9ed';
  const muted = '#7f8794', rail = '#252b34';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const radians = degrees => degrees * Math.PI / 180;
  const point = (radius, angle) => [200 + radius * Math.cos(radians(angle)), 200 + radius * Math.sin(radians(angle))];
  const mix = (a, b, t) => a + (b - a) * t;
  const contexts = canvases.map(canvas => {
    // A fixed 2x backing store keeps the thin scales sharp on a phone.
    canvas.width = canvas.height = 800;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    return ctx;
  });
  const dialMaterial = new Image();
  dialMaterial.src = '/assets/mission-dial.png';
  canvases[3].title = 'Needle and arc: current gain/loss rate, −0.20 to +0.20 seconds per second. Green below zero = gaining; red above zero = losing. The number below the lap time is the accumulated gap to the reference shown.';
  const tyreSource = document.querySelector('.tyre-panel');
  const tyrePanel = tyreSource.cloneNode(true);
  tyrePanel.querySelectorAll('.section-label, .tyre b, .tyre small').forEach(node => node.remove());
  tyrePanel.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  const tyreSlot = el('mission-tyres');
  tyreSlot.append(tyrePanel);
  const originalTyres = [...tyreSource.querySelectorAll('.tyre')];
  const cockpitTyres = [...tyrePanel.querySelectorAll('.tyre')];

  let blend = {sport: 0, track: 0};
  let transition = null;
  function mode(value) {
    if (!buttons.some(button => button.dataset.mode === value)) return;
    const now = performance.now();
    updateBlend(now);
    transition = {from: {...blend}, to: {sport: value === 'classic' ? 0 : 1, track: value === 'track' ? 1 : 0}, at: now};
    dialog.dataset.mode = value;
    tyreSlot.setAttribute('aria-hidden', String(value !== 'classic'));
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.mode === value));
  }
  function stepMode(step) {
    const index = buttons.findIndex(button => button.dataset.mode === dialog.dataset.mode);
    const next = ((index + step) % buttons.length + buttons.length) % buttons.length;
    mode(buttons[next].dataset.mode);
  }

  let wheelBridge = null;
  let wheelStep = 0;
  document.addEventListener('acdash-wheel-mode', ({detail}) => {
    const {bridge_id: bridge, cockpit_step: count} = detail;
    if (typeof bridge !== 'string' || !Number.isSafeInteger(count)) {
      wheelBridge = null;
      return;
    }
    // A snapshot counter survives dropped frames without repeating a press.
    const step = bridge === wheelBridge ? count - wheelStep : 0;
    wheelBridge = bridge;
    wheelStep = count;
    if (dialog.open && step !== 0) stepMode(step);
  });
  function updateBlend(now) {
    if (!transition) return;
    const t = reducedMotion.matches ? 1 : clamp((now - transition.at) / 780, 0, 1);
    const ease = 1 - Math.pow(1 - t, 4);
    blend.sport = mix(transition.from.sport, transition.to.sport, ease);
    blend.track = mix(transition.from.track, transition.to.track, ease);
    if (t === 1) transition = null;
  }
  el('mission-open').addEventListener('click', () => dialog.showModal());
  el('mission-close').addEventListener('click', () => dialog.close());
  const modeToggle = el('mission-mode-toggle');
  modeToggle.addEventListener('click', () => {
    const hidden = dialog.classList.toggle('modes-hidden');
    el('mission-modes').hidden = hidden;
    modeToggle.textContent = hidden ? 'Show modes' : 'Hide modes';
    modeToggle.setAttribute('aria-expanded', String(!hidden));
  });
  buttons.forEach(button => button.addEventListener('click', () => mode(button.dataset.mode)));
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.target.closest('input,select,textarea')) return;
    if (event.code === 'KeyV' && (dialog.open || (activePage === 'dashboard' && !document.querySelector('dialog[open]')))) {
      if (dialog.open) dialog.close();
      else dialog.showModal();
    }
    if (dialog.open && event.code === 'KeyM') {
      stepMode(1);
    }
  });
  function arc(ctx, radius, start, end, color, width) {
    ctx.beginPath();
    ctx.arc(200, 200, radius, radians(start), radians(end), end < start);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function text(ctx, label, x, y, size, color = white, weight = 600, italic = false) {
    ctx.save(); ctx.translate(x, y);
    if (italic) ctx.transform(1, 0, -.12, 1, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = weight + ' ' + size + 'px Cockpit, Rajdhani, sans-serif';
    ctx.fillStyle = color; ctx.fillText(label, 0, 0, 300); ctx.restore();
  }
  function face(ctx) {
    ctx.clearRect(0, 0, 400, 400);
    if (dialMaterial.complete && dialMaterial.naturalWidth) ctx.drawImage(dialMaterial, 0, 0, 400, 400);
    else {
      // A neutral face remains usable if the local texture fails to load.
      ctx.fillStyle = '#0a0c10'; ctx.beginPath(); ctx.arc(200, 200, 195, 0, Math.PI * 2); ctx.fill();
      arc(ctx, 194, 0, 360, '#4b515b', 1);
    }
  }
  function scale(ctx, {start, sweep, max, step, radius = 164, labelRadius = 137, size = 18, color = white, minor = 5, labels = true}) {
    const count = Math.floor(max / step * minor + 1e-6);
    for (let index = 0; index <= count; index++) {
      const major = index % minor === 0, value = index / minor * step;
      const angle = start + sweep * value / max;
      ctx.beginPath(); ctx.moveTo(...point(radius, angle)); ctx.lineTo(...point(radius - (major ? 10 : 4), angle));
      ctx.strokeStyle = major ? white : color;
      ctx.save(); ctx.globalAlpha *= major ? 1 : .62; ctx.lineWidth = major ? 3.2 : 1.4; ctx.stroke(); ctx.restore();
      if (major && labels) text(ctx, String(value), ...point(labelRadius, angle), size, white, 600, true);
    }
  }
  function needle(ctx, angle, radius, rimOnly = false, color = red) {
    ctx.save(); ctx.translate(200, 200); ctx.rotate(radians(angle));
    const tail = rimOnly ? radius - 26 : -25;
    ctx.shadowColor = '#ed514b55'; ctx.shadowBlur = 5; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(tail, -3.5); ctx.lineTo(radius, -1.1); ctx.lineTo(radius + 3, 0);
    ctx.lineTo(radius, 1.1); ctx.lineTo(tail, 3.5); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#ffb9aa'; ctx.lineWidth = .65;
    ctx.beginPath(); ctx.moveTo(tail + 2, -1.5); ctx.lineTo(radius - 2, 0); ctx.stroke(); ctx.restore();
    if (!rimOnly) {
      ctx.fillStyle = '#262c34'; ctx.beginPath(); ctx.arc(200, 200, 12, 0, Math.PI * 2); ctx.fill();
      arc(ctx, 11, 0, 360, '#7c858f', 1);
      arc(ctx, 8.8, 205, 320, '#d4d7db', 1.3); arc(ctx, 8.8, 25, 140, '#434c59', 1.3);
    }
  }
  function updateTyres(ctx, wear) {
    arc(ctx, 162, 123, 237, rail, 4);
    if (wear?.length === 4 && wear.every(available)) {
      const remaining = wear.reduce((sum, value) => sum + clamp(1 - value, 0, 1), 0) / 4;
      if (remaining > 0) arc(ctx, 162, 123, 123 + 114 * remaining, '#b7bfc9', 3.5);
    }
    originalTyres.forEach((original, index) => {
      const tyre = cockpitTyres[index]; tyre.className = original.className; tyre.title = original.title;
      tyre.querySelector('.tyre-fill').style.cssText = original.querySelector('.tyre-fill').style.cssText;
    });
  }
  function rpm(ctx, data, motion) {
    const limit = prefs.maxRpm || data?.rpm_limit || data?.max_rpm;
    const knownLimit = available(limit) && limit >= 1000;
    const fraction = knownLimit && available(data?.rpm) ? clamp(motion.rpm / limit, 0, 1) : null;
    const start = mix(140, 65, blend.track), sweep = mix(260, 238, blend.track);
    const thousands = knownLimit ? limit / 1000 : 8;
    // Match the inner rim clearance in every mode, including Track.
    const expansion = 17;
    // The red rails and integral numerals are the reference's signature.
    for (const [radius, alpha] of [[145,.72], [139,.5], [133,.3]]) {
      ctx.save(); ctx.globalAlpha *= alpha; arc(ctx, radius + expansion, start, start + sweep, red, 1.6); ctx.restore();
    }
    if (fraction !== null) {
      arc(ctx, 145 + expansion, start, start + sweep * fraction, red, 2);
      ctx.save(); ctx.globalAlpha *= blend.track * .9; arc(ctx, 128 + expansion, start, start + sweep * fraction, red, 6); ctx.restore();
    }
    scale(ctx, {start, sweep, max: thousands, step: 1, radius: 151 + expansion, labelRadius: 122 + expansion, size: 27, color: red, labels: knownLimit});
    // Track only: concentric pedal arcs occupy the unused RPM sector.
    // Both fill bottom-to-top; 8.5 + 3.5 + 8.5 = 20.5px across the pair,
    // comparable to the RPM band. Leave eight degrees at each scale endpoint.
    if (blend.track > 0) {
      const from = start + 360 - 8, to = start + sweep + 8;
      ctx.save(); ctx.globalAlpha *= blend.track;
      for (const [value, color, radius] of [[data?.brake, red, 135], [data?.throttle, green, 147]]) {
        const pedalRadius = radius + expansion;
        arc(ctx, pedalRadius, from, to, rail, 8.5);
        if (available(value) && value > 0) arc(ctx, pedalRadius, from, mix(from, to, clamp(value / 100, 0, 1)), color, 8.5);
      }
      ctx.restore();
    }
    // Original right-of-pivot gear position; the needle passes in front.
    text(ctx, data?.gear ?? '—', 263, 203, 59, white, 700, true);
    if (fraction !== null) needle(ctx, start + sweep * fraction, 157 + expansion);
  }
  function speed(ctx, data, motion) {
    // Extend the lower end toward the central instrument. The centres sit at
    // different heights, so a symmetric 60°/300° sweep left too much gap below.
    const start = mix(48, 47, blend.track), sweep = 300 - start;
    arc(ctx, 171, start, 300, rail, 1);
    if (blend.sport > 0) { ctx.save(); ctx.globalAlpha *= blend.sport; arc(ctx, 171, start, 300, '#9f3436', 2.5); ctx.restore(); }
    scale(ctx, {start, sweep, max: 350, step: 50, color: white});
    if (available(data?.speed)) needle(ctx, start + sweep * clamp(motion.speed / 350, 0, 1), 166, true);
    text(ctx, available(data?.speed) ? Math.round(data.speed) : '—', 200, 203, 66, white, 650, true);
    text(ctx, 'KM/H', 200, 249, 14, muted, 500);
  }
  function timing(ctx, data, motion) {
    const delta = data?.cockpit_delta ?? data?.previous_lap_delta;
    const paceValue = data?.cockpit_pace ?? data?.previous_lap_pace;
    const lower = mix(132, 133, blend.track);
    // Keep zero exactly at three o'clock while extending only the lower sweep.
    const paceAngle = value => {
      const ratio = clamp(value / .2, -1, 1);
      return -ratio * (ratio < 0 ? lower : 120);
    };
    arc(ctx, 171, lower, -120, rail, 1);
    if (blend.sport > 0) { ctx.save(); ctx.globalAlpha *= blend.sport; arc(ctx, 171, lower, -120, '#9f3436', 2.5); ctx.restore(); }
    for (let i = 0; i <= 40; i++) {
      const value = (i - 20) / 100;
      const angle = paceAngle(value), major = i % 10 === 0;
      ctx.beginPath(); ctx.moveTo(...point(164, angle)); ctx.lineTo(...point(164 - (major ? 10 : 4), angle));
      ctx.strokeStyle = major ? white : '#a2a6b1'; ctx.lineWidth = major ? 3.2 : 1.4; ctx.stroke();
      if (major) {
        const label = value === 0 ? '0' : (value > 0 ? '+' : '−') + Math.abs(value).toFixed(1).slice(1);
        text(ctx, label, ...point(137, angle), 18, white, 600, true);
      }
    }
    if (available(paceValue)) {
      const pace = Math.abs(motion.pace) < .002 ? 0 : motion.pace;
      const angle = paceAngle(pace), color = pace < 0 ? green : pace > 0 ? red : white;
      if (pace !== 0) arc(ctx, 176, 0, angle, color, 4.5);
      needle(ctx, angle, 169, true, color);
    }
    // Fractional seconds share a baseline with the larger minute/second readout.
    const parts = lapTime(data?.lap_ms).split('.');
    ctx.save(); ctx.font = '600 44px Cockpit, Rajdhani, sans-serif';
    const bigWidth = ctx.measureText(parts[0]).width;
    ctx.font = '500 22px Cockpit, Rajdhani, sans-serif';
    const small = '.' + parts[1], smallWidth = ctx.measureText(small).width;
    const left = 200 - (bigWidth + smallWidth + 3) / 2;
    text(ctx, parts[0], left + bigWidth / 2, 200, 44, white, 600);
    text(ctx, small, left + bigWidth + 3 + smallWidth / 2, 208, 22, '#b8bec8', 500);
    ctx.restore();
    text(ctx, available(delta) ? (delta > 0 ? '+' : '') + delta.toFixed(3) : '—', 200, 250, 25,
      available(delta) ? delta < 0 ? green : delta > 0 ? '#ed7a70' : white : muted, 500);
    const reference = available(delta) ? 'VS ' + (data.cockpit_delta_source || 'previous lap').toUpperCase()
      : data?.current_lap_invalid ? 'LAP INVALID' : data ? 'AWAITING VALID LAP' : '';
    text(ctx, reference, 200, 279, 14, muted, 500);
  }
  function aids(ctx, data, key) {
    const max = data?.[key + '_modes'], value = data?.[key + '_mode'];
    text(ctx, key.toUpperCase(), key === 'tc' ? 112 : 288, 200, 33, white, 600);
    if (!Number.isInteger(max) || max < 0 || max > 64) return;
    const bars = max + 1, direction = key === 'tc' ? 1 : -1, step = 140 / bars;
    for (let i = 0; i < bars; i++) {
      const start = 90 + direction * (20 + i * step);
      arc(ctx, 160, start, start + direction * (step - Math.min(5, step / 3)),
        available(value) && i <= value ? red : rail, 5.5);
    }
  }
  function localMap(ctx, data) {
    if (data) ensureMap();
    ctx.save(); ctx.beginPath(); ctx.arc(200, 200, 143, 0, Math.PI * 2); ctx.clip(); ctx.translate(200, 200);
    if (data && mapInfo?.demo) {
      const angle = data.lap_progress * Math.PI * 2;
      ctx.save(); ctx.rotate(-Math.PI / 2 - Math.atan2(240 * Math.cos(angle), -360 * Math.sin(angle)));
      ctx.translate(-360 * Math.cos(angle), -240 * Math.sin(angle));
      ctx.beginPath(); ctx.ellipse(0, 0, 360, 240, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#353d48'; ctx.lineWidth = 13; ctx.stroke();
      ctx.strokeStyle = '#acb5c2'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    } else if (data && mapInfo?.available && mapImage && data.world_position?.every(available)) {
      const heading = data.world_forward;
      if (!heading?.every(available) || Math.hypot(...heading) <= .001) { text(ctx, '—', 0, 0, 30, muted); ctx.restore(); return; }
      const zoom = 2.5;
      const [x, y] = mapPoint(data.world_position, mapInfo, {x:0, y:0, scale:zoom});
      ctx.save(); ctx.rotate(-Math.PI / 2 - Math.atan2(heading[1], heading[0])); ctx.globalAlpha *= .7;
      ctx.drawImage(mapImage, -x, -y, mapInfo.width * zoom, mapInfo.height * zoom); ctx.restore();
    } else { text(ctx, '—', 0, 0, 30, muted); ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(0, -29); ctx.lineTo(19, 18); ctx.lineTo(0, 11); ctx.lineTo(-19, 18); ctx.closePath();
    ctx.fillStyle = red; ctx.fill(); ctx.strokeStyle = '#ecb5ac'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  }
  let lastFrame = 0, lastAccessible = 0, previousData = null;
  const motion = {rpm: 0, speed: 0, pace: 0};
  function draw(now) {
    requestAnimationFrame(draw);
    if (!dialog.open) { lastFrame = 0; return; }
    if (now - lastFrame < 15) return;
    const dt = lastFrame ? Math.min(now - lastFrame, 100) : 100;
    const snap = !lastFrame || !previousData || !current || previousData.car !== current.car;
    lastFrame = now; updateBlend(now);
    for (const [key, value] of [['rpm', current?.rpm], ['speed', current?.speed],
      ['pace', current?.cockpit_pace ?? current?.previous_lap_pace]]) {
      const target = available(value) ? value : 0;
      motion[key] = snap || reducedMotion.matches ? target : mix(motion[key], target, 1 - Math.exp(-dt / 45));
    }
    previousData = current; contexts.forEach(face);
    if (blend.sport < 1) {
      contexts[0].save(); contexts[0].globalAlpha = 1 - blend.sport;
      updateTyres(contexts[0], current?.tyre_wear_fraction); contexts[0].restore();
      contexts[4].save(); contexts[4].globalAlpha = 1 - blend.sport;
      localMap(contexts[4], current); contexts[4].restore();
    }
    if (blend.sport > 0) {
      for (const [index, key] of [[0,'tc'], [4,'abs']]) {
        contexts[index].save(); contexts[index].globalAlpha = blend.sport;
        aids(contexts[index], current, key); contexts[index].restore();
      }
    }
    speed(contexts[1], current, motion); rpm(contexts[2], current, motion); timing(contexts[3], current, motion);
    if (now - lastAccessible > 250) {
      lastAccessible = now;
      const status = current?.status || 'offline';
      el('mission-status').textContent = status.toUpperCase(); el('mission-status').dataset.state = status;
      canvases[1].setAttribute('aria-label', available(current?.speed) ? 'Speed ' + Math.round(current.speed) + ' kilometres per hour' : 'Speed unavailable');
      canvases[2].setAttribute('aria-label', current ? 'RPM ' + Math.round(current.rpm ?? 0) + ', gear ' + (current.gear ?? 'unavailable') + ', throttle ' + (current.throttle ?? 'unavailable') + ' percent, brake ' + (current.brake ?? 'unavailable') + ' percent' : 'RPM, gear and pedals unavailable');
      canvases[3].setAttribute('aria-label', 'Lap time ' + lapTime(current?.lap_ms) + ', accumulated gap versus ' + (current?.cockpit_delta_source || 'previous lap') + ': ' + (current?.cockpit_delta ?? current?.previous_lap_delta ?? 'unavailable') + ' seconds, current gain/loss rate ' + (current?.cockpit_pace ?? current?.previous_lap_pace ?? 'unavailable') + ' seconds per second');
    }
  }
  requestAnimationFrame(draw);
})();
