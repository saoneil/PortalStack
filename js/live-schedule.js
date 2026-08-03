const DEFAULT_MATCH = 3;
const DEFAULT_BUFFER = 0.5;
const SLOT = 5;
const GAP = 5;
const POLL_MS = 15000;
const NOW_SCROLL_MS = 30000;
const TIMELINE_HEADER_H = 28;

const ctx = {
  clientId: '',
  eventId: '',
  event: null,
  state: null,
  canEdit: false,
  updatedAt: null,
  timezone: '',
  dirty: false,
  selectedId: '',
  contextId: '',
  pollTimer: null,
  nowScrollTimer: null,
  nowResizeBound: false,
  dragBound: false,
  contextBound: false
};

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseRoute() {
  const parts = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] === 'live-schedule' && parts.length >= 3) {
    return { clientId: decodeURIComponent(parts[1]), eventId: decodeURIComponent(parts[2]) };
  }
  return { clientId: '', eventId: '' };
}

function showToast(message, isError = false) {
  const el = document.getElementById('liveToast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : {};
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function parseHhmm(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 47 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
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

function catalogEntry(id) {
  return (ctx.state?.catalog || []).find((e) => String(e.id) === String(id)) || null;
}

function markDirty() {
  if (!ctx.canEdit) return;
  ctx.dirty = true;
  const saveBtn = document.getElementById('liveSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Save*';
}

function clearDirty() {
  ctx.dirty = false;
  const saveBtn = document.getElementById('liveSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Save';
}

function stopPolling() {
  if (ctx.pollTimer) {
    clearInterval(ctx.pollTimer);
    ctx.pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  if (ctx.canEdit) return;
  ctx.pollTimer = setInterval(() => {
    refreshSchedule({ silent: true }).catch(() => {});
  }, POLL_MS);
}

function stopNowScroll() {
  if (ctx.nowScrollTimer) {
    clearInterval(ctx.nowScrollTimer);
    ctx.nowScrollTimer = null;
  }
}

function activeDay() {
  const sched = ctx.state;
  if (!sched) return { name: 'Day 1', start_time: '08:00', end_time: '18:00' };
  const dayIndex = Number(sched.active_day_index || 0);
  return (sched.days || [])[dayIndex] || { name: 'Day 1', start_time: '08:00', end_time: '18:00' };
}

function detectBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (_) {
    return '';
  }
}

function isValidTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch (_) {
    return false;
  }
}

function resolveTimeZone() {
  if (isValidTimeZone(ctx.timezone)) return ctx.timezone;
  if (isValidTimeZone(ctx.state?.timezone)) return ctx.state.timezone;
  const browserTz = detectBrowserTimeZone();
  if (isValidTimeZone(browserTz)) return browserTz;
  return 'America/Halifax';
}

function nowClockMinutes() {
  const timeZone = resolveTimeZone();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  return Number(map.hour) * 60 + Number(map.minute) + Number(map.second || 0) / 60;
}

async function syncUserTimeZone() {
  const browserTz = detectBrowserTimeZone();
  if (isValidTimeZone(browserTz)) {
    ctx.timezone = browserTz;
    try {
      await apiFetch('/api/profile/timezone', {
        method: 'POST',
        body: JSON.stringify({ timezone: browserTz })
      });
    } catch (_) {
      // Not logged in / public viewer — browser timezone is enough for local display.
    }
    return;
  }
  if (!ctx.timezone) ctx.timezone = 'America/Halifax';
}

function nowOffsetMinutes(day) {
  const startAbs = parseHhmm(day?.start_time || '08:00') ?? 8 * 60;
  const windowMins = dayWindowMinutes(day);
  let nowAbs = nowClockMinutes();
  let endAbs = parseHhmm(day?.end_time || '18:00') ?? 18 * 60;
  if (endAbs <= startAbs && nowAbs < startAbs) {
    nowAbs += 24 * 60;
  }
  return Math.max(0, Math.min(windowMins, nowAbs - startAbs));
}

function timelineSlotHeight(timeline) {
  const raw = getComputedStyle(timeline).getPropertyValue('--da-sched-slot-h');
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 34;
}

function timelineHeaderHeight(timeline) {
  const head = timeline.querySelector('.da-schedule-timeline-ring-head, .da-schedule-timeline-corner');
  if (!head) return TIMELINE_HEADER_H;
  const height = head.getBoundingClientRect().height;
  return height > 0 ? height : TIMELINE_HEADER_H;
}

function scrollBoardToNow({ smooth = true } = {}) {
  const wrap = document.getElementById('liveBoardDrop');
  const timeline = wrap?.querySelector('.da-schedule-timeline');
  const line = timeline?.querySelector('.live-now-line');
  if (!wrap || !timeline || !ctx.state) return;

  const day = activeDay();
  const startAbs = parseHhmm(day.start_time) ?? 8 * 60;
  const offset = nowOffsetMinutes(day);
  const slotH = timelineSlotHeight(timeline);
  const headerH = timelineHeaderHeight(timeline);
  const targetY = headerH + (offset / SLOT) * slotH;
  const labelMins = startAbs + offset;

  if (line) {
    line.style.top = `${targetY}px`;
    line.setAttribute('data-label', formatHhmm(((labelMins % (24 * 60)) + (24 * 60)) % (24 * 60)));
    line.hidden = false;
  }

  // Board wrap must be height-constrained for this to move the now-line into view.
  if (wrap.scrollHeight <= wrap.clientHeight + 1) {
    return;
  }

  // Center using live geometry so nested offsets/padding stay correct.
  const wrapRect = wrap.getBoundingClientRect();
  const lineRect = line?.getBoundingClientRect();
  if (!lineRect) {
    wrap.scrollTo({
      top: Math.max(0, targetY - (wrap.clientHeight / 2)),
      behavior: smooth ? 'smooth' : 'auto'
    });
    return;
  }

  const lineCenter = lineRect.top + (lineRect.height / 2);
  const wrapCenter = wrapRect.top + (wrap.clientHeight / 2);
  const delta = lineCenter - wrapCenter;
  const nextTop = Math.max(0, Math.min(wrap.scrollHeight - wrap.clientHeight, wrap.scrollTop + delta));

  wrap.scrollTo({
    top: nextTop,
    behavior: smooth ? 'smooth' : 'auto'
  });
}

function startNowScroll() {
  stopNowScroll();
  const run = (smooth) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollBoardToNow({ smooth });
        // Second pass after layout/fonts settle.
        window.setTimeout(() => scrollBoardToNow({ smooth: false }), smooth ? 350 : 50);
      });
    });
  };
  run(false);
  ctx.nowScrollTimer = setInterval(() => run(true), NOW_SCROLL_MS);
  if (!ctx.nowResizeBound) {
    ctx.nowResizeBound = true;
    window.addEventListener('resize', () => {
      scrollBoardToNow({ smooth: false });
    });
  }
}

