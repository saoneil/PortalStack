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
  mode: 'viewer',
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

function liveMode() {
  return new URLSearchParams(window.location.search).has('embed') ? 'tool' : 'viewer';
}

function isToolMode() {
  return ctx.mode === 'tool';
}

function scheduleHref(clientId, eventId) {
  const params = new URLSearchParams(window.location.search);
  const qs = params.toString();
  const path = `/live-schedule/${encodeURIComponent(clientId)}/${encodeURIComponent(eventId)}`;
  return qs ? `${path}?${qs}` : path;
}

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
  updateSaveButtonAppearance();
}

function clearDirty() {
  ctx.dirty = false;
  updateSaveButtonAppearance();
}

function updateSaveButtonAppearance() {
  const saveBtn = document.getElementById('liveSaveBtn');
  if (!saveBtn) return;
  saveBtn.textContent = ctx.dirty ? 'Save*' : 'Save';
  saveBtn.classList.toggle('is-dirty', Boolean(ctx.dirty && ctx.canEdit));
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

function scheduleDays(sched) {
  return Array.isArray(sched?.days) && sched.days.length
    ? sched.days
    : [{ name: 'Day 1', start_time: '08:00', end_time: '18:00' }];
}

function positionNowLine(timeline, day) {
  const line = timeline?.querySelector('.live-now-line');
  if (!timeline || !line || !day) return null;

  const startAbs = parseHhmm(day.start_time) ?? 8 * 60;
  const offset = nowOffsetMinutes(day);
  const windowMins = dayWindowMinutes(day);
  const slotH = timelineSlotHeight(timeline);
  const headerH = timelineHeaderHeight(timeline);
  const targetY = headerH + (offset / SLOT) * slotH;
  const labelMins = startAbs + offset;

  line.style.top = `${targetY}px`;
  line.setAttribute('data-label', formatHhmm(((labelMins % (24 * 60)) + (24 * 60)) % (24 * 60)));
  line.hidden = false;

  const inWindow = offset > 0 && offset < windowMins;
  return { line, inWindow };
}

function scrollBoardToNow({ smooth = true } = {}) {
  const wrap = document.getElementById('liveBoardDrop');
  if (!wrap || !ctx.state) return;

  const days = scheduleDays(ctx.state);
  const timelines = [...wrap.querySelectorAll('.da-schedule-timeline')];
  if (!timelines.length) return;

  let scrollLine = null;
  timelines.forEach((timeline) => {
    const dayIndex = Number(timeline.getAttribute('data-day-index') || 0);
    const day = days[dayIndex] || activeDay();
    const placed = positionNowLine(timeline, day);
    if (placed?.inWindow && !scrollLine) scrollLine = placed.line;
  });

  const line = scrollLine || timelines[0].querySelector('.live-now-line');
  if (!line) return;

  // Board wrap must be height-constrained for this to move the now-line into view.
  if (wrap.scrollHeight <= wrap.clientHeight + 1) {
    return;
  }

  const wrapRect = wrap.getBoundingClientRect();
  const lineRect = line.getBoundingClientRect();
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

function resolveRingAfterFixed(dayIndex, ringIndex, fixedId) {
  const sched = ctx.state;
  const fixed = sched?.placements?.[fixedId];
  const fixedEntry = catalogEntry(fixedId);
  if (!fixed || !fixedEntry) return;

  const fixedStart = Number(fixed.start_offset_minutes || 0);
  const fixedEnd = fixedStart + displayDuration(fixedEntry, sched);
  const others = ringDayBlocks(dayIndex, ringIndex, fixedId);
  const rest = others.filter((block) => block.end + GAP > fixedStart);

  let frontier = fixedEnd + GAP;
  rest.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  rest.forEach((block) => {
    if (block.start < frontier) {
      block.placement.start_offset_minutes = frontier;
      frontier = frontier + block.duration + GAP;
    } else {
      frontier = block.start + block.duration + GAP;
    }
  });
}

function placeFromScratchAt(id, dayIndex, ringIndex, startOffsetMinutes) {
  const sched = ctx.state;
  const entry = catalogEntry(id);
  if (!sched || !entry) return false;

  const duration = displayDuration(entry, sched);
  if (duration <= 0) {
    showToast('Division has no duration to place.', true);
    return false;
  }

  const days = scheduleDays(sched);
  const day = days[dayIndex];
  if (!day) return false;
  const windowMins = dayWindowMinutes(day);
  const ringCount = Math.max(1, Number(sched.ring_count || 3));
  if (ringIndex < 0 || ringIndex >= ringCount) return false;
  if (duration > windowMins) {
    showToast('Division is longer than the day window.', true);
    return false;
  }

  let start = Math.max(0, Math.floor(Number(startOffsetMinutes) / SLOT) * SLOT);
  if (start + duration > windowMins) {
    start = Math.max(0, Math.floor((windowMins - duration) / SLOT) * SLOT);
  }

  sched.placements = sched.placements || {};
  sched.placements[String(id)] = {
    day_index: Number(dayIndex),
    ring_index: Number(ringIndex),
    start_offset_minutes: start
  };
  sched.scratch_ids = (sched.scratch_ids || []).filter((x) => String(x) !== String(id));
  resolveRingAfterFixed(dayIndex, ringIndex, String(id));

  markDirty();
  renderViewer();
  showToast('Placed from scratch.');
  return true;
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

function dayTimelineHtml(sched, dayIndex) {
  const days = scheduleDays(sched);
  const day = days[dayIndex] || days[0];
  const ringCount = Math.max(1, Number(sched.ring_count || 3));
  const startAbs = parseHhmm(day.start_time) ?? 8 * 60;
  const windowMins = dayWindowMinutes(day);
  const slotCount = Math.max(1, Math.floor(windowMins / SLOT));
  const byRing = Array.from({ length: ringCount }, () => []);

  Object.entries(sched.placements || {}).forEach(([id, placement]) => {
    if (Number(placement.day_index || 0) !== Number(dayIndex)) return;
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
  const gridCols = `var(--da-sched-time-w, 72px) repeat(${ringCount}, minmax(100px, 1fr))`;
  const draggable = ctx.canEdit ? 'true' : 'false';
  const showNowLine = !isToolMode();

  return `
    <div class="da-schedule-timeline" data-day-index="${Number(dayIndex)}" style="--da-sched-slots:${slotCount}; --da-sched-cols:${ringCount}; grid-template-columns:${gridCols};">
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
            const selected = ctx.canEdit && ctx.selectedId === String(block.id) ? 'is-selected' : '';
            return `<div class="da-schedule-block ${selected}" data-id="${escapeHtml(block.id)}" data-slots="${heightSlots}" draggable="${draggable}"
              style="top:calc(${topSlots} * var(--da-sched-slot-h)); height:calc(${heightSlots} * var(--da-sched-slot-h) - 2px);">
              <strong title="${escapeHtml(block.name)}">${escapeHtml(block.name)}</strong>
              <span>${fmtClock(startAbs, block.start)}–${fmtClock(startAbs, block.end)}</span>
            </div>`;
          }).join('')}
        </div>
      `).join('')}
      ${showNowLine ? '<div class="live-now-line" hidden aria-hidden="true"></div>' : ''}
    </div>
  `;
}

function renderBoard() {
  const board = document.getElementById('liveBoard');
  const sched = ctx.state;
  if (!board || !sched) return;

  const days = scheduleDays(sched);
  if (isToolMode()) {
    const dayIndex = Math.max(0, Math.min(Number(sched.active_day_index || 0), days.length - 1));
    board.innerHTML = dayTimelineHtml(sched, dayIndex);
  } else {
    board.innerHTML = days.map((day, idx) => `
      <section class="live-viewer-day">
        ${days.length > 1 ? `<h2 class="live-viewer-day-title">${escapeHtml(day.name || `Day ${idx + 1}`)}</h2>` : ''}
        ${dayTimelineHtml(sched, idx)}
      </section>
    `).join('');
  }

  fitDivisionBlockText(board);
}

function fitDivisionBlockText(root) {
  const blocks = root?.querySelectorAll('.da-schedule-block') || [];
  if (!blocks.length) return;

  const toolMode = isToolMode();

  blocks.forEach((block) => {
    const nameEl = block.querySelector('strong');
    const timeEl = block.querySelector('span');
    if (!nameEl || !timeEl) return;

    const slots = Math.max(1, Number(block.getAttribute('data-slots')) || 1);
    // Tool 5-min (1-slot) blocks are only ~22px tall — start much smaller.
    let preferredName;
    let preferredTime;
    let minSize;
    if (!toolMode) {
      preferredName = 59;
      preferredTime = 50;
      minSize = 8;
    } else if (slots <= 1) {
      preferredName = 9;
      preferredTime = 7;
      minSize = 5;
    } else if (slots <= 2) {
      preferredName = 12;
      preferredTime = 10;
      minSize = 6;
    } else {
      preferredName = 117;
      preferredTime = 99;
      minSize = 8;
    }

    const apply = (size) => {
      nameEl.style.fontSize = `${size}px`;
      timeEl.style.fontSize = `${Math.max(minSize, size * (preferredTime / preferredName))}px`;
    };

    // Measure as single-line so we detect width overflow (line-clamp hides it).
    const prev = {
      whiteSpace: nameEl.style.whiteSpace,
      display: nameEl.style.display,
      webkitLineClamp: nameEl.style.webkitLineClamp,
      webkitBoxOrient: nameEl.style.webkitBoxOrient,
      overflow: nameEl.style.overflow,
      timeOverflow: timeEl.style.overflow
    };
    nameEl.style.whiteSpace = 'nowrap';
    nameEl.style.display = 'block';
    nameEl.style.webkitLineClamp = 'unset';
    nameEl.style.webkitBoxOrient = '';
    nameEl.style.overflow = 'hidden';
    timeEl.style.overflow = 'hidden';

    const overflows = () => (
      block.scrollHeight > block.clientHeight + 1
      || nameEl.scrollWidth > nameEl.clientWidth + 1
      || timeEl.scrollWidth > timeEl.clientWidth + 1
    );

    apply(preferredName);
    if (overflows()) {
      let lo = minSize;
      let hi = preferredName;
      while (hi - lo > 0.75) {
        const mid = (lo + hi) / 2;
        apply(mid);
        if (overflows()) hi = mid;
        else lo = mid;
      }
      apply(lo);
    }

    nameEl.style.whiteSpace = prev.whiteSpace;
    nameEl.style.display = prev.display;
    nameEl.style.webkitLineClamp = prev.webkitLineClamp;
    nameEl.style.webkitBoxOrient = prev.webkitBoxOrient;
    nameEl.style.overflow = prev.overflow;
    timeEl.style.overflow = prev.timeOverflow;
  });
}

function scheduleSlotHeightPx() {
  const timeline = document.querySelector('#liveBoard .da-schedule-timeline');
  if (timeline) return timelineSlotHeight(timeline);
  return isToolMode() ? 22 : 34;
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

  const slotH = scheduleSlotHeightPx();
  list.innerHTML = ids.map((id) => {
    const entry = catalogEntry(id);
    const name = entry?.division_name || id;
    const duration = entry ? displayDuration(entry, ctx.state) : SLOT;
    const heightSlots = Math.max(1, (duration || SLOT) / SLOT);
    const heightPx = Math.max(slotH - 2, heightSlots * slotH - 2);
    const selected = ctx.selectedId === String(id) ? 'selected' : '';
    const minsLabel = duration > 0 ? `${duration} min` : '';
    return `<li class="live-scratch-item ${selected}" data-id="${escapeHtml(id)}" data-slots="${heightSlots}"
      draggable="true" style="height:${heightPx}px; min-height:${heightPx}px;">
      <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
      ${minsLabel ? `<span>${escapeHtml(minsLabel)}</span>` : ''}
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

function ensureScheduleDays() {
  const sched = ctx.state;
  if (!sched) return [];
  if (!Array.isArray(sched.days) || !sched.days.length) {
    sched.days = [{ name: 'Day 1', start_time: '08:00', end_time: '18:00' }];
  }
  return sched.days;
}

function clampLocalScheduleBounds() {
  const sched = ctx.state;
  if (!sched) return;
  const ringCount = Math.max(1, Math.min(32, Number(sched.ring_count) || 3));
  sched.ring_count = ringCount;
  const days = ensureScheduleDays();
  const dayCount = days.length;
  sched.active_day_index = Math.max(0, Math.min(Number(sched.active_day_index) || 0, dayCount - 1));
  sched.placements = sched.placements || {};
  sched.scratch_ids = Array.isArray(sched.scratch_ids) ? sched.scratch_ids.map(String) : [];
  Object.entries(sched.placements).forEach(([id, placement]) => {
    const dayIndex = Number(placement?.day_index || 0);
    const ringIndex = Number(placement?.ring_index || 0);
    if (dayIndex < 0 || dayIndex >= dayCount || ringIndex < 0 || ringIndex >= ringCount) {
      delete sched.placements[id];
      if (!sched.scratch_ids.includes(String(id))) sched.scratch_ids.push(String(id));
    }
  });
}

function renderScheduleSettings() {
  const panel = document.getElementById('liveScheduleSettings');
  const ringInput = document.getElementById('liveRingCountInput');
  const daysHost = document.getElementById('liveDaysSettings');
  const removeDayBtn = document.getElementById('liveRemoveDayBtn');
  const removeRingBtn = document.getElementById('liveRemoveRingBtn');
  const dayWrap = document.getElementById('liveDaySelectWrap');
  if (!panel || !daysHost) return;

  const show = Boolean(ctx.canEdit && isToolMode() && ctx.state);
  panel.hidden = !show;
  if (dayWrap) dayWrap.hidden = !show;
  if (!show) return;

  const days = ensureScheduleDays();
  const active = Math.max(0, Math.min(Number(ctx.state.active_day_index || 0), days.length - 1));
  const day = days[active] || days[0];
  const ringCount = Math.max(1, Math.min(32, Number(ctx.state.ring_count) || 3));
  if (ringInput) ringInput.value = String(ringCount);
  if (removeDayBtn) removeDayBtn.disabled = days.length <= 1;
  if (removeRingBtn) removeRingBtn.disabled = ringCount <= 1;

  const activeEl = document.activeElement;
  const activeName = activeEl?.classList?.contains('live-day-start') ? 'start'
    : activeEl?.classList?.contains('live-day-end') ? 'end'
      : '';

  daysHost.innerHTML = `
    <div class="live-day-settings-row" data-day-index="${active}">
      <label class="live-inline-label">Start
        <input type="time" class="da-input da-input-sm live-day-start"
          value="${escapeHtml(day.start_time || '08:00')}" aria-label="Day start">
      </label>
      <label class="live-inline-label">End
        <input type="time" class="da-input da-input-sm live-day-end"
          value="${escapeHtml(day.end_time || '18:00')}" aria-label="Day end">
      </label>
    </div>
  `;

  if (activeName) {
    const input = daysHost.querySelector(
      activeName === 'start' ? '.live-day-start' : '.live-day-end'
    );
    if (input) {
      input.focus();
    }
  }
}

function applyDayFieldFromInput(input) {
  const row = input.closest('[data-day-index]');
  if (!row || !ctx.state) return;
  const idx = Number(row.getAttribute('data-day-index'));
  const days = ensureScheduleDays();
  if (!days[idx]) return;
  if (input.classList.contains('live-day-name')) {
    days[idx].name = String(input.value || '').trim() || `Day ${idx + 1}`;
  } else if (input.classList.contains('live-day-start')) {
    days[idx].start_time = String(input.value || '08:00');
  } else if (input.classList.contains('live-day-end')) {
    days[idx].end_time = String(input.value || '18:00');
  }
  markDirty();
  syncDaySelect();
  renderBoard();
}

async function autoFillSchedule() {
  if (!ctx.canEdit || !ctx.state) return;
  clampLocalScheduleBounds();
  const result = await apiFetch(
    `/api/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(ctx.eventId)}/pack`,
    {
      method: 'POST',
      body: JSON.stringify({
        state: ctx.state,
        divisionIds: 'all',
        replaceExisting: true
      })
    }
  );
  ctx.state = result.state;
  markDirty();
  renderViewer();
  showToast(
    result.placed
      ? `Auto-filled ${result.placed} division${result.placed === 1 ? '' : 's'}. Save to keep.`
      : (result.skipped
        ? 'Auto-fill finished with placements skipped (check day windows / durations).'
        : 'Auto-fill complete. Save to keep.')
  );
}

function renderViewer() {
  const sched = ctx.state;
  if (!sched) return;
  syncDaySelect();
  renderScheduleSettings();
  renderBoard();
  renderScratch();

  const saveBtn = document.getElementById('liveSaveBtn');
  const qrBtn = document.getElementById('liveDownloadQrBtn');
  const eventWrap = document.getElementById('liveEventSelectWrap');
  if (saveBtn) saveBtn.hidden = !ctx.canEdit;
  if (qrBtn) qrBtn.hidden = !(ctx.canEdit && ctx.clientId && ctx.eventId);
  if (eventWrap) eventWrap.hidden = !isToolMode();
  updateSaveButtonAppearance();

  if (isToolMode()) {
    stopNowScroll();
  } else {
    startNowScroll();
  }
}

function setPanels({ picker = false, viewer = false, missing = false } = {}) {
  const pickerPanel = document.getElementById('livePickerPanel');
  if (pickerPanel && !picker) pickerPanel.hidden = true;
  document.getElementById('liveViewerPanel').hidden = !viewer;
  document.getElementById('liveMissingPanel').hidden = !missing;
}

function updateHeader() {
  const eventName = document.getElementById('liveViewerEventName');

  if (ctx.event) {
    document.title = `${ctx.event.name} — Live Schedule`;
  } else {
    document.title = 'Live Event Schedule';
  }

  // Public viewer keeps the event title on the board; tool mode uses the header label only.
  if (eventName) {
    if (!isToolMode() && ctx.event) {
      const loc = ctx.event.location ? ` · ${ctx.event.location}` : '';
      eventName.textContent = `${ctx.event.name}${loc}`;
      eventName.hidden = false;
    } else {
      eventName.hidden = true;
    }
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
  ctx.canEdit = isToolMode() && Boolean(data.canEdit);
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
  if (!silent && isToolMode()) showToast('Schedule loaded.');
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
  let dragImageEl = null;

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

  const removeDragGhost = () => {
    document.getElementById('liveDragGhost')?.remove();
  };

  const removeDragImage = () => {
    if (dragImageEl?.parentNode) dragImageEl.parentNode.removeChild(dragImageEl);
    dragImageEl = null;
  };

  const dropTargetFromPoint = (clientX, clientY) => {
    const stack = document.elementsFromPoint(clientX, clientY);
    const lane = stack
      .map((el) => (el.nodeType === 1 ? el.closest('.da-schedule-ring-lane[data-ring]') : null))
      .find(Boolean);
    const timeline = lane?.closest('.da-schedule-timeline[data-day-index]');
    if (!lane || !timeline) return null;
    const dayIndex = Number(timeline.getAttribute('data-day-index') || 0);
    const ringIndex = Number(lane.getAttribute('data-ring') || 0);
    const rect = lane.getBoundingClientRect();
    const slotH = timelineSlotHeight(timeline);
    const y = Math.max(0, clientY - rect.top);
    const slotIndex = Math.max(0, Math.floor(y / slotH));
    return {
      dayIndex,
      ringIndex,
      startOffset: slotIndex * SLOT,
      lane,
      timeline,
      slotH
    };
  };

  const ensureDragGhost = (heightPx) => {
    let ghost = document.getElementById('liveDragGhost');
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.id = 'liveDragGhost';
      ghost.className = 'live-drag-ghost';
      ghost.setAttribute('aria-hidden', 'true');
    }
    ghost.style.height = `${Math.max(8, heightPx)}px`;
    return ghost;
  };

  const updateDragGhost = (clientX, clientY) => {
    if (!activeDrag || activeDrag.from !== 'scratch') {
      removeDragGhost();
      return null;
    }
    const target = dropTargetFromPoint(clientX, clientY);
    if (!target) {
      removeDragGhost();
      return null;
    }

    const entry = catalogEntry(activeDrag.id);
    const duration = entry ? displayDuration(entry, ctx.state) : SLOT;
    const heightSlots = Math.max(1, (duration || SLOT) / SLOT);
    const heightPx = heightSlots * target.slotH - 2;
    let start = Math.max(0, Math.floor(Number(target.startOffset) / SLOT) * SLOT);
    const day = scheduleDays(ctx.state)[target.dayIndex];
    const windowMins = dayWindowMinutes(day);
    if (duration > 0 && start + duration > windowMins) {
      start = Math.max(0, Math.floor((windowMins - duration) / SLOT) * SLOT);
    }
    const topPx = (start / SLOT) * target.slotH;

    const ghost = ensureDragGhost(heightPx);
    if (ghost.parentNode !== target.lane) {
      target.lane.appendChild(ghost);
    }
    ghost.style.top = `${topPx}px`;
    ghost.hidden = false;
    return { ...target, startOffset: start, duration };
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
    removeDragGhost();
    removeDragImage();
  });

  document.getElementById('liveScratchList')?.addEventListener('dragstart', (e) => {
    if (!ctx.canEdit) return;
    const item = e.target.closest('.live-scratch-item[data-id]');
    if (!item || !e.dataTransfer) return;
    hideContextMenu();
    item.classList.add('da-dragging');
    const id = item.getAttribute('data-id');
    setPayload(e.dataTransfer, { id, from: 'scratch' });

    // Keep a visible sized drag image matching the scratch block height.
    removeDragImage();
    dragImageEl = item.cloneNode(true);
    dragImageEl.classList.add('live-drag-image');
    dragImageEl.style.width = `${item.getBoundingClientRect().width}px`;
    dragImageEl.style.height = item.style.height || `${item.getBoundingClientRect().height}px`;
    document.body.appendChild(dragImageEl);
    const offsetY = Math.min(e.offsetY || 16, Math.max(8, dragImageEl.offsetHeight / 2));
    try {
      e.dataTransfer.setDragImage(dragImageEl, Math.min(40, dragImageEl.offsetWidth / 2), offsetY);
    } catch (_) {
      /* some browsers reject custom drag images */
    }
  });

  document.getElementById('liveScratchList')?.addEventListener('dragend', (e) => {
    e.target.closest('.live-scratch-item')?.classList.remove('da-dragging');
    activeDrag = null;
    clearDropTargets();
    removeDragGhost();
    removeDragImage();
  });

  const scratchDrop = document.getElementById('liveScratchDrop');
  scratchDrop?.addEventListener('dragover', (e) => {
    if (!ctx.canEdit || !activeDrag || activeDrag.from !== 'board') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    scratchDrop.classList.add('is-drop-target');
    removeDragGhost();
  });
  scratchDrop?.addEventListener('dragleave', (e) => {
    if (!scratchDrop.contains(e.relatedTarget)) scratchDrop.classList.remove('is-drop-target');
  });
  scratchDrop?.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropTargets();
    removeDragGhost();
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
    updateDragGhost(e.clientX, e.clientY);
  });
  boardDrop?.addEventListener('dragleave', (e) => {
    if (!boardDrop.contains(e.relatedTarget)) {
      boardDrop.classList.remove('is-drop-target');
      removeDragGhost();
    }
  });
  boardDrop?.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropTargets();
    const payload = activeDrag;
    const preview = updateDragGhost(e.clientX, e.clientY);
    removeDragGhost();
    removeDragImage();
    activeDrag = null;
    if (!ctx.canEdit || !payload || payload.from !== 'scratch') return;

    const target = preview || dropTargetFromPoint(e.clientX, e.clientY);
    if (!target) {
      showToast('Drop onto a ring lane to place.', true);
      return;
    }
    placeFromScratchAt(payload.id, target.dayIndex, target.ringIndex, target.startOffset);
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

  document.getElementById('liveRingCountInput')?.addEventListener('change', (e) => {
    if (!ctx.canEdit || !ctx.state) return;
    const n = Math.max(1, Math.min(32, Number(e.target.value) || 3));
    e.target.value = String(n);
    ctx.state.ring_count = n;
    clampLocalScheduleBounds();
    markDirty();
    renderViewer();
  });

  document.getElementById('liveAddRingBtn')?.addEventListener('click', () => {
    if (!ctx.canEdit || !ctx.state) return;
    const n = Math.min(32, (Number(ctx.state.ring_count) || 3) + 1);
    ctx.state.ring_count = n;
    markDirty();
    renderViewer();
  });

  document.getElementById('liveRemoveRingBtn')?.addEventListener('click', () => {
    if (!ctx.canEdit || !ctx.state) return;
    const n = Math.max(1, (Number(ctx.state.ring_count) || 3) - 1);
    ctx.state.ring_count = n;
    clampLocalScheduleBounds();
    markDirty();
    renderViewer();
  });

  document.getElementById('liveAddDayBtn')?.addEventListener('click', () => {
    if (!ctx.canEdit || !ctx.state) return;
    const days = ensureScheduleDays();
    const n = days.length + 1;
    days.push({ name: `Day ${n}`, start_time: '08:00', end_time: '18:00' });
    ctx.state.active_day_index = days.length - 1;
    markDirty();
    renderViewer();
  });

  document.getElementById('liveRemoveDayBtn')?.addEventListener('click', () => {
    if (!ctx.canEdit || !ctx.state) return;
    const days = ensureScheduleDays();
    if (days.length <= 1) return;
    days.pop();
    clampLocalScheduleBounds();
    markDirty();
    renderViewer();
  });

  document.getElementById('liveDaysSettings')?.addEventListener('change', (e) => {
    if (!ctx.canEdit) return;
    const input = e.target.closest('input');
    if (!input) return;
    applyDayFieldFromInput(input);
  });

  document.getElementById('liveDaysSettings')?.addEventListener('input', (e) => {
    if (!ctx.canEdit) return;
    const input = e.target.closest('.live-day-name');
    if (!input) return;
    applyDayFieldFromInput(input);
  });

  document.getElementById('liveAutoFillBtn')?.addEventListener('click', async () => {
    try {
      await autoFillSchedule();
    } catch (err) {
      showToast(err.message || 'Unable to auto-fill schedule.', true);
    }
  });

  document.getElementById('liveBoard')?.addEventListener('click', (e) => {
    if (!isToolMode()) return;
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
    wrap.hidden = !isToolMode();

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

function showMissing(message) {
  stopPolling();
  stopNowScroll();
  setPanels({ missing: true });
  const missing = document.getElementById('liveMissingMessage');
  if (missing) {
    missing.textContent = message || 'This live schedule link is invalid or no schedule has been saved yet.';
  }
}

async function openFirstSavedSchedule() {
  try {
    const data = await apiFetch('/api/live-schedule/saved');
    ctx.clientId = data.clientId || ctx.clientId || '';
    const items = data.items || [];
    if (!items.length) {
      showMissing('No saved schedules found. Create draws for an event first — a schedule is saved automatically.');
      return;
    }
    window.location.replace(scheduleHref(ctx.clientId, items[0].eventId));
  } catch (err) {
    showMissing(err.message || 'This live schedule link is invalid or no schedule has been saved yet.');
  }
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
    window.location.href = scheduleHref(ctx.clientId, eventId);
  });
}

async function init() {
  ctx.mode = liveMode();
  document.documentElement.classList.toggle('live-tool', isToolMode());
  document.documentElement.classList.toggle('live-viewer', !isToolMode());

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
      if (isToolMode()) {
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
      } else {
        showMissing(err.message);
      }
    }
    return;
  }

  if (isToolMode()) {
    await showPicker();
    return;
  }

  await openFirstSavedSchedule();
}

init().catch((err) => {
  showMissing(err.message || 'Unable to open live schedule.');
});
