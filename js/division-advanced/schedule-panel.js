import { state } from './state.js';

const DEFAULT_MATCH = 3;
const DEFAULT_BUFFER = 0.5;

const RANK_ORDER = [
  '10th gup', '9th gup', '8th gup', '7th gup', '6th gup',
  '5th gup', '4th gup', '3rd gup', '2nd gup', '1st gup',
  '1st dan', '2nd dan', '3rd dan', '4th dan', '5th dan', '6th dan'
];
const RANK_INDEX = Object.fromEntries(
  RANK_ORDER.map((rank, idx) => [String(rank).toLowerCase(), idx])
);
const SLOT = 5;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function entryAthletes(entry) {
  return Array.isArray(entry?.athletes) ? entry.athletes : [];
}

function matchCount(entry) {
  const type = String(entry.division_type || '').trim();
  const n = Number(entry.athlete_count || 0) || 0;
  const json = entry.json_data;
  if (type === 'List') return Math.max(0, n);
  if (json && typeof json === 'object') {
    if (type === 'Single Elimination' || type === 'Round Robin') {
      return (json.matches || []).length;
    }
    if (type === 'Premier League') {
      const pools = (json.pools || []).reduce(
        (sum, p) => sum + ((p.round_robin_matches || []).length),
        0
      );
      const elim = (((json.elimination || {}).matches || json.elimination_matches || [])).length;
      return pools + elim;
    }
  }
  if (n <= 0) return 0;
  if (type === 'Single Elimination') return Math.max(0, n - 1);
  if (type === 'Round Robin') return (n * (n - 1)) / 2;
  return Math.max(0, n);
}

function displayDuration(entry, sched) {
  const id = String(entry.id);
  const match = Number(sched.match_durations?.[id] || 0) || 0;
  const buffer = Number(sched.buffer_durations?.[id] || 0) || 0;
  const raw = (match + buffer) * matchCount(entry);
  if (raw <= 0) return 0;
  return Math.max(SLOT, Math.ceil(raw / SLOT) * SLOT);
}

function beltCategory(entry) {
  const hasDan = entryAthletes(entry).some((a) => String(a.rank || '').toLowerCase().includes('dan'));
  return hasDan ? 'black' : 'color';
}

function entryMinAge(entry) {
  const ages = entryAthletes(entry)
    .map((a) => (a.age != null ? Number(a.age) : null))
    .filter((a) => a != null && !Number.isNaN(a));
  return ages.length ? Math.min(...ages) : null;
}

function entryMaxAge(entry) {
  const ages = entryAthletes(entry)
    .map((a) => (a.age != null ? Number(a.age) : null))
    .filter((a) => a != null && !Number.isNaN(a));
  return ages.length ? Math.max(...ages) : null;
}

function entryMinRankIndex(entry) {
  const idxs = entryAthletes(entry)
    .map((a) => RANK_INDEX[String(a.rank || '').trim().toLowerCase()])
    .filter((idx) => idx != null);
  return idxs.length ? Math.min(...idxs) : null;
}

function ageLabel(entry) {
  const min = entryMinAge(entry);
  const max = entryMaxAge(entry);
  if (min == null) return '—';
  if (max == null || max === min) return String(min);
  return `${min}–${max}`;
}

function ensurePackOrder(sched) {
  const catalogIds = (sched.catalog || []).map((e) => String(e.id));
  const existing = Array.isArray(sched.pack_order) ? sched.pack_order.map(String) : [];
  const kept = existing.filter((id) => catalogIds.includes(id));
  const missing = catalogIds.filter((id) => !kept.includes(id));
  sched.pack_order = [...kept, ...missing];
  return sched;
}

function filterEntries(entries) {
  const colorOn = document.getElementById('schedFilterColor')?.checked !== false;
  const blackOn = document.getElementById('schedFilterBlack')?.checked !== false;
  const ageMinRaw = document.getElementById('schedAgeMin')?.value;
  const ageMaxRaw = document.getElementById('schedAgeMax')?.value;
  const ageMin = ageMinRaw === '' || ageMinRaw == null ? null : Number(ageMinRaw);
  const ageMax = ageMaxRaw === '' || ageMaxRaw == null ? null : Number(ageMaxRaw);
  const hasAge = (ageMin != null && !Number.isNaN(ageMin)) || (ageMax != null && !Number.isNaN(ageMax));

  return (entries || []).filter((entry) => {
    const belt = beltCategory(entry);
    if (belt === 'color' && !colorOn) return false;
    if (belt === 'black' && !blackOn) return false;
    if (hasAge) {
      const athletes = entryAthletes(entry);
      if (!athletes.length) return false;
      const ok = athletes.some((a) => {
        const age = a.age != null ? Number(a.age) : null;
        if (age == null || Number.isNaN(age)) return false;
        if (ageMin != null && !Number.isNaN(ageMin) && age < ageMin) return false;
        if (ageMax != null && !Number.isNaN(ageMax) && age > ageMax) return false;
        return true;
      });
      if (!ok) return false;
    }
    return true;
  });
}