function sendToScratch(ids) {
  const sched = ctx.state;
  if (!sched || !ids.length) return;
  sched.scratch_ids = sched.scratch_ids || [];
  ids.forEach((id) => {
    if (sched.placements) delete sched.placements[id];
    if (!sched.scratch_ids.includes(id)) sched.scratch_ids.push(id);
  });
  markDirty();
}

function ringDayBlocks(dayIndex, ringIndex, excludeId = null) {
  const sched = ctx.state;
  const blocks = [];
  Object.entries(sched.placements || {}).forEach(([id, placement]) => {
    if (excludeId != null && String(id) === String(excludeId)) return;
    if (Number(placement.day_index || 0) !== Number(dayIndex)) return;
    if (Number(placement.ring_index || 0) !== Number(ringIndex)) return;
    const entry = catalogEntry(id);
    if (!entry) return;
    const start = Number(placement.start_offset_minutes || 0);
    const duration = displayDuration(entry, sched);
    blocks.push({ id: String(id), placement, start, duration, end: start + duration });
  });
  blocks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return blocks;
}

function pushSubsequentOnRing(anchorId) {
  const sched = ctx.state;
  const placement = sched?.placements?.[anchorId];
  const entry = catalogEntry(anchorId);
  if (!placement || !entry) return;

  const dayIndex = Number(placement.day_index || 0);
  const ringIndex = Number(placement.ring_index || 0);
  const myStart = Number(placement.start_offset_minutes || 0);
  const myDuration = displayDuration(entry, sched);
  let frontier = myStart + myDuration + GAP;

  const subsequent = ringDayBlocks(dayIndex, ringIndex, anchorId)
    .filter((block) => block.start >= myStart);

  subsequent.forEach((block) => {
    if (block.start < frontier) {
      block.placement.start_offset_minutes = frontier;
      frontier = frontier + block.duration + GAP;
    } else {
      frontier = block.start + block.duration + GAP;
    }
  });
}

