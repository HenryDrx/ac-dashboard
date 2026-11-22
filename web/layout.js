(() => {
  'use strict';

  const dashboard = el('dashboard');
  const editor = el('layout-editor');
  const grid = el('widget-grid');
  const library = el('layout-library');
  const preset = el('layout-preset');
  const storageKey = 'ac-dash-layout-v1';

  // Move the live instruments so there is one telemetry target for each ID.
  const instruments = {
    gear: ['Gear', '.gear-display,.gear-label'],
    speed: ['Speed', '.speed-wrap'],
    rpm: ['RPM and shift lights', '#rpm-strip', 'full'],
    car: ['Car and track', '.car-info'],
    progress: ['Position and lap progress', '#race-line,.session-line,.progress-track'],
    lap: ['Current lap', '.current-lap'],
    delta: ['Lap delta', '.delta-box'],
    aids: ['Driving aids', '.aids'],
    tyres: ['Tyres', '.tyre-panel'],
    g: ['G-force', '.g-meter'],
    steering: ['Steering', '.steering-wide', 'full'],
    trace: ['Input trace', '.history-head,#history-canvas', 'wide'],
    pedals: ['Pedals', '.pedal-pair'],
    map: ['Circuit map', '.map-stage', 'wide'],
    radar: ['Proximity radar', '.radar-panel'],
    damage: ['Car condition', '.damage-panel'],
    flag: ['Flags and pit status', '.secondary']
  };

  const layouts = {
    classic: Object.keys(instruments).filter(id => !['map', 'radar', 'damage'].includes(id)),
    race: ['gear', 'speed', 'delta', 'rpm', 'lap', 'progress', 'flag'],
    analysis: ['trace', 'pedals', 'tyres', 'g', 'steering', 'aids', 'lap', 'delta', 'car'],
    track: ['map', 'radar', 'damage', 'progress', 'speed', 'gear', 'rpm', 'flag']
  };

  const homes = new Map();
  for (const [id, [, selectors]] of Object.entries(instruments)) {
    const nodes = [...document.querySelectorAll(selectors)].map(node => {
      const anchor = document.createComment(id);
      node.before(anchor);
      return { node, anchor };
    });
    homes.set(id, nodes);
  }

  let saved = null;
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(stored)) {
      const valid = [...new Set(stored.filter(id => typeof id === "string" && Object.hasOwn(instruments, id)))];
      if (valid.length) saved = valid;
    }
  } catch {}

  let draft = null;
  let useClassic = false;
  let drag = null;

  function button(label, action, accessibleLabel = label) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.setAttribute('aria-label', accessibleLabel);
    if (action) element.addEventListener('click', action);
    return element;
  }

  function restoreHomes() {
    for (const nodes of homes.values()) {
      for (const { node, anchor } of nodes) anchor.after(node);
    }
  }

  function mount(layout, editing = false) {
    restoreHomes();
    grid.replaceChildren();
    dashboard.classList.toggle('custom-layout', Boolean(layout));
    grid.hidden = !layout;
    if (!layout) return;
    layout.forEach((id, index) => {
      const [label, , size = 'normal'] = instruments[id];
      const tile = document.createElement('article');
      tile.className = 'widget-tile';
      tile.dataset.widget = id;
      tile.dataset.size = size;
      const header = document.createElement('header');
      const title = document.createElement('span');
      title.textContent = label;
      header.append(title);
      if (editing) {
        const grip = button('⠿', null, 'Drag ' + label);
        grip.className = 'widget-grip';
        bindDrag(grip, id);
        const earlier = button('←', () => move(id, index - 1), 'Move ' + label + ' earlier');
        const later = button('→', () => move(id, index + 1), 'Move ' + label + ' later');
        earlier.disabled = index === 0;
        later.disabled = index === layout.length - 1;
        header.append(grip, earlier, later, button('×', () => {
          draft = draft.filter(item => item !== id);
          changed(label + ' removed');
          library.querySelector('[data-add="' + id + '"]')?.focus();
        }, 'Remove ' + label));
      }
      const body = document.createElement('div');
      body.className = 'widget-content';
      for (const { node } of homes.get(id)) body.append(node);
      tile.append(header, body);
      grid.append(tile);
    });
    if (editing) {
      const end = document.createElement('div');
      end.className = 'widget-drop-end';
      end.textContent = layout.length ? 'Drop here to place last' : 'Add an instrument to get started';
      grid.append(end);
    }
  }

  function refreshEditor(message = '') {
    mount(draft, true);
    library.replaceChildren();
    for (const [id, [label]] of Object.entries(instruments)) {
      const item = button(draft.includes(id) ? '✓ ' + label : '+ ' + label, () => {
        insert(id, null);
        grid.querySelector('[data-widget="' + id + '"] .widget-grip')?.focus();
      });
      item.dataset.add = id;
      item.disabled = draft.includes(id);
      if (!item.disabled) bindDrag(item, id);
      library.append(item);
    }
    el('layout-save').disabled = !draft.length;
    el('layout-feedback').textContent = message;
  }

  function changed(message) {
    useClassic = false;
    preset.value = '';
    refreshEditor(message);
  }

  function move(id, index) {
    const old = draft.indexOf(id);
    if (index < 0 || index >= draft.length || old === index) return;
    draft.splice(old, 1);
    draft.splice(index, 0, id);
    changed(instruments[id][0] + ' moved to position ' + (index + 1));
    grid.querySelector('[data-widget="' + id + '"] .widget-grip')?.focus();
  }

  function insert(id, targetId, after = false) {
    if (id === targetId || !draft) return;
    const next = draft.filter(item => item !== id);
    const targetIndex = targetId ? next.indexOf(targetId) : next.length;
    if (targetIndex < 0) return;
    const index = targetIndex + Number(after);
    next.splice(index, 0, id);
    draft = next;
    changed(instruments[id][0] + ' placed at position ' + (index + 1));
  }

  function dropTarget(event) {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || !grid.contains(target)) return null;
    return target.closest('.widget-tile,.widget-drop-end') || grid;
  }

  function clearDrag() {
    drag?.target?.classList.remove('widget-target');
    drag = null;
  }

  function bindDrag(handle, id) {
    handle.classList.add('widget-drag-source');
    let suppressClick = false;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      suppressClick = false;
      drag = { handle, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (drag?.handle !== handle || drag.pointer !== event.pointerId) return;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
      if (!drag.moved) return;
      if (event.clientY > innerHeight - 38) window.scrollBy(0, 14);
      if (event.clientY < 38) window.scrollBy(0, -14);
      drag.target?.classList.remove('widget-target');
      drag.target = dropTarget(event);
      drag.target?.classList.add('widget-target');
    });
    handle.addEventListener('pointerup', event => {
      if (drag?.handle !== handle || drag.pointer !== event.pointerId) return;
      const target = drag.moved ? dropTarget(event) : null;
      suppressClick = drag.moved;
      clearDrag();
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      const after = Boolean(target.dataset.widget) && event.clientX > bounds.left + bounds.width / 2;
      insert(id, target.dataset.widget, after);
    });
    handle.addEventListener('pointercancel', clearDrag);
    handle.addEventListener('lostpointercapture', () => {
      if (drag?.handle === handle) clearDrag();
    });
    handle.addEventListener('click', event => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    }, true);
  }

  function closeEditor() {
    clearDrag();
    draft = null;
    editor.hidden = true;
    el('layout-open').setAttribute('aria-expanded', 'false');
  }

  el('layout-open').setAttribute('aria-controls', editor.id);
  el('layout-open').setAttribute('aria-expanded', 'false');
  el('layout-open').addEventListener('click', () => {
    if (draft) {
      closeEditor();
      mount(saved);
      return;
    }
    useClassic = !saved;
    draft = [...(saved || layouts.classic)];
    preset.value = useClassic ? 'classic' : '';
    editor.hidden = false;
    el('layout-open').setAttribute('aria-expanded', 'true');
    refreshEditor();
    preset.focus({ preventScroll: true });
  });
  preset.addEventListener('change', () => {
    useClassic = preset.value === 'classic';
    draft = [...layouts[preset.value]];
    refreshEditor('Starting layout loaded. Save to apply it.');
  });
  el('layout-cancel').addEventListener('click', () => {
    closeEditor();
    mount(saved);
    el('layout-open').focus();
  });
  el('layout-save').addEventListener('click', () => {
    if (!draft?.length) return;
    const next = useClassic ? null : [...draft];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      el('layout-feedback').textContent = 'This browser blocked layout storage. Your draft is still open.';
      return;
    }
    saved = next;
    closeEditor();
    mount(saved);
    el('layout-open').focus();
  });

  window.dashboardLayout = {
    editing: () => draft !== null,
    showPage(page) {
      if (draft) closeEditor();
      mount(page === 'dashboard' ? saved : null);
    },
    drawCircuit() {
      if (grid.querySelector('[data-widget="map"]')) drawMap();
      if (grid.querySelector('[data-widget="radar"]')) drawRadar();
      if (grid.querySelector('[data-widget="damage"]')) drawDamage();
    }
  };
  mount(saved);
})();