function sortEntries(entries, mode, sched) {
  const list = [...entries];
  const packIndex = new Map((sched.pack_order || []).map((id, i) => [String(id), i]));
  if (mode === 'pack' || !mode) {
    list.sort((a, b) => (packIndex.get(String(a.id)) ?? 9999) - (packIndex.get(String(b.id)) ?? 9999));
    return list;
  }
  if (mode === 'age' || mode === 'age_rank') {
    list.sort((a, b) => {
      const aa = entryMinAge(a);
      const ba = entryMinAge(b);
      if (aa == null && ba == null) return 0;
      if (aa == null) return 1;
      if (ba == null) return -1;
      if (aa !== ba) return aa - ba;
      if (mode === 'age_rank') {
        const ar = entryMinRankIndex(a);
        const br = entryMinRankIndex(b);
        if (ar != null && br != null && ar !== br) return ar - br;
      }
      return String(a.division_name || '').localeCompare(String(b.division_name || ''));
    });
    return list;
  }
  if (mode === 'rank' || mode === 'rank_age') {
    list.sort((a, b) => {
      const ar = entryMinRankIndex(a);
      const br = entryMinRankIndex(b);
      if (ar == null && br == null) return 0;
      if (ar == null) return 1;
      if (br == null) return -1;
      if (ar !== br) return ar - br;
      if (mode === 'rank_age') {
        const aa = entryMinAge(a);
        const ba = entryMinAge(b);
        if (aa != null && ba != null && aa !== ba) return aa - ba;
      }
      return String(a.division_name || '').localeCompare(String(b.division_name || ''));
    });
    return list;
  }
  if (mode === 'name') {
    list.sort((a, b) => String(a.division_name || '').localeCompare(String(b.division_name || '')));
  }
  return list;
}

function visibleEntries(sched) {
  const mode = document.getElementById('schedSortMode')?.value || 'pack';
  return sortEntries(filterEntries(sched.catalog || []), mode, sched);
}

function statusFor(entry, sched) {
  const id = String(entry.id);
  if ((sched.scratch_ids || []).includes(id)) return 'scratch';
  if (sched.placements?.[id]) return 'placed';
  if (displayDuration(entry, sched) <= 0) return 'no time';
  return 'ready';
}