function setMatchDurationForTargetTotal(id, targetMinutes) {
  const sched = ctx.state;
  const entry = catalogEntry(id);
  if (!sched || !entry) return;
  const mc = Math.max(1, matchCount(entry));
  const target = Math.max(SLOT, targetMinutes);
  if (!sched.match_durations) sched.match_durations = {};
  if (!sched.buffer_durations) sched.buffer_durations = {};
  if (sched.buffer_durations[id] == null) sched.buffer_durations[id] = DEFAULT_BUFFER;
  const buffer = Number(sched.buffer_durations[id] || 0) || 0;
  const matchNeeded = Math.max(0, (target / mc) - buffer);
  sched.match_durations[id] = Math.round(matchNeeded * 1000) / 1000;
}

function adjustDurationSlots(id, slotDelta) {
  const sched = ctx.state;
  const entry = catalogEntry(id);
  if (!sched || !entry || !sched.placements?.[id]) return;

  const current = displayDuration(entry, sched);
  const target = Math.max(SLOT, current + slotDelta * SLOT);
  if (target === current) return;

  setMatchDurationForTargetTotal(id, target);

  if (target > current) {
    pushSubsequentOnRing(id);
  }

  markDirty();
  renderViewer();
  showToast(slotDelta > 0 ? 'Lengthened division.' : 'Shortened division.');
}

async function packFromScratch(id) {
  const sched = ctx.state;
  if (!sched) return;
  sched.scratch_ids = (sched.scratch_ids || []).filter((x) => String(x) !== String(id));
  const result = await apiFetch(`/api/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(ctx.eventId)}/pack`, {
    method: 'POST',
    body: JSON.stringify({
      state: sched,
      divisionIds: [id],
      replaceExisting: true,
      dayOnly: true,
      startDayIndex: Number(sched.active_day_index || 0)
    })
  });
  ctx.state = result.state;
  markDirty();
  renderViewer();
  showToast(
    result.placed
      ? 'Placed from scratch.'
      : (result.skipped ? 'Could not place (check duration / room).' : 'Placed from scratch.')
  );
}

function hideContextMenu() {
  const menu = document.getElementById('liveContextMenu');
  if (menu) menu.hidden = true;
  ctx.contextId = '';
}

function showContextMenu(x, y, id) {
  const menu = document.getElementById('liveContextMenu');
  if (!menu || !ctx.canEdit) return;
  ctx.contextId = String(id);
  ctx.selectedId = String(id);
  menu.hidden = false;
  const pad = 8;
  const rect = menu.getBoundingClientRect();
  const width = rect.width || 180;
  const height = rect.height || 90;
  const left = Math.min(x, window.innerWidth - width - pad);
  const top = Math.min(y, window.innerHeight - height - pad);
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top = `${Math.max(pad, top)}px`;
  document.querySelectorAll('#liveBoard .da-schedule-block.is-selected').forEach((el) => {
    el.classList.remove('is-selected');
  });
  const selected = document.querySelector(`#liveBoard .da-schedule-block[data-id="${CSS.escape(String(id))}"]`);
  if (selected) selected.classList.add('is-selected');
}

function renderBoard() {
  const board = document.getElementById('liveBoard');
  const sched = ctx.state;
  if (!board || !sched) return;

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
    const entry = catalogEntry(id);
    if (!entry) return;
    const start = Number(placement.start_offset_minutes || 0);
    const duration = displayDuration(entry, sched);
    byRing[ring].push({
      id,
      name: entry.division_name,
      start,
      end: start + duration,
      duration
    });
  });
  byRing.forEach((list) => list.sort((a, b) => a.start - b.start));

  const timeLabels = Array.from({ length: slotCount }, (_, i) => formatHhmm(startAbs + i * SLOT));
  const gridCols = `var(--da-sched-time-w, 72px) repeat(${ringCount}, minmax(160px, 1fr))`;
  const draggable = ctx.canEdit ? 'true' : 'false';

  board.innerHTML = `
    <div class="da-schedule-timeline" style="--da-sched-slots:${slotCount}; --da-sched-cols:${ringCount}; grid-template-columns:${gridCols};">
      <div class="da-schedule-timeline-corner">time</div>
      ${Array.from({ length: ringCount }, (_, ring) => `
        <div class="da-schedule-timeline-ring-head">Ring ${ring + 1}</div>
      `).join('')}
      <div class="da-schedule-time-axis" aria-hidden="true">
        ${timeLabels.map((label) => `<div class="da-schedule-time-tick">${label}</div>`).join('')}
      </div>
      ${byRing.map((list, ring) => `
        <div class="da-schedule-ring-lane" data-ring="${ring}">
          ${list.map((block) => {
            const topSlots = block.start / SLOT;
            const heightSlots = Math.max(1, block.duration / SLOT);
            const selected = ctx.selectedId === String(block.id) ? 'is-selected' : '';
            return `<div class="da-schedule-block ${selected}" data-id="${escapeHtml(block.id)}" data-slots="${heightSlots}" draggable="${draggable}"
              style="top:calc(${topSlots} * var(--da-sched-slot-h)); height:calc(${heightSlots} * var(--da-sched-slot-h) - 2px);">
              <strong title="${escapeHtml(block.name)}">${escapeHtml(block.name)}</strong>
              <span>${fmtClock(startAbs, block.start)}–${fmtClock(startAbs, block.end)}</span>
            </div>`;
          }).join('')}
        </div>
      `).join('')}
      <div class="live-now-line" hidden aria-hidden="true"></div>
    </div>
  `;

  fitDivisionBlockText(board);
}

function fitDivisionBlockText(board) {
  const blocks = board?.querySelectorAll('.da-schedule-block') || [];
  blocks.forEach((block) => {
    const nameEl = block.querySelector('strong');
    const timeEl = block.querySelector('span');
    if (!nameEl || !timeEl) return;

    nameEl.style.fontSize = '';
    timeEl.style.fontSize = '';

    let size = 13;
    const minSize = 7;
    const overflows = () => (
      block.scrollHeight > block.clientHeight + 1
      || nameEl.scrollWidth > nameEl.clientWidth + 1
      || timeEl.scrollWidth > timeEl.clientWidth + 1
    );

    while (size > minSize && overflows()) {
      size -= 0.5;
      nameEl.style.fontSize = `${size}px`;
      timeEl.style.fontSize = `${Math.max(minSize, size - 1)}px`;
    }
  });
}