function parseHhmm(text) {
  const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

function formatHhmm(totalMinutes) {
  const m = Math.max(0, Math.floor(totalMinutes));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function fmtClock(startAbs, offset) {
  return formatHhmm(startAbs + offset);
}

function dayWindowMinutes(day) {
  const start = parseHhmm(day?.start_time || '08:00');
  let end = parseHhmm(day?.end_time || '18:00');
  if (start == null || end == null) return 12 * 60;
  if (end <= start) end += 24 * 60;
  return Math.max(SLOT, end - start);
}

function formatDurationInput(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function renderBoard(sched) {
  const board = document.getElementById('scheduleBoard');
  if (!board) return;
  const dayIndex = Number(sched.active_day_index || 0);
  const day = (sched.days || [])[dayIndex] || { name: 'Day 1', start_time: '08:00', end_time: '18:00' };
  const ringCount = Math.max(1, Number(sched.ring_count || 3));
  const startAbs = parseHhmm(day.start_time) ?? 8 * 60;
  const windowMins = dayWindowMinutes(day);
  const slotCount = Math.max(1, Math.floor(windowMins / SLOT));
  const byRing = Array.from({ length: ringCount }, () => []);

  Object.entries(sched.placements || {}).forEach(([id, placement]) => {
    if (Number(placement.day_index || 0) !== dayIndex) return;
    const ring = Number(placement.ring_index || 0);
    if (ring < 0 || ring >= ringCount) return;
    const entry = (sched.catalog || []).find((e) => String(e.id) === id);
    if (!entry) return;
    const start = Number(placement.start_offset_minutes || 0);
    const duration = displayDuration(entry, sched);
    byRing[ring].push({
      id,
      name: entry.division_name,
      type: entry.division_type,
      start,
      end: start + duration,
      athletes: entry.athlete_count || 0,
      duration
    });
  });
  byRing.forEach((list) => list.sort((a, b) => a.start - b.start));

  const timeLabels = Array.from({ length: slotCount }, (_, i) => formatHhmm(startAbs + i * SLOT));
  const gridCols = `var(--da-sched-time-w, 52px) repeat(${ringCount}, minmax(120px, 1fr))`;

  board.innerHTML = `
    <div class="da-schedule-timeline" style="--da-sched-slots:${slotCount}; --da-sched-cols:${ringCount}; grid-template-columns:${gridCols};">
      <div class="da-schedule-timeline-corner">time</div>
      ${Array.from({ length: ringCount }, (_, ring) => `
        <div class="da-schedule-timeline-ring-head">ring ${ring + 1}</div>
      `).join('')}
      <div class="da-schedule-time-axis" aria-hidden="true">
        ${timeLabels.map((label) => `<div class="da-schedule-time-tick">${label}</div>`).join('')}
      </div>
      ${byRing.map((list, ring) => `
        <div class="da-schedule-ring-lane" data-ring="${ring}">
          ${list.map((block) => {
            const topSlots = block.start / SLOT;
            const heightSlots = Math.max(1, block.duration / SLOT);
            return `<div class="da-schedule-block" data-id="${escapeHtml(block.id)}" draggable="true"
              style="top:calc(${topSlots} * var(--da-sched-slot-h)); height:calc(${heightSlots} * var(--da-sched-slot-h) - 2px);">
              <strong>${escapeHtml(block.name)}</strong>
              <span>${fmtClock(startAbs, block.start)}–${fmtClock(startAbs, block.end)}</span>
            </div>`;
          }).join('')}
        </div>
      `).join('')}
    </div>
  `;
}

function renderScratch(sched) {
  const list = document.getElementById('scheduleScratchList');
  if (!list) return;
  const ids = sched.scratch_ids || [];
  if (!ids.length) {
    list.innerHTML = '<li class="da-hint">empty — drop board blocks here</li>';
    return;
  }
  list.innerHTML = ids.map((id) => {
    const entry = (sched.catalog || []).find((e) => String(e.id) === id);
    const name = entry?.division_name || id;
    const selected = state.scheduleSelectedIds.has(id) ? 'selected' : '';
    return `<li class="da-schedule-scratch-item ${selected}" data-id="${escapeHtml(id)}" draggable="true">
      ${escapeHtml(name)}
    </li>`;
  }).join('');
}

function renderCatalog(sched) {
  const body = document.getElementById('scheduleCatalogBody');
  if (!body) return;
  const shown = visibleEntries(sched);
  const packIndex = new Map((sched.pack_order || []).map((id, i) => [String(id), i + 1]));

  body.innerHTML = shown.map((entry) => {
    const id = String(entry.id);
    const hasMatch = Object.prototype.hasOwnProperty.call(sched.match_durations || {}, id);
    const hasBuffer = Object.prototype.hasOwnProperty.call(sched.buffer_durations || {}, id);
    const matchVal = hasMatch ? Number(sched.match_durations[id]) : null;
    const bufferVal = hasBuffer ? Number(sched.buffer_durations[id]) : null;
    const total = displayDuration(entry, sched);
    const checked = state.scheduleSelectedIds.has(id) ? 'checked' : '';
    const selected = state.scheduleSelectedIds.has(id) ? 'selected' : '';
    return `<tr data-id="${escapeHtml(id)}" class="${selected}">
      <td><input type="checkbox" class="sched-row-check" data-id="${escapeHtml(id)}" ${checked}></td>
      <td>${packIndex.get(id) ?? '—'}</td>
      <td>${escapeHtml(entry.division_name || '')}</td>
      <td>${escapeHtml(entry.division_type || '')}</td>
      <td>${entry.athlete_count || 0}</td>
      <td>${escapeHtml(ageLabel(entry))}</td>
      <td>${beltCategory(entry)}</td>
      <td><input type="number" class="da-input da-input-sm sched-dur-match" data-id="${escapeHtml(id)}" min="0" step="0.1" inputmode="decimal" value="${hasMatch ? escapeHtml(formatDurationInput(matchVal)) : ''}" placeholder="${DEFAULT_MATCH}"></td>
      <td><input type="number" class="da-input da-input-sm sched-dur-buffer" data-id="${escapeHtml(id)}" min="0" step="0.1" inputmode="decimal" value="${hasBuffer ? escapeHtml(formatDurationInput(bufferVal)) : ''}" placeholder="${DEFAULT_BUFFER}"></td>
      <td>${total || '—'}</td>
      <td>${escapeHtml(statusFor(entry, sched))}</td>
    </tr>`;
  }).join('');
}

function syncDaySelect(sched) {
  const select = document.getElementById('schedDaySelect');
  if (!select) return;
  const days = Array.isArray(sched?.days) && sched.days.length
    ? sched.days
    : [{ name: 'Day 1', start_time: '08:00', end_time: '18:00' }];
  const active = Math.max(0, Math.min(Number(sched?.active_day_index || 0), days.length - 1));
  if (document.activeElement === select) return;
  select.innerHTML = days.map((day, idx) => {
    const name = String(day.name || `Day ${idx + 1}`);
    return `<option value="${idx}" ${idx === active ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('');
}

function syncDayTimeInputs(sched) {
  const dayIndex = Number(sched?.active_day_index || 0);
  const day = (sched?.days || [])[dayIndex] || { start_time: '08:00', end_time: '18:00' };
  const startInput = document.getElementById('schedDayStart');
  const endInput = document.getElementById('schedDayEnd');
  if (startInput && document.activeElement !== startInput) {
    startInput.value = String(day.start_time || '08:00');
  }
  if (endInput && document.activeElement !== endInput) {
    endInput.value = String(day.end_time || '18:00');
  }
}

export function renderSchedule() {
  const sched = state.scheduleState;
  const saveScheduleBtn = document.getElementById('saveScheduleBtn');
  if (saveScheduleBtn) saveScheduleBtn.disabled = !(sched?.catalog?.length);

  if (!sched?.catalog?.length) {
    const board = document.getElementById('scheduleBoard');
    const body = document.getElementById('scheduleCatalogBody');
    const scratch = document.getElementById('scheduleScratchList');
    if (board) board.innerHTML = '';
    if (body) body.innerHTML = '';
    if (scratch) scratch.innerHTML = '<li class="da-hint">empty</li>';
    return;
  }

  ensurePackOrder(sched);
  if (!(state.scheduleSelectedIds instanceof Set)) {
    state.scheduleSelectedIds = new Set();
  }
  const valid = new Set((sched.catalog || []).map((e) => String(e.id)));
  [...state.scheduleSelectedIds].forEach((id) => {
    if (!valid.has(id)) state.scheduleSelectedIds.delete(id);
  });

  const ringCount = Math.max(1, Number(sched.ring_count || 3));

  const ringInput = document.getElementById('scheduleRingCount');
  if (ringInput && document.activeElement !== ringInput) {
    ringInput.value = String(ringCount);
  }

  syncDaySelect(sched);
  syncDayTimeInputs(sched);
  renderCatalog(sched);
  renderBoard(sched);
  renderScratch(sched);
}

function selectedIds() {
  return [...state.scheduleSelectedIds];
}

function applyBulkDurations(ids) {
  const sched = state.scheduleState;
  if (!sched || !ids.length) return false;
  const matchRaw = document.getElementById('schedBulkMatch')?.value;
  const bufferRaw = document.getElementById('schedBulkBuffer')?.value;
  const hasMatch = matchRaw !== '' && matchRaw != null;
  const hasBuffer = bufferRaw !== '' && bufferRaw != null;
  if (!hasMatch && !hasBuffer) return false;
  sched.match_durations = sched.match_durations || {};
  sched.buffer_durations = sched.buffer_durations || {};
  ids.forEach((id) => {
    if (hasMatch) sched.match_durations[id] = Math.max(0, parseFloat(matchRaw) || 0);
    if (hasBuffer) sched.buffer_durations[id] = Math.max(0, parseFloat(bufferRaw) || 0);
  });
  return true;
}

function moveSelectedInPackOrder(delta) {
  const sched = state.scheduleState;
  if (!sched) return;
  ensurePackOrder(sched);
  const order = [...sched.pack_order];
  const selected = selectedIds().filter((id) => order.includes(id));
  if (!selected.length) return;

  if (delta < 0) {
    for (let i = 0; i < order.length; i += 1) {
      if (!selected.includes(order[i])) continue;
      if (i === 0) continue;
      if (selected.includes(order[i - 1])) continue;
      const tmp = order[i - 1];
      order[i - 1] = order[i];
      order[i] = tmp;
    }
  } else {
    for (let i = order.length - 1; i >= 0; i -= 1) {
      if (!selected.includes(order[i])) continue;
      if (i === order.length - 1) continue;
      if (selected.includes(order[i + 1])) continue;
      const tmp = order[i + 1];
      order[i + 1] = order[i];
      order[i] = tmp;
    }
  }
  sched.pack_order = order;
}

function sendToScratch(ids) {
  const sched = state.scheduleState;
  if (!sched || !ids.length) return;
  sched.scratch_ids = sched.scratch_ids || [];
  ids.forEach((id) => {
    if (sched.placements) delete sched.placements[id];
    if (!sched.scratch_ids.includes(id)) sched.scratch_ids.push(id);
  });
}

function bindScheduleSplitter() {
  const layout = document.getElementById('scheduleLayout');
  const splitter = document.getElementById('scheduleSplitter');
  const left = document.getElementById('scheduleLeftPane');
  if (!layout || !splitter || !left) return;

  const stored = Number(sessionStorage.getItem('daScheduleLeftWidth') || 0);
  if (stored > 0) {
    layout.style.setProperty('--da-schedule-left-width', `${stored}px`);
  }

  let dragging = false;

  const onMove = (clientX) => {
    if (!dragging) return;
    const rect = layout.getBoundingClientRect();
    const minLeft = 280;
    const minRight = 300;
    const maxLeft = Math.max(minLeft, rect.width - minRight - 12);
    const next = Math.min(maxLeft, Math.max(minLeft, clientX - rect.left));
    layout.style.setProperty('--da-schedule-left-width', `${next}px`);
    sessionStorage.setItem('daScheduleLeftWidth', String(Math.round(next)));
  };

  splitter.addEventListener('pointerdown', (e) => {
    dragging = true;
    layout.classList.add('is-resizing');
    splitter.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  splitter.addEventListener('pointermove', (e) => onMove(e.clientX));

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    layout.classList.remove('is-resizing');
    try { splitter.releasePointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
  };

  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);

  splitter.addEventListener('keydown', (e) => {
    const current = left.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') {
      onMove(layout.getBoundingClientRect().left + current - 24);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      onMove(layout.getBoundingClientRect().left + current + 24);
      e.preventDefault();
    }
  });
}

function bindScheduleDragDrop({ toast } = {}) {
  const DND_TYPE = 'application/x-da-schedule';
  let activeDrag = null;

  const setPayload = (dt, payload) => {
    activeDrag = payload;
    const raw = JSON.stringify(payload);
    dt.setData(DND_TYPE, raw);
    dt.setData('text/plain', raw);
    dt.effectAllowed = 'move';
  };

  const clearDropTargets = () => {
    document.getElementById('scheduleScratchDrop')?.classList.remove('is-drop-target');
    document.getElementById('scheduleBoardDrop')?.classList.remove('is-drop-target');
  };

  document.getElementById('scheduleBoard')?.addEventListener('dragstart', (e) => {
    const block = e.target.closest('.da-schedule-block[data-id]');
    if (!block || !e.dataTransfer) return;
    block.classList.add('da-dragging');
    setPayload(e.dataTransfer, { id: block.getAttribute('data-id'), from: 'board' });
  });

  document.getElementById('scheduleBoard')?.addEventListener('dragend', (e) => {
    e.target.closest('.da-schedule-block')?.classList.remove('da-dragging');
    activeDrag = null;
    clearDropTargets();
  });

  document.getElementById('scheduleScratchList')?.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.da-schedule-scratch-item[data-id]');
    if (!item || !e.dataTransfer) return;
    item.classList.add('da-dragging');
    setPayload(e.dataTransfer, { id: item.getAttribute('data-id'), from: 'scratch' });
  });

  document.getElementById('scheduleScratchList')?.addEventListener('dragend', (e) => {
    e.target.closest('.da-schedule-scratch-item')?.classList.remove('da-dragging');
    activeDrag = null;
    clearDropTargets();
  });

  const scratchDrop = document.getElementById('scheduleScratchDrop');
  scratchDrop?.addEventListener('dragover', (e) => {
    if (!activeDrag || activeDrag.from !== 'board') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    scratchDrop.classList.add('is-drop-target');
  });
  scratchDrop?.addEventListener('dragleave', (e) => {
    if (!scratchDrop.contains(e.relatedTarget)) scratchDrop.classList.remove('is-drop-target');
  });
  scratchDrop?.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropTargets();
    const payload = activeDrag;
    activeDrag = null;
    if (!payload || payload.from !== 'board') return;
    sendToScratch([payload.id]);
    renderSchedule();
    toast?.('moved to scratch.');
  });

  const boardDrop = document.getElementById('scheduleBoardDrop');
  boardDrop?.addEventListener('dragover', (e) => {
    if (!activeDrag || activeDrag.from !== 'scratch') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    boardDrop.classList.add('is-drop-target');
  });
  boardDrop?.addEventListener('dragleave', (e) => {
    if (!boardDrop.contains(e.relatedTarget)) boardDrop.classList.remove('is-drop-target');
  });
  boardDrop?.addEventListener('drop', async (e) => {
    e.preventDefault();
    clearDropTargets();
    const payload = activeDrag;
    activeDrag = null;
    if (!payload || payload.from !== 'scratch') return;
    try {
      const result = await packScheduleIds([payload.id], {
        replaceExisting: true,
        dayOnly: true
      });
      toast?.(
        result.placed
          ? 'placed from scratch.'
          : (result.skipped ? 'could not place (check duration / room).' : 'placed from scratch.')
      );
    } catch (err) {
      toast?.(err.message, true);
    }
  });
}

export async function packScheduleIds(divisionIds, {
  replaceExisting = true,
  startDayIndex = null,
  dayOnly = false,
  render = true
} = {}) {
  const sched = state.scheduleState;
  if (!sched) throw new Error('no schedule.');
  const eventId = state.eventId;
  if (!eventId) throw new Error('select an event first.');
  ensurePackOrder(sched);
  const ids = (divisionIds || []).map(String);
  sched.scratch_ids = (sched.scratch_ids || []).filter((id) => !ids.includes(id));
  const dayIndex = startDayIndex == null
    ? Number(sched.active_day_index || 0)
    : Number(startDayIndex);

  const { apiFetch } = await import('./api.js');
  const result = await apiFetch(`/api/division-advanced/events/${eventId}/schedule/pack`, {
    method: 'POST',
    body: JSON.stringify({
      state: sched,
      divisionIds: ids,
      replaceExisting,
      startDayIndex: dayIndex,
      dayOnly
    })
  });
  state.scheduleState = result.state;
  if (render) renderSchedule();
  return result;
}

function ensureDayAt(dayIndex, template) {
  const sched = state.scheduleState;
  if (!sched) return;
  if (!Array.isArray(sched.days)) sched.days = [];
  while (dayIndex >= sched.days.length) {
    const n = sched.days.length + 1;
    sched.days.push({
      name: `Day ${n}`,
      start_time: String(template?.start_time || '08:00'),
      end_time: String(template?.end_time || '18:00')
    });
  }
}

/** Place all pack-order divisions from the active day onward, adding days when needed. */
export async function placeAllSchedule() {
  const sched = state.scheduleState;
  if (!sched) throw new Error('no schedule.');
  ensurePackOrder(sched);
  const placeable = (sched.pack_order || []).filter((id) => {
    const entry = (sched.catalog || []).find((e) => String(e.id) === String(id));
    return entry && displayDuration(entry, sched) > 0;
  });
  if (!placeable.length) throw new Error('no divisions with durations to place.');

  placeable.forEach((id) => {
    delete sched.placements[id];
  });
  sched.scratch_ids = (sched.scratch_ids || []).filter((id) => !placeable.includes(String(id)));
  sched.pack_next_ring = 0;

  let remaining = [...placeable];
  let dayIndex = Number(sched.active_day_index || 0);
  const template = sched.days?.[dayIndex] || sched.days?.[0] || {
    start_time: '08:00',
    end_time: '18:00'
  };
  let totalPlaced = 0;
  let guard = 0;

  while (remaining.length && guard < 64) {
    guard += 1;
    ensureDayAt(dayIndex, template);

    const result = await packScheduleIds(remaining, {
      replaceExisting: false,
      startDayIndex: dayIndex,
      dayOnly: true,
      render: false
    });
    totalPlaced += Number(result.placed || 0);
    remaining = remaining.filter((id) => !state.scheduleState.placements?.[String(id)]);

    if (!remaining.length) break;

    if (Number(result.placed || 0) === 0) {
      // Day couldn't take any remaining — try a fresh next day once.
      dayIndex += 1;
      ensureDayAt(dayIndex, template);
      const retry = await packScheduleIds(remaining, {
        replaceExisting: false,
        startDayIndex: dayIndex,
        dayOnly: true,
        render: false
      });
      totalPlaced += Number(retry.placed || 0);
      remaining = remaining.filter((id) => !state.scheduleState.placements?.[String(id)]);
      if (Number(retry.placed || 0) === 0) {
        // Still nothing — remaining don't fit the day window.
        break;
      }
      if (remaining.length) dayIndex += 1;
    } else {
      dayIndex += 1;
    }
  }

  renderSchedule();
  return { placed: totalPlaced, skipped: remaining.length, remaining };
}

export function bindSchedulePanel({ showToast, showConfirmModal } = {}) {
  if (state.scheduleUiBound) return;
  state.scheduleUiBound = true;
  const toast = (msg, isErr) => {
    if (typeof showToast === 'function') showToast(msg, isErr);
  };
  const confirm = async (opts) => {
    if (typeof showConfirmModal === 'function') return showConfirmModal(opts);
    return window.confirm(opts?.message || 'confirm?');
  };

  bindScheduleSplitter();
  bindScheduleDragDrop({ toast });

  const refilter = () => renderSchedule();
  ['schedFilterColor', 'schedFilterBlack', 'schedAgeMin', 'schedAgeMax', 'schedSortMode']
    .forEach((id) => {
      document.getElementById(id)?.addEventListener('change', refilter);
      document.getElementById(id)?.addEventListener('input', refilter);
    });

  document.getElementById('schedSelectAllShown')?.addEventListener('change', (e) => {
    const sched = state.scheduleState;
    if (!sched) return;
    const checked = e.target.checked;
    visibleEntries(sched).forEach((entry) => {
      const id = String(entry.id);
      if (checked) state.scheduleSelectedIds.add(id);
      else state.scheduleSelectedIds.delete(id);
    });
    renderSchedule();
  });

  document.getElementById('scheduleCatalogBody')?.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const id = t.getAttribute('data-id');
    if (!id || !state.scheduleState) return;

    if (t.classList.contains('sched-row-check')) {
      if (t.checked) state.scheduleSelectedIds.add(id);
      else state.scheduleSelectedIds.delete(id);
      renderSchedule();
      return;
    }

    if (t.classList.contains('sched-dur-match')) {
      state.scheduleState.match_durations = state.scheduleState.match_durations || {};
      state.scheduleState.match_durations[id] = Math.max(0, parseFloat(t.value) || 0);
      renderSchedule();
      return;
    }
    if (t.classList.contains('sched-dur-buffer')) {
      state.scheduleState.buffer_durations = state.scheduleState.buffer_durations || {};
      state.scheduleState.buffer_durations[id] = Math.max(0, parseFloat(t.value) || 0);
      renderSchedule();
    }
  });

  document.getElementById('scheduleCatalogBody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr || e.target.closest('input')) return;
    const id = tr.getAttribute('data-id');
    if (!id) return;
    if (state.scheduleSelectedIds.has(id)) state.scheduleSelectedIds.delete(id);
    else state.scheduleSelectedIds.add(id);
    renderSchedule();
  });

  document.getElementById('schedBulkSelectedBtn')?.addEventListener('click', () => {
    const ids = selectedIds();
    if (!ids.length) return toast('select divisions first.', true);
    if (!applyBulkDurations(ids)) return toast('enter match and/or buffer minutes.', true);
    renderSchedule();
    toast('durations applied to selected.');
  });

  document.getElementById('schedBulkShownBtn')?.addEventListener('click', () => {
    const sched = state.scheduleState;
    if (!sched) return;
    const ids = visibleEntries(sched).map((e) => String(e.id));
    if (!ids.length) return toast('no divisions shown.', true);
    if (!applyBulkDurations(ids)) return toast('enter match and/or buffer minutes.', true);
    renderSchedule();
    toast('durations applied to shown.');
  });

  document.getElementById('schedClearDurationsBtn')?.addEventListener('click', () => {
    const sched = state.scheduleState;
    if (!sched) return;
    const ids = selectedIds().length
      ? selectedIds()
      : visibleEntries(sched).map((e) => String(e.id));
    if (!ids.length) return toast('no divisions to clear.', true);
    sched.match_durations = sched.match_durations || {};
    sched.buffer_durations = sched.buffer_durations || {};
    ids.forEach((id) => {
      delete sched.match_durations[id];
      delete sched.buffer_durations[id];
    });
    renderSchedule();
    toast(`cleared durations for ${ids.length} division(s).`);
  });

  document.getElementById('schedOrderUpBtn')?.addEventListener('click', () => {
    if (!selectedIds().length) return toast('select divisions to reorder.', true);
    moveSelectedInPackOrder(-1);
    const sort = document.getElementById('schedSortMode');
    if (sort) sort.value = 'pack';
    renderSchedule();
  });

  document.getElementById('schedOrderDownBtn')?.addEventListener('click', () => {
    if (!selectedIds().length) return toast('select divisions to reorder.', true);
    moveSelectedInPackOrder(1);
    const sort = document.getElementById('schedSortMode');
    if (sort) sort.value = 'pack';
    renderSchedule();
  });

  document.getElementById('schedClearPlacementsBtn')?.addEventListener('click', () => {
    const sched = state.scheduleState;
    if (!sched) return;
    sched.placements = {};
    sched.pack_next_ring = 0;
    renderSchedule();
    toast('all placements cleared.');
  });

  document.getElementById('schedClearDayBtn')?.addEventListener('click', () => {
    const sched = state.scheduleState;
    if (!sched) return;
    const dayIndex = Number(sched.active_day_index || 0);
    Object.keys(sched.placements || {}).forEach((id) => {
      if (Number(sched.placements[id]?.day_index || 0) === dayIndex) {
        delete sched.placements[id];
      }
    });
    if (sched.breaks) {
      Object.keys(sched.breaks).forEach((id) => {
        if (Number(sched.breaks[id]?.day_index || 0) === dayIndex) {
          delete sched.breaks[id];
        }
      });
    }
    sched.pack_next_ring = 0;
    renderSchedule();
    toast('cleared placements on this day.');
  });

  document.getElementById('schedDaySelect')?.addEventListener('change', (e) => {
    const sched = state.scheduleState;
    if (!sched) return;
    const idx = Number(e.target.value);
    if (!Number.isFinite(idx)) return;
    sched.active_day_index = Math.max(0, Math.min(idx, (sched.days || []).length - 1));
    renderSchedule();
  });

  document.getElementById('schedAddDayBtn')?.addEventListener('click', () => {
    const sched = state.scheduleState;
    if (!sched) return toast('generate schedule first.', true);
    if (!Array.isArray(sched.days)) sched.days = [];
    const n = sched.days.length + 1;
    sched.days.push({ name: `Day ${n}`, start_time: '08:00', end_time: '18:00' });
    sched.active_day_index = sched.days.length - 1;
    renderSchedule();
    toast(`added Day ${n}.`);
  });

  document.getElementById('schedRemoveDayBtn')?.addEventListener('click', async () => {
    const sched = state.scheduleState;
    if (!sched) return;
    if (!Array.isArray(sched.days) || sched.days.length <= 1) {
      return toast('at least one day is required.', true);
    }
    const idx = Number(sched.active_day_index || 0);
    const name = sched.days[idx]?.name || `Day ${idx + 1}`;
    const ok = await confirm({
      title: 'remove day',
      message: `remove ${name}? placements on that day will be cleared.`,
      confirmLabel: 'remove'
    });
    if (!ok) return;

    Object.entries(sched.placements || {}).forEach(([id, placement]) => {
      const dayIndex = Number(placement.day_index || 0);
      if (dayIndex === idx) delete sched.placements[id];
      else if (dayIndex > idx) placement.day_index = dayIndex - 1;
    });
    if (sched.breaks) {
      Object.entries(sched.breaks).forEach(([id, block]) => {
        const dayIndex = Number(block.day_index || 0);
        if (dayIndex === idx) delete sched.breaks[id];
        else if (dayIndex > idx) block.day_index = dayIndex - 1;
      });
    }
    sched.days.splice(idx, 1);
    sched.active_day_index = Math.min(idx, sched.days.length - 1);
    renderSchedule();
    toast('day removed.');
  });

  document.getElementById('schedApplyDayTimesBtn')?.addEventListener('click', () => {
    const sched = state.scheduleState;
    if (!sched) return toast('generate schedule first.', true);
    const startRaw = String(document.getElementById('schedDayStart')?.value || '').trim();
    const endRaw = String(document.getElementById('schedDayEnd')?.value || '').trim();
    if (parseHhmm(startRaw) == null || parseHhmm(endRaw) == null) {
      syncDayTimeInputs(sched);
      return toast('start and end must be HH:MM (e.g. 08:00).', true);
    }
    if (!Array.isArray(sched.days) || !sched.days.length) {
      sched.days = [{ name: 'Day 1', start_time: startRaw, end_time: endRaw }];
    }
    const dayIndex = Number(sched.active_day_index || 0);
    const day = sched.days[dayIndex] || sched.days[0];
    day.start_time = startRaw;
    day.end_time = endRaw;
    renderSchedule();
    toast('day times updated.');
  });

  ['schedDayStart', 'schedDayEnd'].forEach((id) => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('schedApplyDayTimesBtn')?.click();
      }
    });
  });

  document.getElementById('schedPlaceAllBtn')?.addEventListener('click', async () => {
    try {
      const result = await placeAllSchedule();
      const days = (state.scheduleState?.days || []).length;
      toast(
        `placed ${result.placed}` +
          (result.skipped ? ` · ${result.skipped} skipped` : '') +
          ` · ${days} day(s)`
      );
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('scheduleScratchList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.da-schedule-scratch-item[data-id]');
    if (!item) return;
    const id = item.getAttribute('data-id');
    if (!id) return;
    if (state.scheduleSelectedIds.has(id)) state.scheduleSelectedIds.delete(id);
    else state.scheduleSelectedIds.add(id);
    renderSchedule();
  });

  document.getElementById('scheduleRingCount')?.addEventListener('change', () => {
    const sched = state.scheduleState;
    if (!sched) return;
    const rings = Math.max(1, Math.min(32, Number(document.getElementById('scheduleRingCount')?.value || 3)));
    sched.ring_count = rings;
    renderSchedule();
  });
}