function renderScratch() {
  const list = document.getElementById('liveScratchList');
  const scratchPanel = document.getElementById('liveScratchDrop');
  const stage = document.getElementById('liveStage');
  if (!list || !scratchPanel || !stage) return;

  if (!ctx.canEdit) {
    scratchPanel.hidden = true;
    stage.classList.add('is-readonly');
    return;
  }

  scratchPanel.hidden = false;
  stage.classList.remove('is-readonly');
  const ids = ctx.state?.scratch_ids || [];
  if (!ids.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = ids.map((id) => {
    const entry = catalogEntry(id);
    const name = entry?.division_name || id;
    const selected = ctx.selectedId === String(id) ? 'selected' : '';
    return `<li class="live-scratch-item ${selected}" data-id="${escapeHtml(id)}" draggable="true">
      ${escapeHtml(name)}
    </li>`;
  }).join('');
}

function syncDaySelect() {
  const select = document.getElementById('liveDaySelect');
  const sched = ctx.state;
  if (!select || !sched) return;
  const days = Array.isArray(sched.days) && sched.days.length
    ? sched.days
    : [{ name: 'Day 1', start_time: '08:00', end_time: '18:00' }];
  const active = Math.max(0, Math.min(Number(sched.active_day_index || 0), days.length - 1));
  sched.active_day_index = active;
  if (document.activeElement === select) return;
  select.innerHTML = days.map((day, idx) => {
    const name = String(day.name || `Day ${idx + 1}`);
    return `<option value="${idx}" ${idx === active ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('');
}

function renderViewer() {
  const sched = ctx.state;
  if (!sched) return;
  syncDaySelect();
  renderBoard();
  renderScratch();

  const updated = document.getElementById('liveUpdatedAt');
  if (updated) {
    updated.textContent = ctx.updatedAt
      ? `Updated ${new Date(ctx.updatedAt).toLocaleString()}`
      : '';
  }

  const saveBtn = document.getElementById('liveSaveBtn');
  const refreshBtn = document.getElementById('liveRefreshBtn');
  if (saveBtn) saveBtn.hidden = !ctx.canEdit;
  if (refreshBtn) refreshBtn.hidden = !ctx.canEdit;

  const eventWrap = document.getElementById('liveEventSelectWrap');
  if (eventWrap && !ctx.canEdit) eventWrap.hidden = true;

  startNowScroll();
}

function setPanels({ picker = false, viewer = false, missing = false } = {}) {
  const pickerPanel = document.getElementById('livePickerPanel');
  if (pickerPanel && !picker) pickerPanel.hidden = true;
  document.getElementById('liveViewerPanel').hidden = !viewer;
  document.getElementById('liveMissingPanel').hidden = !missing;
}

function updateHeader() {
  const subtitle = document.getElementById('liveScheduleSubtitle');
  const qrBtn = document.getElementById('liveDownloadQrBtn');
  const backLink = document.getElementById('liveBackLink');
  if (backLink) backLink.hidden = !(ctx.canEdit || window.location.pathname === '/live-schedule');
  if (qrBtn) qrBtn.hidden = !(ctx.clientId && ctx.eventId);

  if (ctx.event) {
    const loc = ctx.event.location ? ` · ${ctx.event.location}` : '';
    subtitle.textContent = `${ctx.event.name}${loc}`;
    document.title = `${ctx.event.name} — Live Schedule`;
  } else if (ctx.clientId && ctx.eventId) {
    subtitle.textContent = `Client ${ctx.clientId} · Event ${ctx.eventId}`;
  } else {
    subtitle.textContent = 'Select a saved schedule to display';
    document.title = 'Live Event Schedule';
  }
}

function liveScheduleUrl() {
  return `${window.location.origin}/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(ctx.eventId)}`;
}

function downloadQrCode() {
  if (!ctx.clientId || !ctx.eventId) return;
  if (typeof QRCode === 'undefined') {
    showToast('QR library failed to load.', true);
    return;
  }

  const url = liveScheduleUrl();
  const qrContainer = document.createElement('div');
  qrContainer.style.display = 'none';
  document.body.appendChild(qrContainer);

  new QRCode(qrContainer, {
    text: url,
    width: 512,
    height: 512,
    correctLevel: QRCode.CorrectLevel.M
  });

  setTimeout(() => {
    const canvas = qrContainer.querySelector('canvas');
    if (!canvas) {
      showToast('Unable to generate QR code.', true);
      document.body.removeChild(qrContainer);
      return;
    }
    canvas.toBlob((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = String(ctx.event?.name || `event_${ctx.eventId}`)
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || `event_${ctx.eventId}`;
      a.href = objectUrl;
      a.download = `live_schedule_qr_${safeName}_${ctx.eventId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      document.body.removeChild(qrContainer);
      showToast('QR code downloaded.');
    });
  }, 100);
}

async function refreshSchedule({ silent = false } = {}) {
  if (!ctx.clientId || !ctx.eventId) return;
  if (silent && ctx.dirty) return;
  const data = await apiFetch(
    `/api/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(ctx.eventId)}`
  );
  if (silent && ctx.updatedAt && String(data.updated_at) === String(ctx.updatedAt) && !ctx.dirty) {
    return;
  }
  ctx.event = data.event;
  ctx.state = data.state;
  ctx.canEdit = Boolean(data.canEdit);
  ctx.updatedAt = data.updated_at;
  if (data.timezone && isValidTimeZone(data.timezone)) {
    ctx.timezone = data.timezone;
  } else if (data.state && isValidTimeZone(data.state.timezone)) {
    ctx.timezone = data.state.timezone;
  }
  clearDirty();
  setPanels({ viewer: true });
  updateHeader();
  renderViewer();
  if (ctx.canEdit) {
    await loadEventOptions({ selectedEventId: ctx.eventId });
  }
  startPolling();
  if (!silent) showToast(ctx.canEdit ? 'Schedule loaded.' : 'Schedule loaded.');
}

async function saveSchedule() {
  if (!ctx.canEdit || !ctx.state) return;
  const timezone = resolveTimeZone();
  ctx.timezone = timezone;
  ctx.state.timezone = timezone;
  const saved = await apiFetch(
    `/api/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(ctx.eventId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ state: ctx.state })
    }
  );
  ctx.state = saved.state;
  ctx.updatedAt = saved.updated_at;
  if (saved.timezone && isValidTimeZone(saved.timezone)) {
    ctx.timezone = saved.timezone;
  }
  clearDirty();
  renderViewer();
  showToast('Schedule saved.');
}

function bindDragDrop() {
  if (ctx.dragBound) return;
  ctx.dragBound = true;
  const DND_TYPE = 'application/x-live-schedule';
  let activeDrag = null;

  const setPayload = (dt, payload) => {
    activeDrag = payload;
    const raw = JSON.stringify(payload);
    dt.setData(DND_TYPE, raw);
    dt.setData('text/plain', raw);
    dt.effectAllowed = 'move';
  };

  const clearDropTargets = () => {
    document.getElementById('liveScratchDrop')?.classList.remove('is-drop-target');
    document.getElementById('liveBoardDrop')?.classList.remove('is-drop-target');
  };

  document.getElementById('liveBoard')?.addEventListener('dragstart', (e) => {
    if (!ctx.canEdit) return;
    const block = e.target.closest('.da-schedule-block[data-id]');
    if (!block || !e.dataTransfer) return;
    hideContextMenu();
    block.classList.add('da-dragging');
    setPayload(e.dataTransfer, { id: block.getAttribute('data-id'), from: 'board' });
  });

  document.getElementById('liveBoard')?.addEventListener('dragend', (e) => {
    e.target.closest('.da-schedule-block')?.classList.remove('da-dragging');
    activeDrag = null;
    clearDropTargets();
  });

  document.getElementById('liveScratchList')?.addEventListener('dragstart', (e) => {
    if (!ctx.canEdit) return;
    const item = e.target.closest('.live-scratch-item[data-id]');
    if (!item || !e.dataTransfer) return;
    hideContextMenu();
    item.classList.add('da-dragging');
    setPayload(e.dataTransfer, { id: item.getAttribute('data-id'), from: 'scratch' });
  });

  document.getElementById('liveScratchList')?.addEventListener('dragend', (e) => {
    e.target.closest('.live-scratch-item')?.classList.remove('da-dragging');
    activeDrag = null;
    clearDropTargets();
  });

  const scratchDrop = document.getElementById('liveScratchDrop');
  scratchDrop?.addEventListener('dragover', (e) => {
    if (!ctx.canEdit || !activeDrag || activeDrag.from !== 'board') return;
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
    if (!ctx.canEdit || !payload || payload.from !== 'board') return;
    sendToScratch([payload.id]);
    renderViewer();
    showToast('Moved to scratch.');
  });

  const boardDrop = document.getElementById('liveBoardDrop');
  boardDrop?.addEventListener('dragover', (e) => {
    if (!ctx.canEdit || !activeDrag || activeDrag.from !== 'scratch') return;
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
    if (!ctx.canEdit || !payload || payload.from !== 'scratch') return;
    try {
      await packFromScratch(payload.id);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function bindContextMenu() {
  if (ctx.contextBound) return;
  ctx.contextBound = true;

  document.getElementById('liveBoard')?.addEventListener('contextmenu', (e) => {
    if (!ctx.canEdit) return;
    const block = e.target.closest('.da-schedule-block[data-id]');
    if (!block) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, block.getAttribute('data-id'));
  });

  document.getElementById('liveContextMenu')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !ctx.contextId) return;
    const id = ctx.contextId;
    const action = btn.getAttribute('data-action');
    hideContextMenu();
    if (action === 'longer') adjustDurationSlots(id, 1);
    else if (action === 'shorter') adjustDurationSlots(id, -1);
  });

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('liveContextMenu');
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target)) return;
    hideContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });

  window.addEventListener('scroll', hideContextMenu, true);
  window.addEventListener('resize', hideContextMenu);
}

function bindViewerEvents() {
  document.getElementById('liveDaySelect')?.addEventListener('change', (e) => {
    if (!ctx.state) return;
    ctx.state.active_day_index = Number(e.target.value) || 0;
    if (ctx.canEdit) markDirty();
    hideContextMenu();
    renderViewer();
  });

  document.getElementById('liveBoard')?.addEventListener('click', (e) => {
    const block = e.target.closest('.da-schedule-block[data-id]');
    if (!block) return;
    ctx.selectedId = block.getAttribute('data-id');
    renderBoard();
  });

  document.getElementById('liveScratchList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.live-scratch-item[data-id]');
    if (!item) return;
    ctx.selectedId = item.getAttribute('data-id');
    renderViewer();
  });

  document.getElementById('liveSaveBtn')?.addEventListener('click', async () => {
    try {
      await saveSchedule();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('liveRefreshBtn')?.addEventListener('click', async () => {
    try {
      if (ctx.dirty && !window.confirm('Discard unsaved changes and reload?')) return;
      await refreshSchedule();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('liveDownloadQrBtn')?.addEventListener('click', () => {
    downloadQrCode();
  });

  bindDragDrop();
  bindContextMenu();
}

function formatOptionLabel(item) {
  const date = item.eventDateStart
    ? new Date(item.eventDateStart).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
    : '';
  return date ? `${item.eventName} (${date})` : item.eventName;
}

async function loadEventOptions({ selectedEventId = '' } = {}) {
  const wrap = document.getElementById('liveEventSelectWrap');
  const select = document.getElementById('liveScheduleSelect');
  const empty = document.getElementById('livePickerEmpty');
  const error = document.getElementById('livePickerError');
  const pickerPanel = document.getElementById('livePickerPanel');
  if (!wrap || !select) return false;

  if (empty) empty.hidden = true;
  if (error) error.hidden = true;
  if (pickerPanel) pickerPanel.hidden = true;

  try {
    const data = await apiFetch('/api/live-schedule/saved');
    ctx.clientId = data.clientId || ctx.clientId || '';
    const items = data.items || [];
    wrap.hidden = false;

    if (!items.length) {
      select.innerHTML = '<option value="">— no saved schedules —</option>';
      if (empty) empty.hidden = false;
      if (pickerPanel) pickerPanel.hidden = false;
      return true;
    }

    select.innerHTML = '<option value="">— choose a schedule —</option>' + items.map((item) => {
      return `<option value="${escapeHtml(item.eventId)}">${escapeHtml(formatOptionLabel(item))}</option>`;
    }).join('');

    if (selectedEventId) {
      select.value = String(selectedEventId);
    }
    return true;
  } catch (err) {
    wrap.hidden = true;
    if (error) {
      error.hidden = false;
      error.textContent = err.message || 'Unable to load saved schedules. Sign in as an organizer and try again.';
    }
    if (pickerPanel) pickerPanel.hidden = false;
    return false;
  }
}

async function showPicker() {
  stopPolling();
  stopNowScroll();
  setPanels({ viewer: true });
  updateHeader();
  const loaded = await loadEventOptions({ selectedEventId: ctx.eventId || '' });
  if (!loaded) return;
}

function bindPicker() {
  const select = document.getElementById('liveScheduleSelect');
  select?.addEventListener('change', async () => {
    const eventId = select.value;
    if (!eventId || !ctx.clientId) return;
    if (String(eventId) === String(ctx.eventId)) return;
    if (ctx.dirty && !window.confirm('Discard unsaved changes and switch events?')) {
      select.value = String(ctx.eventId || '');
      return;
    }
    window.location.href = `/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(eventId)}`;
  });
}

async function init() {
  bindPicker();
  bindViewerEvents();
  await syncUserTimeZone();

  const route = parseRoute();
  if (route.clientId && route.eventId) {
    ctx.clientId = route.clientId;
    ctx.eventId = route.eventId;
    updateHeader();
    try {
      await refreshSchedule();
    } catch (err) {
      setPanels({ viewer: true });
      const error = document.getElementById('livePickerError');
      const pickerPanel = document.getElementById('livePickerPanel');
      if (error) {
        error.hidden = false;
        error.textContent =
          err.message || 'This live schedule link is invalid or no schedule has been saved yet.';
      }
      if (pickerPanel) pickerPanel.hidden = false;
      updateHeader();
      await loadEventOptions({ selectedEventId: ctx.eventId });
    }
    return;
  }

  await showPicker();
}

init().catch((err) => {
  setPanels({ missing: true });
  document.getElementById('liveMissingMessage').textContent = err.message || 'Unable to open live schedule.';
});
