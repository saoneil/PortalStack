import { bindTouchDnD } from './touch-dnd.js';

const DEFAULT_MATCH = 3;
const DEFAULT_BUFFER = 0.5;
const SLOT = 5;
const GAP = 5;
const SCHEDULE_BLOCK_TEXT_SCALE = 1.5;
const DEFAULT_BREAK_MINUTES = 30;
const POLL_MS = 15000;
const NOW_SCROLL_MS = 30000;
const TIMELINE_HEADER_H = 28;
const AUTO_SAVE_MS = 900;

const EVENT_DISPLAY_NAMES = {
  individual_patterns: 'INDIVIDUAL PATTERNS',
  individual_sparring: 'INDIVIDUAL SPARRING',
  individual_special_technique: 'INDIVIDUAL SPECIAL TECHNIQUE',
  individual_power_test: 'INDIVIDUAL POWER TEST',
  team_patterns: 'TEAM PATTERNS',
  team_sparring: 'TEAM SPARRING',
  team_special_technique: 'TEAM SPECIAL TECHNIQUE',
  team_power_test: 'TEAM POWER TEST',
  pre_arranged_sparring: 'PRE ARRANGED SPARRING'
};

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
  durationsDirty: false,
  autoSaveTimer: null,
  autoSaveInFlight: false,
  selectedId: '',
  contextId: '',
  pollTimer: null,
  nowScrollTimer: null,
  nowResizeBound: false,
  dragBound: false,
  contextBound: false,
  toolTab: 'board',
  selectedDurationIds: new Set(),
  timesBound: false,
  eventFilters: new Set(),
  beltFilters: new Set(),
  pendingBreak: null,
  editSeq: 0,
  completedDivisionIds: new Set(),
  resultsUpdatedAt: null,
  savedItems: []
};

const PORTAL_LAST_EVENT_KEY = 'portal-last-event-id';
const PORTAL_FOCUS_DAY_KEY = 'portal-focus-day-index';

function rememberLastEventId(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return;
  try {
    sessionStorage.setItem(PORTAL_LAST_EVENT_KEY, id);
  } catch (_) { /* ignore */ }
}

function readLastEventId() {
  try {
    return String(sessionStorage.getItem(PORTAL_LAST_EVENT_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

function notifyPortalEventSelected(eventId) {
  if (eventId) rememberLastEventId(eventId);
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'portal-event-selected',
        eventId: String(eventId || '')
      }, window.location.origin);
    }
  } catch (_) { /* ignore */ }
}

function readFocusDayIndex(dayCount) {
  const params = new URLSearchParams(window.location.search);
  let raw = params.get('day');
  if (raw == null || raw === '') {
    try {
      raw = localStorage.getItem(PORTAL_FOCUS_DAY_KEY);
    } catch (_) {
      raw = null;
    }
  }
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const index = Math.floor(n);
  if (dayCount > 0) return Math.max(0, Math.min(dayCount - 1, index));
  return index;
}

function preferredSavedEventId(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 1) return String(list[0].eventId || '');
  return '';
}

function resolvePickerSelection(items, override = '') {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';
  if (list.length === 1) return String(list[0].eventId || '');
  const explicit = String(override || ctx.eventId || readLastEventId() || '').trim();
  if (explicit && list.some((item) => String(item.eventId) === explicit)) return explicit;
  return '';
}

function isDivisionCompleted(id) {
  return ctx.completedDivisionIds.has(String(id));
}

function divisionCompleteMark(id, { inline = false } = {}) {
  if (!isDivisionCompleted(id)) return '';
  const cls = inline
    ? 'live-division-complete live-division-complete-inline'
    : 'live-division-complete';
  return `<span class="${cls}" title="Division completed" aria-label="Completed">✓</span>`;
}

function applyCompletionMeta(data) {
  ctx.completedDivisionIds = new Set((data.completedDivisionIds || []).map(String));
  ctx.resultsUpdatedAt = data.resultsUpdatedAt || null;
}

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

function rawDivisionDuration(entry, sched) {
  const id = String(entry.id);
  const match = Number(sched.match_durations?.[id] || 0) || 0;
  const buffer = Number(sched.buffer_durations?.[id] || 0) || 0;
  return (match + buffer) * matchCount(entry);
}

function formatDurationMinutes(mins) {
  const n = Number(mins) || 0;
  if (n <= 0) return '0';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, '');
}

function eventDisplayName(eventKey) {
  const key = String(eventKey || '').trim();
  return EVENT_DISPLAY_NAMES[key] || key || '—';
}

function eventFilterLabel(eventKey) {
  const full = eventDisplayName(eventKey);
  return full
    .replace(/^INDIVIDUAL\s+/i, '')
    .replace(/^TEAM\s+/i, 'T ')
    .replace(/\s+/g, ' ')
    .trim() || eventKey;
}

function entryAthletes(entry) {
  return Array.isArray(entry?.athletes) ? entry.athletes : [];
}

function divisionAthleteRows(entry) {
  return entryAthletes(entry)
    .map((athlete) => {
      const first = String(athlete?.first_name || '').trim();
      const last = String(athlete?.last_name || '').trim();
      const name = String(athlete?.name || '').trim() || [first, last].filter(Boolean).join(' ');
      const club = String(
        athlete?.club || athlete?.team || athlete?.team_name_or_country || ''
      ).trim();
      return { name: name || 'Unnamed athlete', club };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function divisionPlacementInfo(divisionId) {
  const sched = ctx.state;
  if (!sched) return null;
  const id = String(divisionId);
  const placement = sched.placements?.[id];
  if (!placement) return null;

  const entry = catalogEntry(id);
  if (!entry) return null;

  const days = scheduleDays(sched);
  const dayIndex = Number(placement.day_index || 0);
  const day = days[dayIndex];
  if (!day) return null;

  const startAbs = parseHhmm(day.start_time) ?? 8 * 60;
  const start = Number(placement.start_offset_minutes || 0);
  const duration = displayDuration(entry, sched);
  if (duration <= 0) return null;

  const end = start + duration;
  const ringIndex = Number(placement.ring_index || 0);

  return {
    dayIndex,
    dayName: String(day.name || `Day ${dayIndex + 1}`),
    ringIndex,
    ringLabel: `Ring ${ringIndex + 1}`,
    start,
    end,
    duration,
    startClock: fmtClock(startAbs, start),
    endClock: fmtClock(startAbs, end),
    windowLabel: `${fmtClock(startAbs, start)}–${fmtClock(startAbs, end)}`
  };
}

function divisionScheduleSummary(divisionId) {
  const sched = ctx.state;
  const info = divisionPlacementInfo(divisionId);
  if (!info) {
    if (sched && isScratched(divisionId)) return 'On scratch pad (not scheduled)';
    return 'Not scheduled';
  }
  const days = scheduleDays(sched);
  const dayPart = days.length > 1 ? `${info.dayName} · ` : '';
  return `${dayPart}${info.ringLabel} · ${info.windowLabel} (${formatDurationMinutes(info.duration)} min)`;
}

function closeDivisionModal() {
  const modal = document.getElementById('liveDivisionModal');
  if (!modal) return;
  modal.hidden = true;
}

function openDivisionModal(divisionId) {
  const modal = document.getElementById('liveDivisionModal');
  const titleEl = document.getElementById('liveDivisionModalTitle');
  const scheduleEl = document.getElementById('liveDivisionModalSchedule');
  const listEl = document.getElementById('liveDivisionModalList');
  const emptyEl = document.getElementById('liveDivisionModalEmpty');
  if (!modal || !titleEl || !listEl || !emptyEl) return;

  const entry = catalogEntry(divisionId);
  const divisionName = entry?.division_name || `Division ${divisionId}`;
  const athletes = entry ? divisionAthleteRows(entry) : [];

  titleEl.textContent = divisionName;
  if (scheduleEl) {
    scheduleEl.textContent = divisionScheduleSummary(divisionId);
  }
  if (!athletes.length) {
    listEl.innerHTML = '';
    listEl.hidden = true;
    emptyEl.hidden = false;
  } else {
    listEl.innerHTML = athletes.map((athlete) => `
      <li class="live-division-modal-row">
        <span class="live-division-modal-name">${escapeHtml(athlete.name)}</span>
        <span class="live-division-modal-club">${escapeHtml(athlete.club || '—')}</span>
      </li>
    `).join('');
    listEl.hidden = false;
    emptyEl.hidden = true;
  }
  modal.hidden = false;
}

function divisionBelt(entry) {
  const athletes = entryAthletes(entry);
  if (athletes.some((a) => String(a.rank || '').toLowerCase().includes('dan'))) return 'dan';
  if (athletes.some((a) => String(a.rank || '').toLowerCase().includes('gup'))) return 'gup';

  const ranks = [entry?.rank_min, entry?.rank_max]
    .map((r) => String(r || '').toLowerCase())
    .filter(Boolean);
  if (ranks.some((r) => r.includes('dan'))) return 'dan';
  if (ranks.some((r) => r.includes('gup'))) return 'gup';

  const name = String(entry?.division_name || '').toLowerCase();
  if (/\bdan\b/.test(name)) return 'dan';
  if (/\bgup\b/.test(name)) return 'gup';
  return 'gup';
}

function catalogSorted() {
  return [...(ctx.state?.catalog || [])].sort((a, b) =>
    String(a.division_name || '').localeCompare(String(b.division_name || ''))
  );
}

function catalogFiltered() {
  return catalogSorted().filter((entry) => {
    const eventKey = String(entry.event_key || '').trim();
    if (ctx.eventFilters.size && !ctx.eventFilters.has(eventKey)) return false;
    if (ctx.beltFilters.size && !ctx.beltFilters.has(divisionBelt(entry))) return false;
    return true;
  });
}

function catalogEventKeys() {
  const keys = new Set();
  catalogSorted().forEach((entry) => {
    const key = String(entry.event_key || '').trim();
    if (key) keys.add(key);
  });
  return [...keys].sort((a, b) => eventDisplayName(a).localeCompare(eventDisplayName(b)));
}

function renderEventFilterButtons() {
  const host = document.getElementById('liveEventFilterBtns');
  if (!host) return;
  const keys = catalogEventKeys();
  const known = new Set(keys);
  [...ctx.eventFilters].forEach((key) => {
    if (!known.has(key)) ctx.eventFilters.delete(key);
  });
  if (!keys.length) {
    host.innerHTML = '<span class="live-hint">No event types</span>';
    return;
  }
  host.innerHTML = keys.map((key) => {
    const active = ctx.eventFilters.has(key) ? 'is-active' : '';
    return `<button type="button" class="da-btn da-btn-sm live-filter-btn ${active}" data-event-filter="${escapeHtml(key)}" title="${escapeHtml(eventDisplayName(key))}">${escapeHtml(eventFilterLabel(key))}</button>`;
  }).join('');
}

function syncBeltFilterButtons() {
  document.querySelectorAll('#liveBeltFilterBtns [data-belt-filter]').forEach((btn) => {
    const key = btn.getAttribute('data-belt-filter');
    btn.classList.toggle('is-active', ctx.beltFilters.has(key));
  });
}

function catalogEntry(id) {
  return (ctx.state?.catalog || []).find((e) => String(e.id) === String(id)) || null;
}

function markDirty() {
  if (!ctx.canEdit) return;
  ctx.dirty = true;
  ctx.editSeq = (ctx.editSeq || 0) + 1;
  updateSaveButtonAppearance();
  scheduleAutoSave();
}

function markDurationsDirty() {
  if (!ctx.canEdit) return;
  ctx.durationsDirty = true;
  markDirty();
}

function clearDirty() {
  ctx.dirty = false;
  ctx.durationsDirty = false;
  updateSaveButtonAppearance();
}

function updateSaveButtonAppearance() {
  const saveBtn = document.getElementById('liveSaveBtn');
  if (!saveBtn) return;
  saveBtn.textContent = ctx.dirty ? 'Save*' : 'Save';
  saveBtn.classList.toggle('is-dirty', Boolean(ctx.dirty && ctx.canEdit));
}

function cancelAutoSave() {
  if (ctx.autoSaveTimer) {
    clearTimeout(ctx.autoSaveTimer);
    ctx.autoSaveTimer = null;
  }
}

function scheduleAutoSave() {
  if (!ctx.canEdit || !isToolMode()) return;
  cancelAutoSave();
  ctx.autoSaveTimer = setTimeout(() => {
    ctx.autoSaveTimer = null;
    saveSchedule({ silent: true }).catch((err) => {
      showToast(err.message || 'Unable to auto-save schedule.', true);
    });
  }, AUTO_SAVE_MS);
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

  const focusDay = readFocusDayIndex(days.length);
  let scrollLine = null;
  timelines.forEach((timeline) => {
    const dayIndex = Number(timeline.getAttribute('data-day-index') || 0);
    const line = timeline.querySelector('.live-now-line');
    if (focusDay != null && dayIndex !== focusDay) {
      if (line) line.hidden = true;
      return;
    }
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

function snapMinutes(minutes) {
  let m = Math.max(0, Math.floor(Number(minutes) || 0));
  const rem = m % SLOT;
  if (rem) m += SLOT - rem;
  return m;
}

function newBreakId() {
  return `brk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isBreakId(id) {
  return Boolean(ctx.state?.breaks?.[String(id)]);
}

function isScratched(id) {
  return (ctx.state?.scratch_ids || []).some((x) => String(x) === String(id));
}

function breakDuration(block) {
  return Math.max(SLOT, snapMinutes(Number(block?.duration_minutes || 0)));
}

function scheduleRingCount(sched = ctx.state) {
  return Math.max(1, Math.min(32, Number(sched?.ring_count || 3)));
}

function breakRingSpan(block, ringCount = scheduleRingCount()) {
  if (block?.all_rings) return Math.max(1, ringCount);
  return Math.max(1, Number(block?.ring_span || 1));
}

function breakCoversRing(block, ringIndex, ringCount = scheduleRingCount()) {
  if (block?.all_rings) return ringIndex >= 0 && ringIndex < ringCount;
  const start = Number(block?.ring_index || 0);
  const span = breakRingSpan(block, ringCount);
  return ringIndex >= start && ringIndex < start + span;
}

function ringsForBreak(block, ringCount = scheduleRingCount()) {
  if (block?.all_rings) {
    return Array.from({ length: ringCount }, (_, r) => r);
  }
  const start = Number(block?.ring_index || 0);
  const span = breakRingSpan(block, ringCount);
  return Array.from({ length: span }, (_, i) => start + i).filter((r) => r >= 0 && r < ringCount);
}

function itemDuration(id) {
  const br = ctx.state?.breaks?.[String(id)];
  if (br) return breakDuration(br);
  const entry = catalogEntry(id);
  return entry ? displayDuration(entry, ctx.state) : SLOT;
}

function timelineDropTargetFromPoint(clientX, clientY) {
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
}

function removeBreak(id, { skipNormalize = false } = {}) {
  const sched = ctx.state;
  const br = sched?.breaks?.[String(id)];
  if (!br) return;
  const start = Number(br.start_offset_minutes || 0);
  const end = start + breakDuration(br);
  const dayIndex = Number(br.day_index || 0);
  const rings = ringsForBreak(br);
  delete sched.breaks[String(id)];
  if (ctx.selectedId === String(id)) ctx.selectedId = '';
  rings.forEach((ringIndex) => closeGapOnRing(dayIndex, ringIndex, start, end, id));
  if (!skipNormalize) normalizeAllOverlaps();
}

function syncPendingBreakUi() {
  const placing = Boolean(ctx.pendingBreak);
  document.documentElement.classList.toggle('is-placing-break', placing);
  document.getElementById('liveAddBreakOneBtn')?.classList.toggle('is-pending', placing && !ctx.pendingBreak.allRings);
  document.getElementById('liveAddBreakAllBtn')?.classList.toggle('is-pending', placing && Boolean(ctx.pendingBreak.allRings));
}

function cancelPendingBreak({ silent = false } = {}) {
  if (!ctx.pendingBreak) return;
  ctx.pendingBreak = null;
  syncPendingBreakUi();
  document.getElementById('liveDragGhost')?.remove();
  if (!silent) showToast('Break placement cancelled.');
}

function beginPendingBreak(allRings) {
  if (!ctx.canEdit || !ctx.state) return;
  hideContextMenu();
  const wantAll = Boolean(allRings);
  if (ctx.pendingBreak && Boolean(ctx.pendingBreak.allRings) === wantAll) {
    cancelPendingBreak();
    return;
  }
  ctx.pendingBreak = { allRings: wantAll, duration: DEFAULT_BREAK_MINUTES };
  syncPendingBreakUi();
  showToast(wantAll
    ? (isScratchPadVisible()
      ? 'Click a ring or the scratch pad to place a 30 min break on all rings.'
      : 'Tap a ring to place a 30 min break on all rings.')
    : (isScratchPadVisible()
      ? 'Click a ring or the scratch pad to place a 30 min break.'
      : 'Tap a ring to place a 30 min break.'));
}

function placePendingBreakAt(dayIndex, ringIndex, startOffset) {
  const pending = ctx.pendingBreak;
  const sched = ctx.state;
  if (!pending || !sched) return false;
  sched.breaks = sched.breaks || {};
  const id = newBreakId();
  const ringCount = scheduleRingCount(sched);
  const allRings = Boolean(pending.allRings);
  sched.breaks[id] = {
    day_index: Number(dayIndex),
    ring_index: allRings ? 0 : Number(ringIndex),
    ring_span: allRings ? ringCount : 1,
    all_rings: allRings,
    start_offset_minutes: Number(startOffset) || 0,
    duration_minutes: Math.max(SLOT, snapMinutes(pending.duration))
  };
  const ok = placeBlockAt(id, dayIndex, allRings ? 0 : ringIndex, startOffset);
  if (!ok) {
    delete sched.breaks[id];
    return false;
  }
  ctx.pendingBreak = null;
  syncPendingBreakUi();
  ctx.selectedId = id;
  renderViewer();
  showToast(allRings ? 'Break added on all rings.' : 'Break added.');
  return true;
}

function placePendingBreakOnScratch() {
  const pending = ctx.pendingBreak;
  const sched = ctx.state;
  if (!pending || !sched) return false;
  sched.breaks = sched.breaks || {};
  sched.scratch_ids = sched.scratch_ids || [];
  const id = newBreakId();
  const ringCount = scheduleRingCount(sched);
  const allRings = Boolean(pending.allRings);
  sched.breaks[id] = {
    day_index: Number(sched.active_day_index || 0),
    ring_index: 0,
    ring_span: allRings ? ringCount : 1,
    all_rings: allRings,
    start_offset_minutes: 0,
    duration_minutes: Math.max(SLOT, snapMinutes(pending.duration))
  };
  if (!sched.scratch_ids.includes(id)) sched.scratch_ids.push(id);
  ctx.pendingBreak = null;
  syncPendingBreakUi();
  ctx.selectedId = id;
  markDirty();
  renderViewer();
  showToast(allRings ? 'All-rings break added to scratch.' : 'Break added to scratch.');
  return true;
}

function sendToScratch(ids) {
  const sched = ctx.state;
  if (!sched || !ids.length) return;
  sched.scratch_ids = sched.scratch_ids || [];
  ids.forEach((rawId) => {
    const id = String(rawId);
    if (sched.breaks?.[id]) {
      if (!sched.scratch_ids.includes(id)) sched.scratch_ids.push(id);
      return;
    }
    if (sched.placements) delete sched.placements[id];
    if (!sched.scratch_ids.includes(id)) sched.scratch_ids.push(id);
  });
  markDirty();
}

function ringDayBlocks(dayIndex, ringIndex, excludeId = null) {
  const sched = ctx.state;
  const blocks = [];
  const ringCount = scheduleRingCount(sched);
  Object.entries(sched.placements || {}).forEach(([id, placement]) => {
    if (excludeId != null && String(id) === String(excludeId)) return;
    if (Number(placement.day_index || 0) !== Number(dayIndex)) return;
    if (Number(placement.ring_index || 0) !== Number(ringIndex)) return;
    const entry = catalogEntry(id);
    if (!entry) return;
    const start = Number(placement.start_offset_minutes || 0);
    const duration = displayDuration(entry, sched);
    blocks.push({
      id: String(id),
      kind: 'division',
      placement,
      start,
      duration,
      end: start + duration
    });
  });
  Object.entries(sched.breaks || {}).forEach(([id, block]) => {
    if (excludeId != null && String(id) === String(excludeId)) return;
    if (isScratched(id)) return;
    if (Number(block.day_index || 0) !== Number(dayIndex)) return;
    if (!breakCoversRing(block, ringIndex, ringCount)) return;
    const start = Number(block.start_offset_minutes || 0);
    const duration = breakDuration(block);
    blocks.push({
      id: String(id),
      kind: 'break',
      block,
      allRings: Boolean(block.all_rings),
      span: breakRingSpan(block, ringCount),
      start,
      duration,
      end: start + duration
    });
  });
  blocks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return blocks;
}

function applyBlockStart(meta, start) {
  const snapped = Math.max(0, Math.floor(Number(start) / SLOT) * SLOT);
  if (meta.kind === 'break') {
    if (meta.block) meta.block.start_offset_minutes = snapped;
  } else if (meta.placement) {
    meta.placement.start_offset_minutes = snapped;
  }
  meta.start = snapped;
  meta.end = snapped + meta.duration;
}

function normalizeOverlapsOnRing(dayIndex, ringIndex) {
  const blocks = ringDayBlocks(dayIndex, ringIndex);
  for (let i = 1; i < blocks.length; i += 1) {
    const prev = blocks[i - 1];
    const cur = blocks[i];
    const minStart = prev.end + GAP;
    if (cur.start < minStart) applyBlockStart(cur, minStart);
  }
}

function normalizeAllOverlaps() {
  const sched = ctx.state;
  if (!sched) return false;
  const days = scheduleDays(sched);
  const ringCount = scheduleRingCount(sched);
  let changed = false;
  for (let n = 0; n < 12; n += 1) {
    let round = false;
    days.forEach((_, dayIndex) => {
      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const before = ringDayBlocks(dayIndex, ringIndex).map((b) => `${b.id}:${b.start}`).join('|');
        normalizeOverlapsOnRing(dayIndex, ringIndex);
        const after = ringDayBlocks(dayIndex, ringIndex).map((b) => `${b.id}:${b.start}`).join('|');
        if (before !== after) {
          round = true;
          changed = true;
        }
      }
    });
    if (!round) break;
  }
  return changed;
}

function closeGapOnRing(dayIndex, ringIndex, vacatedStart, vacatedEnd, excludeId = null) {
  const shift = (Number(vacatedEnd) - Number(vacatedStart)) + GAP;
  if (!(shift > 0)) return;
  let expected = Number(vacatedEnd) + GAP;
  const blocks = ringDayBlocks(dayIndex, ringIndex, excludeId)
    .filter((block) => block.start >= Number(vacatedStart));
  for (const block of blocks) {
    if (block.start > expected) break;
    if (block.kind === 'break' && (block.allRings || block.span > 1)) break;
    const oldEnd = block.end;
    applyBlockStart(block, Math.max(0, block.start - shift));
    expected = oldEnd + GAP;
  }
}

function placeBlockAt(id, dayIndex, ringIndex, startOffsetMinutes) {
  const sched = ctx.state;
  if (!sched) return false;
  const breakBlock = sched.breaks?.[String(id)] || null;
  const entry = breakBlock ? null : catalogEntry(id);
  if (!breakBlock && !entry) return false;

  const days = scheduleDays(sched);
  const day = days[dayIndex];
  if (!day) return false;
  const windowMins = dayWindowMinutes(day);
  const ringCount = scheduleRingCount(sched);
  const duration = breakBlock ? breakDuration(breakBlock) : displayDuration(entry, sched);
  if (duration <= 0) {
    showToast(breakBlock ? 'Break has no duration.' : 'Division has no duration to place.', true);
    return false;
  }
  if (duration > windowMins) {
    showToast('Item is longer than the day window.', true);
    return false;
  }

  const allRings = Boolean(breakBlock?.all_rings);
  const destRing = allRings ? 0 : Number(ringIndex);
  if (!allRings && (destRing < 0 || destRing >= ringCount)) return false;

  let start = Math.max(0, Math.floor(Number(startOffsetMinutes) / SLOT) * SLOT);
  if (start + duration > windowMins) {
    start = Math.max(0, Math.floor((windowMins - duration) / SLOT) * SLOT);
  }

  if (breakBlock) {
    breakBlock.day_index = Number(dayIndex);
    breakBlock.ring_index = destRing;
    breakBlock.start_offset_minutes = start;
    breakBlock.duration_minutes = duration;
    if (allRings) breakBlock.ring_span = ringCount;
    sched.scratch_ids = (sched.scratch_ids || []).filter((x) => String(x) !== String(id));
  } else {
    sched.placements = sched.placements || {};
    sched.placements[String(id)] = {
      day_index: Number(dayIndex),
      ring_index: destRing,
      start_offset_minutes: start
    };
    sched.scratch_ids = (sched.scratch_ids || []).filter((x) => String(x) !== String(id));
  }

  markDirty();
  renderViewer();
  return true;
}

function placeFromScratchAt(id, dayIndex, ringIndex, startOffsetMinutes) {
  const ok = placeBlockAt(id, dayIndex, ringIndex, startOffsetMinutes);
  if (ok) showToast('Placed from scratch.');
  return ok;
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

function durationAdjustToast(slotDelta, kind) {
  const mins = Math.abs(slotDelta) * SLOT;
  const label = kind === 'break' ? 'break' : 'division';
  if (slotDelta > 0) return `Lengthened ${label} by ${mins} min.`;
  return `Shortened ${label} by ${mins} min.`;
}

function adjustDurationSlots(id, slotDelta) {
  const sched = ctx.state;
  if (!sched) return;

  const br = sched.breaks?.[String(id)];
  if (br) {
    const current = breakDuration(br);
    const target = Math.max(SLOT, current + slotDelta * SLOT);
    if (target === current) return;
    const start = Number(br.start_offset_minutes || 0);
    const oldEnd = start + current;
    br.duration_minutes = target;
    const dayIndex = Number(br.day_index || 0);
    const rings = ringsForBreak(br);
    if (target > current) {
      rings.forEach((ringIndex) => normalizeOverlapsOnRing(dayIndex, ringIndex));
    } else {
      rings.forEach((ringIndex) => closeGapOnRing(dayIndex, ringIndex, start + target, oldEnd, id));
    }
    normalizeAllOverlaps();
    markDirty();
    renderViewer();
    showToast(durationAdjustToast(slotDelta, 'break'));
    return;
  }

  const entry = catalogEntry(id);
  if (!entry || !sched.placements?.[id]) return;

  const current = displayDuration(entry, sched);
  const target = Math.max(SLOT, current + slotDelta * SLOT);
  if (target === current) return;

  const placement = sched.placements[id];
  const start = Number(placement.start_offset_minutes || 0);
  const oldEnd = start + current;
  setMatchDurationForTargetTotal(id, target);

  const dayIndex = Number(placement.day_index || 0);
  const ringIndex = Number(placement.ring_index || 0);
  if (target > current) {
    normalizeOverlapsOnRing(dayIndex, ringIndex);
  } else {
    closeGapOnRing(dayIndex, ringIndex, start + target, oldEnd, id);
  }
  normalizeAllOverlaps();

  markDirty();
  renderViewer();
  showToast(durationAdjustToast(slotDelta, 'division'));
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
  const deleteBtn = document.getElementById('liveContextDeleteBreak');
  if (deleteBtn) deleteBtn.hidden = !isBreakId(id);
  document.querySelectorAll('#liveBoard .da-schedule-block.is-selected').forEach((el) => {
    el.classList.remove('is-selected');
  });
  document.querySelectorAll(`#liveBoard .da-schedule-block[data-id="${CSS.escape(String(id))}"]`).forEach((el) => {
    el.classList.add('is-selected');
  });
}

function dayTimelineHtml(sched, dayIndex) {
  const days = scheduleDays(sched);
  const day = days[dayIndex] || days[0];
  const ringCount = Math.max(1, Number(sched.ring_count || 3));
  const startAbs = parseHhmm(day.start_time) ?? 8 * 60;
  const windowMins = dayWindowMinutes(day);
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
      kind: 'division',
      name: entry.division_name,
      start,
      end: start + duration,
      duration
    });
  });
  Object.entries(sched.breaks || {}).forEach(([id, br]) => {
    if (isScratched(id)) return;
    if (Number(br.day_index || 0) !== Number(dayIndex)) return;
    const duration = breakDuration(br);
    const start = Number(br.start_offset_minutes || 0);
    const name = br.all_rings ? 'Break · all rings' : 'Break';
    ringsForBreak(br, ringCount).forEach((ring) => {
      byRing[ring].push({
        id,
        kind: 'break',
        name,
        start,
        end: start + duration,
        duration
      });
    });
  });
  byRing.forEach((list) => list.sort((a, b) => a.start - b.start));

  let maxEnd = windowMins;
  byRing.forEach((list) => {
    list.forEach((block) => {
      maxEnd = Math.max(maxEnd, block.end);
    });
  });
  const slotCount = Math.max(1, Math.ceil(maxEnd / SLOT));

  const timeLabels = Array.from({ length: slotCount }, (_, i) => formatHhmm(startAbs + i * SLOT));
  const gridCols = `var(--da-sched-time-w, 72px) repeat(${ringCount}, minmax(100px, 1fr))`;
  const draggable = ctx.canEdit ? 'true' : 'false';
  const showNowLine = !isToolMode();

  return `
    <div class="da-schedule-timeline" data-day-index="${Number(dayIndex)}" style="--da-sched-slots:${slotCount}; --da-sched-cols:${ringCount}; grid-template-columns:${gridCols};">
      <div class="da-schedule-timeline-corner" style="grid-row:1;grid-column:1;">time</div>
      ${Array.from({ length: ringCount }, (_, ring) => `
        <div class="da-schedule-timeline-ring-head" style="grid-row:1;grid-column:${ring + 2};">Ring ${ring + 1}</div>
      `).join('')}
      <div class="da-schedule-time-axis" aria-hidden="true" style="grid-row:2;grid-column:1;">
        ${timeLabels.map((label) => `<div class="da-schedule-time-tick">${label}</div>`).join('')}
      </div>
      ${byRing.map((list, ring) => `
        <div class="da-schedule-ring-lane" data-ring="${ring}" style="grid-row:2;grid-column:${ring + 2};">
          ${list.map((block) => {
            const topSlots = block.start / SLOT;
            const heightSlots = Math.max(1, block.duration / SLOT);
            const selected = ctx.canEdit && ctx.selectedId === String(block.id) ? 'is-selected' : '';
            const breakClass = block.kind === 'break' ? 'is-break' : '';
            const completedClass = block.kind !== 'break' && isDivisionCompleted(block.id) ? 'is-completed' : '';
            const compactClass = block.kind !== 'break' && heightSlots === 1 ? 'is-compact' : '';
            return `<div class="da-schedule-block ${selected} ${breakClass} ${completedClass} ${compactClass}" data-id="${escapeHtml(block.id)}" data-kind="${escapeHtml(block.kind || 'division')}" data-slots="${heightSlots}" draggable="${draggable}"
              style="top:calc(${topSlots} * var(--da-sched-slot-h)); height:calc(${heightSlots} * var(--da-sched-slot-h) - 2px);">
              ${divisionCompleteMark(block.id)}
              <strong class="da-schedule-block-name" title="${escapeHtml(block.name)}">${escapeHtml(block.name)}</strong>
              ${compactClass ? '' : `<span class="da-schedule-block-time">${fmtClock(startAbs, block.start)}–${fmtClock(startAbs, block.end)}</span>`}
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
  requestAnimationFrame(function () {
    fitDivisionBlockText(board);
  });
  if (typeof ResizeObserver !== 'undefined' && !board._liveSchedFitObs) {
    board._liveSchedFitObs = new ResizeObserver(function () {
      fitDivisionBlockText(board);
    });
    board._liveSchedFitObs.observe(board);
  }
}

function fitDivisionBlockText(root) {
  const blocks = root?.querySelectorAll('.da-schedule-block') || [];
  if (!blocks.length) return;

  const toolMode = isToolMode();

  const fitSize = (lo, hi, test, overflows) => {
    let best = lo;
    test(hi);
    if (!overflows()) return hi;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      test(mid);
      if (overflows()) hi = mid;
      else {
        best = mid;
        lo = mid;
      }
    }
    return best;
  };

  blocks.forEach((block) => {
    const nameEl = block.querySelector('.da-schedule-block-name') || block.querySelector('strong');
    const timeEl = block.querySelector('.da-schedule-block-time');
    if (!nameEl) return;

    const slots = Math.max(1, Number(block.getAttribute('data-slots')) || 1);
    const isBreak = block.classList.contains('is-break');
    const hideTime = !isBreak && slots === 1;
    const blockH = Math.max(1, block.clientHeight);
    const blockW = Math.max(1, block.clientWidth);
    const blockStyle = getComputedStyle(block);
    const padX = (parseFloat(blockStyle.paddingLeft) || 0) + (parseFloat(blockStyle.paddingRight) || 0);
    const padY = (parseFloat(blockStyle.paddingTop) || 0) + (parseFloat(blockStyle.paddingBottom) || 0);
    const availW = Math.max(1, blockW - padX);
    const availH = Math.max(1, blockH - padY);
    const allowWrap = slots >= 2;
    const minName = hideTime ? 5 : (toolMode && slots <= 1 ? 6 : (toolMode && slots <= 2 ? 7 : 8));
    const minTime = Math.max(6, minName - 1);

    if (hideTime || !timeEl) {
      const maxName = Math.max(
        minName,
        Math.min(availH * 0.95, availW * 0.45, toolMode ? 12 : 16)
      );

      nameEl.style.flex = '0 1 auto';
      nameEl.style.width = '100%';
      nameEl.style.maxWidth = '100%';
      nameEl.style.minWidth = '0';
      nameEl.style.minHeight = '0';
      nameEl.style.display = 'block';
      nameEl.style.lineHeight = '1';
      nameEl.style.overflow = 'hidden';
      nameEl.style.overflowWrap = 'normal';
      nameEl.style.wordBreak = 'normal';
      nameEl.style.whiteSpace = 'nowrap';
      nameEl.style.textAlign = 'center';
      nameEl.style.textOverflow = 'clip';

      const applyName = (size) => {
        nameEl.style.fontSize = `${Math.max(minName, size)}px`;
      };

      const compactOverflows = () => (
        nameEl.scrollWidth > nameEl.clientWidth + 1
        || nameEl.scrollHeight > availH + 1
        || block.scrollHeight > block.clientHeight + 1
      );

      const bestName = fitSize(minName, maxName, applyName, compactOverflows);
      applyName(bestName);
      nameEl.style.textOverflow = compactOverflows() ? 'ellipsis' : 'clip';
      return;
    }

    const timeReserve = Math.min(blockH * 0.34, (toolMode ? 16 : 20) * SCHEDULE_BLOCK_TEXT_SCALE);
    const nameAreaH = Math.max(8, blockH - timeReserve - 4);
    let maxName = Math.min(
      (toolMode ? 22 : 28) * SCHEDULE_BLOCK_TEXT_SCALE,
      nameAreaH / (allowWrap ? 2.1 : 1.08),
      blockW / (allowWrap ? 3.8 : 2.4)
    );
    maxName = Math.max(minName, maxName);
    const maxTime = Math.max(
      minTime,
      Math.min(maxName * (isBreak ? 0.85 : 0.95), blockW / 6.2, timeReserve)
    );

    nameEl.style.flex = '0 1 auto';
    nameEl.style.minHeight = '0';
    nameEl.style.display = 'block';
    nameEl.style.overflow = 'visible';
    nameEl.style.textOverflow = 'clip';
    nameEl.style.overflowWrap = allowWrap ? 'break-word' : 'normal';
    nameEl.style.wordBreak = 'normal';
    nameEl.style.whiteSpace = allowWrap ? 'normal' : 'nowrap';
    nameEl.style.webkitLineClamp = 'unset';
    nameEl.style.webkitBoxOrient = '';
    timeEl.style.flexShrink = '0';
    timeEl.style.marginTop = 'auto';
    timeEl.style.overflow = 'visible';
    timeEl.style.textOverflow = 'clip';
    timeEl.style.whiteSpace = 'nowrap';

    const overflows = () => (
      block.scrollHeight > block.clientHeight + 1
      || nameEl.scrollHeight > nameEl.clientHeight + 1
      || (!allowWrap && nameEl.scrollWidth > nameEl.clientWidth + 1)
      || timeEl.scrollWidth > timeEl.clientWidth + 1
    );

    const apply = (namePx, timePx) => {
      nameEl.style.fontSize = `${Math.max(minName, namePx)}px`;
      timeEl.style.fontSize = `${Math.max(minTime, timePx)}px`;
    };

    const bestName = fitSize(minName, maxName, (size) => apply(size, minTime), overflows);
    const bestTime = fitSize(minTime, maxTime, (size) => apply(bestName, size), overflows);
    apply(bestName, bestTime);
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

  scratchPanel.hidden = !isScratchPadVisible();
  stage.classList.remove('is-readonly');
  const ids = ctx.state?.scratch_ids || [];
  if (!ids.length) {
    list.innerHTML = '';
    return;
  }

  const slotH = scheduleSlotHeightPx();
  list.innerHTML = ids.map((id) => {
    const br = ctx.state?.breaks?.[String(id)] || null;
    const isBreak = Boolean(br);
    const entry = isBreak ? null : catalogEntry(id);
    const name = isBreak
      ? (br.all_rings ? 'Break · all rings' : 'Break')
      : (entry?.division_name || id);
    const duration = isBreak ? breakDuration(br) : (entry ? displayDuration(entry, ctx.state) : SLOT);
    const heightSlots = Math.max(1, (duration || SLOT) / SLOT);
    const heightPx = Math.max(slotH - 2, heightSlots * slotH - 2);
    const selected = ctx.selectedId === String(id) ? 'selected' : '';
    const minsLabel = isBreak && duration > 0 ? `${duration} min` : '';
    const kind = isBreak ? 'break' : 'division';
    const completedClass = !isBreak && isDivisionCompleted(id) ? 'is-completed' : '';
    return `<li class="live-scratch-item ${selected} ${isBreak ? 'is-break' : ''} ${completedClass}" data-id="${escapeHtml(id)}" data-kind="${kind}" data-slots="${heightSlots}"
      draggable="true" style="height:${heightPx}px; min-height:${heightPx}px;">
      ${divisionCompleteMark(id)}
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
  sched.breaks = sched.breaks || {};
  sched.scratch_ids = Array.isArray(sched.scratch_ids) ? sched.scratch_ids.map(String) : [];
  Object.entries(sched.placements).forEach(([id, placement]) => {
    const dayIndex = Number(placement?.day_index || 0);
    const ringIndex = Number(placement?.ring_index || 0);
    if (dayIndex < 0 || dayIndex >= dayCount || ringIndex < 0 || ringIndex >= ringCount) {
      delete sched.placements[id];
      if (!sched.scratch_ids.includes(String(id))) sched.scratch_ids.push(String(id));
    }
  });
  Object.entries(sched.breaks).forEach(([breakId, br]) => {
    const dayIndex = Number(br?.day_index || 0);
    if (dayIndex < 0 || dayIndex >= dayCount) {
      delete sched.breaks[breakId];
      return;
    }
    if (br.all_rings) {
      br.ring_index = 0;
      br.ring_span = ringCount;
      return;
    }
    const ringIndex = Number(br?.ring_index || 0);
    if (ringIndex < 0 || ringIndex >= ringCount) {
      delete sched.breaks[breakId];
      return;
    }
    br.ring_span = Math.min(Math.max(1, Number(br.ring_span || 1)), ringCount - ringIndex);
  });
}

function renderScheduleSettings() {
  const panel = document.getElementById('liveScheduleSettings');
  const tabs = document.getElementById('liveToolTabs');
  const ringInput = document.getElementById('liveRingCountInput');
  const daysHost = document.getElementById('liveDaysSettings');
  const removeDayBtn = document.getElementById('liveRemoveDayBtn');
  const removeRingBtn = document.getElementById('liveRemoveRingBtn');
  const dayWrap = document.getElementById('liveDaySelectWrap');
  if (!panel || !daysHost) return;

  const show = Boolean(ctx.canEdit && isToolMode() && ctx.state);
  panel.hidden = !show;
  panel.classList.toggle('is-times-tab', show && ctx.toolTab === 'times');
  if (tabs) tabs.hidden = !show;
  if (dayWrap) dayWrap.hidden = !show || ctx.toolTab !== 'board';
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

function syncToolTabUi() {
  const tabs = document.getElementById('liveToolTabs');
  const stage = document.getElementById('liveStage');
  const times = document.getElementById('liveTimesPanel');
  const showTabs = Boolean(ctx.canEdit && isToolMode() && ctx.state);
  if (tabs) {
    tabs.hidden = !showTabs;
    tabs.querySelectorAll('[data-live-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-live-tab') === ctx.toolTab);
    });
  }
  const onBoard = !showTabs || ctx.toolTab === 'board';
  const onTimes = showTabs && ctx.toolTab === 'times';
  if (stage) stage.hidden = !onBoard;
  if (times) {
    times.hidden = !onTimes;
    times.classList.toggle('is-active', onTimes);
  }
}

function setToolTab(tab) {
  ctx.toolTab = tab === 'times' ? 'times' : 'board';
  if (ctx.toolTab === 'board' && ctx.durationsDirty && normalizeAllOverlaps()) {
    markDirty();
  }
  cancelPendingBreak({ silent: true });
  syncToolTabUi();
  renderViewer();
}

function updateTimesFooter() {
  const footer = document.getElementById('liveTimesFooter');
  if (!footer || !ctx.state) return;
  const listed = catalogFiltered().length;
  const selected = ctx.selectedDurationIds.size;
  const total = catalogFiltered().reduce((sum, entry) => sum + rawDivisionDuration(entry, ctx.state), 0);
  footer.textContent = `Divisions: ${listed} listed, ${selected} selected · Total: ${formatDurationMinutes(total)} min`;
}

function renderTimesTable() {
  const body = document.getElementById('liveTimesBody');
  const selectAll = document.getElementById('liveTimesSelectAll');
  if (!body || !ctx.state) return;

  renderEventFilterButtons();
  syncBeltFilterButtons();

  const activeEl = document.activeElement;
  const activeId = activeEl?.closest?.('tr[data-id]')?.getAttribute('data-id') || '';
  const activeField = activeEl?.classList?.contains('live-times-match')
    ? 'match'
    : activeEl?.classList?.contains('live-times-buffer')
      ? 'buffer'
      : '';
  const selectionStart = activeEl?.selectionStart;
  const selectionEnd = activeEl?.selectionEnd;

  const entries = catalogFiltered();
  const known = new Set(catalogSorted().map((e) => String(e.id)));
  [...ctx.selectedDurationIds].forEach((id) => {
    if (!known.has(String(id))) ctx.selectedDurationIds.delete(id);
  });

  if (!entries.length) {
    body.innerHTML = `<tr><td colspan="9" class="live-hint">No divisions match the current filters.</td></tr>`;
    if (selectAll) selectAll.checked = false;
    updateTimesFooter();
    return;
  }

  body.innerHTML = entries.map((entry) => {
    const id = String(entry.id);
    const selected = ctx.selectedDurationIds.has(id);
    const mc = matchCount(entry);
    const match = Number(ctx.state.match_durations?.[id] || 0) || 0;
    const buffer = Number(ctx.state.buffer_durations?.[id] || 0) || 0;
    const total = rawDivisionDuration(entry, ctx.state);
    const disabled = ctx.canEdit ? '' : 'disabled';
    return `
      <tr data-id="${escapeHtml(id)}" class="${selected ? 'selected' : ''}">
        <td class="live-times-check-col">
          <input type="checkbox" class="live-times-row-check" ${selected ? 'checked' : ''} ${disabled} aria-label="Select ${escapeHtml(entry.division_name || id)}">
        </td>
        <td>${divisionCompleteMark(id, { inline: true })}${escapeHtml(entry.division_name || id)}</td>
        <td>${escapeHtml(eventDisplayName(entry.event_key))}</td>
        <td>${escapeHtml(entry.division_type || '—')}</td>
        <td>${Number(entry.athlete_count || 0) || 0}</td>
        <td>${mc}</td>
        <td>
          <input type="text" class="da-input da-input-sm live-times-cell-input live-times-match"
            inputmode="decimal" maxlength="5" value="${escapeHtml(String(match))}" data-id="${escapeHtml(id)}" ${disabled}>
        </td>
        <td>
          <input type="text" class="da-input da-input-sm live-times-cell-input live-times-buffer"
            inputmode="decimal" maxlength="5" value="${escapeHtml(String(buffer))}" data-id="${escapeHtml(id)}" ${disabled}>
        </td>
        <td>${escapeHtml(formatDurationMinutes(total))} min</td>
      </tr>
    `;
  }).join('');

  if (selectAll) {
    selectAll.disabled = !ctx.canEdit;
    selectAll.checked = entries.length > 0 && entries.every((e) => ctx.selectedDurationIds.has(String(e.id)));
  }

  if (activeId && activeField) {
    const input = body.querySelector(
      `tr[data-id="${CSS.escape(activeId)}"] .live-times-${activeField}`
    );
    if (input) {
      input.focus();
      if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
        try { input.setSelectionRange(selectionStart, selectionEnd); } catch (_) { /* ignore */ }
      }
    }
  }

  updateTimesFooter();
}

function parseBulkDurationFields() {
  const matchRaw = String(document.getElementById('liveBulkMatchInput')?.value || '').trim();
  const bufferRaw = String(document.getElementById('liveBulkBufferInput')?.value || '').trim();
  let matchMinutes = null;
  let bufferMinutes = null;

  if (matchRaw) {
    matchMinutes = Number(matchRaw);
    if (!Number.isFinite(matchMinutes) || matchMinutes < 0) {
      showToast('Match duration must be a non-negative number.', true);
      return null;
    }
  }
  if (bufferRaw) {
    bufferMinutes = Number(bufferRaw);
    if (!Number.isFinite(bufferMinutes) || bufferMinutes < 0) {
      showToast('Buffer duration must be a non-negative number.', true);
      return null;
    }
  }
  if (matchMinutes == null && bufferMinutes == null) {
    showToast('Enter at least one of Match or Buffer duration.', true);
    return null;
  }
  return { matchMinutes, bufferMinutes };
}

function applyDurationsToIds(ids, { matchMinutes = null, bufferMinutes = null } = {}) {
  const sched = ctx.state;
  if (!sched || !ctx.canEdit) return 0;
  const targets = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!targets.length) return 0;
  if (!sched.match_durations) sched.match_durations = {};
  if (!sched.buffer_durations) sched.buffer_durations = {};
  targets.forEach((id) => {
    if (matchMinutes != null) sched.match_durations[id] = Math.max(0, Number(matchMinutes) || 0);
    if (bufferMinutes != null) sched.buffer_durations[id] = Math.max(0, Number(bufferMinutes) || 0);
  });
  markDurationsDirty();
  return targets.length;
}

function applyBulkToSelected() {
  const parsed = parseBulkDurationFields();
  if (!parsed) return;
  const ids = [...ctx.selectedDurationIds];
  if (!ids.length) {
    showToast('No divisions selected.', true);
    return;
  }
  const n = applyDurationsToIds(ids, parsed);
  renderTimesTable();
  showToast(`Updated durations for ${n} division${n === 1 ? '' : 's'}.`);
}

function applyBulkToAllShown() {
  const parsed = parseBulkDurationFields();
  if (!parsed) return;
  const ids = catalogFiltered().map((e) => String(e.id));
  if (!ids.length) {
    showToast('No divisions are currently shown.', true);
    return;
  }
  const n = applyDurationsToIds(ids, parsed);
  renderTimesTable();
  showToast(`Updated durations for ${n} division${n === 1 ? '' : 's'}.`);
}

function resetAllTimes() {
  if (!ctx.canEdit || !ctx.state) return;
  const hasAny = Object.keys(ctx.state.match_durations || {}).length
    || Object.keys(ctx.state.buffer_durations || {}).length;
  if (!hasAny) {
    showToast('No category times to reset.');
    return;
  }
  if (!window.confirm('Clear match and buffer times for all divisions?\n\nRing placements are kept.')) {
    return;
  }
  ctx.state.match_durations = {};
  ctx.state.buffer_durations = {};
  markDurationsDirty();
  renderTimesTable();
  showToast('All category times cleared.');
}

function setCellDuration(id, field, rawValue) {
  if (!ctx.canEdit || !ctx.state) return;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    showToast('Value must be a non-negative number.', true);
    renderTimesTable();
    return;
  }
  if (!ctx.state.match_durations) ctx.state.match_durations = {};
  if (!ctx.state.buffer_durations) ctx.state.buffer_durations = {};
  if (field === 'match') ctx.state.match_durations[String(id)] = value;
  else ctx.state.buffer_durations[String(id)] = value;
  markDurationsDirty();
  renderTimesTable();
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
  cancelPendingBreak({ silent: true });
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
      ? `Auto-filled ${result.placed} division${result.placed === 1 ? '' : 's'}.`
      : (result.skipped
        ? 'Auto-fill finished with placements skipped (check day windows / durations).'
        : 'Auto-fill complete.')
  );
}

function placedIdsInScheduleOrder(sched) {
  return Object.entries(sched?.placements || {})
    .map(([id, placement]) => ({
      id: String(id),
      day: Number(placement.day_index || 0),
      ring: Number(placement.ring_index || 0),
      start: Number(placement.start_offset_minutes || 0)
    }))
    .sort((a, b) => (
      a.day - b.day
      || a.start - b.start
      || a.ring - b.ring
      || a.id.localeCompare(b.id)
    ))
    .map((row) => row.id);
}

async function reflowPlacedSchedule() {
  if (!ctx.canEdit || !ctx.state) return null;
  clampLocalScheduleBounds();
  const divisionIds = placedIdsInScheduleOrder(ctx.state);
  if (!divisionIds.length) return { placed: 0, skipped: 0, reflowed: false };

  const result = await apiFetch(
    `/api/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(ctx.eventId)}/pack`,
    {
      method: 'POST',
      body: JSON.stringify({
        state: ctx.state,
        divisionIds,
        replaceExisting: true
      })
    }
  );
  ctx.state = result.state;
  return {
    placed: result.placed || 0,
    skipped: result.skipped || 0,
    reflowed: true
  };
}

function renderViewer() {
  const sched = ctx.state;
  if (!sched) return;
  syncDaySelect();
  syncToolTabUi();
  renderScheduleSettings();
  if (ctx.toolTab === 'times' && isToolMode() && ctx.canEdit) {
    renderTimesTable();
  } else {
    renderBoard();
    renderScratch();
  }

  const saveBtn = document.getElementById('liveSaveBtn');
  const qrBtn = document.getElementById('liveDownloadQrBtn');
  if (saveBtn) saveBtn.hidden = !ctx.canEdit;
  if (qrBtn) {
    const onScheduleSettings = isToolMode() && ctx.canEdit && ctx.toolTab === 'times';
    qrBtn.hidden = !(ctx.canEdit && ctx.clientId && ctx.eventId) || onScheduleSettings;
  }
  const eventRow = document.getElementById('liveEventSelectRow');
  if (eventRow) eventRow.hidden = !isToolMode();
  updateSaveButtonAppearance();

  if (isToolMode()) {
    stopNowScroll();
  } else {
    startNowScroll();
  }
  syncLiveScrollAffordances();
}

function isLiveMobileView() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function isScratchPadVisible() {
  return window.matchMedia('(max-width: 900px)').matches === false;
}

function updateLiveScrollAffordance(el, cueId, gradientEl) {
  if (!el) return;
  const canScrollX = el.scrollWidth > el.clientWidth + 6;
  const canScrollY = el.scrollHeight > el.clientHeight + 6;
  const canScroll = canScrollX || canScrollY;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
  const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 6;
  const atEnd = (!canScrollY || atBottom) && (!canScrollX || atRight);
  const gradient = gradientEl || el;
  gradient.classList.toggle('has-scroll', canScroll);
  gradient.classList.toggle('at-scroll-end', atEnd);
  el.classList.toggle('has-scroll', canScroll);
  el.classList.toggle('at-scroll-end', atEnd);
  const cue = cueId ? document.getElementById(cueId) : null;
  if (cue) cue.classList.toggle('is-visible', canScroll && !atEnd);
}

function syncLiveScrollAffordances() {
  if (!isLiveMobileView() || !isToolMode()) {
    document.querySelectorAll('.live-scroll-cue').forEach((cue) => cue.classList.remove('is-visible'));
    document.querySelectorAll('.live-board-wrap.has-scroll, .live-scratch.has-scroll, .live-times-grid-wrap.has-scroll')
      .forEach((el) => el.classList.remove('has-scroll', 'at-scroll-end'));
    return;
  }
  updateLiveScrollAffordance(document.getElementById('liveBoardDrop'), 'liveBoardScrollCue');
  if (isScratchPadVisible()) {
    updateLiveScrollAffordance(document.getElementById('liveScratchDrop'), 'liveScratchScrollCue');
  }
  updateLiveScrollAffordance(document.querySelector('.live-times-grid-wrap'), null);
}

function bindLiveScrollAffordances() {
  const targets = [
    document.getElementById('liveBoardDrop'),
    document.getElementById('liveScratchDrop'),
    document.querySelector('.live-times-grid-wrap')
  ];
  targets.forEach((el) => {
    if (!el || el.dataset.scrollAffordanceBound) return;
    el.dataset.scrollAffordanceBound = '1';
    el.addEventListener('scroll', () => syncLiveScrollAffordances(), { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => syncLiveScrollAffordances()).observe(el);
    }
  });
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

async function refreshSchedule({ silent = false, force = false } = {}) {
  if (!ctx.clientId || !ctx.eventId) return;
  if (silent && ctx.dirty) return;
  const data = await apiFetch(
    `/api/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(ctx.eventId)}`
  );
  const scheduleUnchanged = ctx.updatedAt && String(data.updated_at) === String(ctx.updatedAt);
  const resultsUnchanged = String(data.resultsUpdatedAt || '') === String(ctx.resultsUpdatedAt || '');
  if (!force && silent && scheduleUnchanged && resultsUnchanged && !ctx.dirty) {
    return;
  }
  ctx.event = data.event;
  ctx.canEdit = isToolMode() && Boolean(data.canEdit);
  ctx.updatedAt = data.updated_at;
  applyCompletionMeta(data);
  if (force || !ctx.dirty || !scheduleUnchanged) {
    ctx.state = data.state;
    if (data.timezone && isValidTimeZone(data.timezone)) {
      ctx.timezone = data.timezone;
    } else if (data.state && isValidTimeZone(data.state.timezone)) {
      ctx.timezone = data.state.timezone;
    }
    clearDirty();
  }
  setPanels({ viewer: true });
  updateHeader();
  renderViewer();
  if (ctx.canEdit) {
    await loadEventOptions({ selectedEventId: ctx.eventId });
  }
  startPolling();
  if (!silent && isToolMode()) {
    showToast(force ? 'Refreshed from database.' : 'Schedule loaded.');
  }
}

async function saveSchedule({ silent = false } = {}) {
  if (!ctx.canEdit || !ctx.state) return;
  if (ctx.autoSaveInFlight) {
    if (!silent) scheduleAutoSave();
    return;
  }
  cancelAutoSave();
  ctx.autoSaveInFlight = true;
  try {
    const timezone = resolveTimeZone();
    ctx.timezone = timezone;
    ctx.state.timezone = timezone;

    let reflow = null;
    if (ctx.durationsDirty) {
      reflow = await reflowPlacedSchedule();
    }

    const seqAtStart = ctx.editSeq || 0;
    const saved = await apiFetch(
      `/api/live-schedule/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(ctx.eventId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ state: ctx.state })
      }
    );
    if ((ctx.editSeq || 0) !== seqAtStart) {
      // A local edit landed while this save was in flight (e.g. lengthening a break).
      // Keep the newer board and let the finally-block auto-save it.
      ctx.updatedAt = saved.updated_at;
      return;
    }
    ctx.state = saved.state;
    ctx.updatedAt = saved.updated_at;
    if (saved.timezone && isValidTimeZone(saved.timezone)) {
      ctx.timezone = saved.timezone;
    }
    clearDirty();
    renderViewer();

    if (silent) {
      if (reflow?.reflowed && reflow.skipped) {
        showToast(
          `Saved — board reflowed (${reflow.placed} placed, ${reflow.skipped} moved to scratch).`
        );
      }
      return;
    }

    if (reflow?.reflowed) {
      if (reflow.skipped) {
        showToast(
          `Schedule saved and board reflowed (${reflow.placed} placed, ${reflow.skipped} moved to scratch).`
        );
      } else {
        showToast(`Schedule saved and board reflowed (${reflow.placed} placed).`);
      }
    } else {
      showToast('Schedule saved.');
    }
  } finally {
    ctx.autoSaveInFlight = false;
    if (ctx.dirty) scheduleAutoSave();
  }
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

  const dropTargetFromPoint = timelineDropTargetFromPoint;

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

  const ghostDurationFor = (payload) => {
    if (ctx.pendingBreak && !payload) return ctx.pendingBreak.duration;
    if (!payload?.id) return SLOT;
    return itemDuration(payload.id);
  };

  const updateDragGhost = (clientX, clientY, payload = activeDrag) => {
    const placing = Boolean(ctx.pendingBreak) && !payload;
    const dragging = Boolean(payload && (payload.from === 'scratch' || payload.from === 'board'));
    if (!placing && !dragging) {
      removeDragGhost();
      return null;
    }
    const target = dropTargetFromPoint(clientX, clientY);
    if (!target) {
      removeDragGhost();
      return null;
    }

    const duration = ghostDurationFor(payload);
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
    ghost.classList.toggle('is-break', placing || isBreakId(payload?.id));
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
    cancelPendingBreak({ silent: true });
    block.classList.add('da-dragging');
    document.querySelectorAll(`#liveBoard .da-schedule-block[data-id="${CSS.escape(block.getAttribute('data-id'))}"]`)
      .forEach((el) => el.classList.add('da-dragging'));
    setPayload(e.dataTransfer, {
      id: block.getAttribute('data-id'),
      from: 'board',
      kind: block.getAttribute('data-kind') || 'division'
    });
  });

  document.getElementById('liveBoard')?.addEventListener('dragend', (e) => {
    document.querySelectorAll('#liveBoard .da-schedule-block.da-dragging').forEach((el) => {
      el.classList.remove('da-dragging');
    });
    e.target.closest('.da-schedule-block')?.classList.remove('da-dragging');
    activeDrag = null;
    clearDropTargets();
    removeDragGhost();
    removeDragImage();
    ctx.suppressBlockClick = true;
    window.setTimeout(() => {
      ctx.suppressBlockClick = false;
    }, 0);
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
    ctx.suppressScratchClick = true;
    window.setTimeout(() => {
      ctx.suppressScratchClick = false;
    }, 0);
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
    showToast(isBreakId(payload.id) ? 'Break moved to scratch.' : 'Moved to scratch.');
  });

  const boardDrop = document.getElementById('liveBoardDrop');
  boardDrop?.addEventListener('dragover', (e) => {
    const canPlacePending = Boolean(ctx.pendingBreak) && !activeDrag;
    const canDropDrag = Boolean(activeDrag && (activeDrag.from === 'scratch' || activeDrag.from === 'board'));
    if (!ctx.canEdit || (!canPlacePending && !canDropDrag)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    boardDrop.classList.add('is-drop-target');
    updateDragGhost(e.clientX, e.clientY);
  });
  boardDrop?.addEventListener('mousemove', (e) => {
    if (!ctx.canEdit || !ctx.pendingBreak || activeDrag) return;
    updateDragGhost(e.clientX, e.clientY, null);
  });
  boardDrop?.addEventListener('dragleave', (e) => {
    if (!boardDrop.contains(e.relatedTarget)) {
      boardDrop.classList.remove('is-drop-target');
      removeDragGhost();
    }
  });
  boardDrop?.addEventListener('mouseleave', () => {
    if (ctx.pendingBreak && !activeDrag) removeDragGhost();
  });
  boardDrop?.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropTargets();
    const payload = activeDrag;
    const preview = updateDragGhost(e.clientX, e.clientY);
    removeDragGhost();
    removeDragImage();
    activeDrag = null;
    if (!ctx.canEdit) return;

    const target = preview || dropTargetFromPoint(e.clientX, e.clientY);
    if (!target) {
      if (payload) showToast('Drop onto a ring lane to place.', true);
      return;
    }

    if (ctx.pendingBreak && !payload) {
      placePendingBreakAt(target.dayIndex, target.ringIndex, target.startOffset);
      return;
    }
    if (!payload || (payload.from !== 'scratch' && payload.from !== 'board')) return;

    if (payload.from === 'board') {
      const ok = placeBlockAt(payload.id, target.dayIndex, target.ringIndex, target.startOffset);
      if (ok) showToast(isBreakId(payload.id) ? 'Break moved.' : 'Moved.');
      return;
    }
    placeFromScratchAt(payload.id, target.dayIndex, target.ringIndex, target.startOffset);
  });

  const clearTouchDragVisuals = () => {
    document.querySelectorAll('#liveBoard .da-schedule-block.da-dragging, .live-scratch-item.da-dragging')
      .forEach((el) => el.classList.remove('da-dragging'));
    activeDrag = null;
    clearDropTargets();
    removeDragGhost();
    removeDragImage();
  };

  const dropOntoBoard = (clientX, clientY, payload) => {
    const preview = payload ? updateDragGhost(clientX, clientY, payload) : null;
    removeDragGhost();
    removeDragImage();
    if (!ctx.canEdit) return;

    const target = preview || dropTargetFromPoint(clientX, clientY);
    if (!target) {
      if (payload) showToast('Drop onto a ring lane to place.', true);
      return;
    }

    if (ctx.pendingBreak && !payload) {
      placePendingBreakAt(target.dayIndex, target.ringIndex, target.startOffset);
      return;
    }
    if (!payload || (payload.from !== 'scratch' && payload.from !== 'board')) return;

    if (payload.from === 'board') {
      const ok = placeBlockAt(payload.id, target.dayIndex, target.ringIndex, target.startOffset);
      if (ok) showToast(isBreakId(payload.id) ? 'Break moved.' : 'Moved.');
      return;
    }
    placeFromScratchAt(payload.id, target.dayIndex, target.ringIndex, target.startOffset);
  };

  bindTouchDnD(document, {
    selector: '.da-schedule-block[data-id], .live-scratch-item[data-id]',
    onDragStart(el) {
      if (!ctx.canEdit) return false;
      hideContextMenu();
      cancelPendingBreak({ silent: true });

      if (el.classList.contains('da-schedule-block')) {
        const id = el.getAttribute('data-id');
        el.classList.add('da-dragging');
        document.querySelectorAll(`#liveBoard .da-schedule-block[data-id="${CSS.escape(id)}"]`)
          .forEach((node) => node.classList.add('da-dragging'));
        const payload = {
          id,
          from: 'board',
          kind: el.getAttribute('data-kind') || 'division'
        };
        activeDrag = payload;
        return payload;
      }

      if (el.classList.contains('live-scratch-item')) {
        el.classList.add('da-dragging');
        const payload = { id: el.getAttribute('data-id'), from: 'scratch' };
        activeDrag = payload;
        return payload;
      }

      return false;
    },
    onDragMove(touch, payload, under) {
      if (!payload) return;
      clearDropTargets();
      if (payload.from === 'board' && under?.closest('#liveScratchDrop') && isScratchPadVisible()) {
        scratchDrop?.classList.add('is-drop-target');
        removeDragGhost();
        return;
      }
      if (under?.closest('#liveBoardDrop')) {
        boardDrop?.classList.add('is-drop-target');
        updateDragGhost(touch.clientX, touch.clientY, payload);
        return;
      }
      removeDragGhost();
    },
    onDragEnd(touch, payload, under) {
      if (!payload) {
        clearTouchDragVisuals();
        return;
      }
      clearDropTargets();
      if (payload.from === 'board' && under?.closest('#liveScratchDrop') && isScratchPadVisible()) {
        sendToScratch([payload.id]);
        renderViewer();
        showToast(isBreakId(payload.id) ? 'Break moved to scratch.' : 'Moved to scratch.');
        clearTouchDragVisuals();
        ctx.suppressScratchClick = true;
        window.setTimeout(() => { ctx.suppressScratchClick = false; }, 0);
        return;
      }
      if (under?.closest('#liveBoardDrop')) {
        dropOntoBoard(touch.clientX, touch.clientY, payload);
        clearTouchDragVisuals();
        ctx.suppressBlockClick = true;
        window.setTimeout(() => { ctx.suppressBlockClick = false; }, 0);
        return;
      }
      clearTouchDragVisuals();
    },
    onDragCancel() {
      clearTouchDragVisuals();
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

  document.getElementById('liveContextMenu')?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.getElementById('liveContextMenu')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !ctx.contextId) return;
    e.preventDefault();
    e.stopPropagation();
    const id = ctx.contextId;
    const action = btn.getAttribute('data-action');
    if (action === 'longer' || action === 'shorter') {
      const slots = Math.max(1, Number(btn.getAttribute('data-slots') || 1));
      adjustDurationSlots(id, action === 'longer' ? slots : -slots);
    }
    else if (action === 'delete-break' && isBreakId(id)) {
      removeBreak(id);
      markDirty();
      renderViewer();
      showToast('Break deleted.');
    }
    hideContextMenu();
  });

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('liveContextMenu');
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target)) return;
    hideContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
      cancelPendingBreak();
    }
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
    Object.values(ctx.state.breaks || {}).forEach((br) => {
      if (br?.all_rings) {
        br.ring_index = 0;
        br.ring_span = n;
      }
    });
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

  document.getElementById('liveAddBreakOneBtn')?.addEventListener('click', () => {
    beginPendingBreak(false);
  });

  document.getElementById('liveAddBreakAllBtn')?.addEventListener('click', () => {
    beginPendingBreak(true);
  });

  document.getElementById('liveAutoFillBtn')?.addEventListener('click', async () => {
    try {
      await autoFillSchedule();
    } catch (err) {
      showToast(err.message || 'Unable to auto-fill schedule.', true);
    }
  });

  document.getElementById('liveBoard')?.addEventListener('click', (e) => {
    if (ctx.pendingBreak && ctx.canEdit) {
      const target = timelineDropTargetFromPoint(e.clientX, e.clientY);
      if (!target) return;
      e.preventDefault();
      placePendingBreakAt(target.dayIndex, target.ringIndex, target.startOffset);
      return;
    }
    const block = e.target.closest('.da-schedule-block[data-id]');
    if (!block || ctx.suppressBlockClick) return;
    if ((block.getAttribute('data-kind') || 'division') === 'break') return;

    const divisionId = block.getAttribute('data-id');
    if (isToolMode() && ctx.canEdit) {
      ctx.selectedId = divisionId;
      renderBoard();
    }
    openDivisionModal(divisionId);
  });

  document.getElementById('liveDivisionModalClose')?.addEventListener('click', closeDivisionModal);
  document.getElementById('liveDivisionModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'liveDivisionModal') closeDivisionModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('liveDivisionModal');
    if (modal && !modal.hidden) closeDivisionModal();
  });

  document.getElementById('liveScratchDrop')?.addEventListener('click', (e) => {
    if (!ctx.canEdit || !ctx.pendingBreak) return;
    e.preventDefault();
    placePendingBreakOnScratch();
  });

  document.getElementById('liveScratchList')?.addEventListener('click', (e) => {
    if (ctx.pendingBreak || ctx.suppressScratchClick) return;
    const item = e.target.closest('.live-scratch-item[data-id]');
    if (!item) return;
    const id = item.getAttribute('data-id');
    const kind = item.getAttribute('data-kind') || 'division';
    ctx.selectedId = id;
    renderViewer();
    if (kind !== 'break') openDivisionModal(id);
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
  bindTimesPanel();
  bindLiveScrollAffordances();
  window.addEventListener('resize', () => {
    renderScratch();
    syncLiveScrollAffordances();
  });
}

function bindTimesPanel() {
  if (ctx.timesBound) return;
  ctx.timesBound = true;

  document.getElementById('liveToolTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-live-tab]');
    if (!btn || !ctx.canEdit) return;
    setToolTab(btn.getAttribute('data-live-tab'));
  });

  document.getElementById('liveApplySelectedBtn')?.addEventListener('click', () => {
    applyBulkToSelected();
  });
  document.getElementById('liveApplyAllBtn')?.addEventListener('click', () => {
    applyBulkToAllShown();
  });
  document.getElementById('liveResetTimesBtn')?.addEventListener('click', () => {
    resetAllTimes();
  });

  document.getElementById('liveTimesSelectAll')?.addEventListener('change', (e) => {
    if (!ctx.canEdit) return;
    const checked = Boolean(e.target.checked);
    catalogFiltered().forEach((entry) => {
      const id = String(entry.id);
      if (checked) ctx.selectedDurationIds.add(id);
      else ctx.selectedDurationIds.delete(id);
    });
    renderTimesTable();
  });

  document.getElementById('liveEventFilterBtns')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-event-filter]');
    if (!btn) return;
    const key = btn.getAttribute('data-event-filter');
    if (!key) return;
    if (ctx.eventFilters.has(key)) ctx.eventFilters.delete(key);
    else ctx.eventFilters.add(key);
    renderTimesTable();
  });

  document.getElementById('liveBeltFilterBtns')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-belt-filter]');
    if (!btn) return;
    const key = btn.getAttribute('data-belt-filter');
    if (!key) return;
    if (ctx.beltFilters.has(key)) ctx.beltFilters.delete(key);
    else ctx.beltFilters.add(key);
    renderTimesTable();
  });

  const body = document.getElementById('liveTimesBody');
  body?.addEventListener('click', (e) => {
    if (!ctx.canEdit) return;
    if (e.target.closest('input.live-times-cell-input')) return;
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.getAttribute('data-id');
    const check = e.target.closest('.live-times-row-check');
    if (check) {
      if (check.checked) ctx.selectedDurationIds.add(id);
      else ctx.selectedDurationIds.delete(id);
      row.classList.toggle('selected', check.checked);
      updateTimesFooter();
      const selectAll = document.getElementById('liveTimesSelectAll');
      if (selectAll) {
        const entries = catalogFiltered();
        selectAll.checked = entries.length > 0
          && entries.every((entry) => ctx.selectedDurationIds.has(String(entry.id)));
      }
      return;
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      if (ctx.selectedDurationIds.has(id)) ctx.selectedDurationIds.delete(id);
      else ctx.selectedDurationIds.add(id);
    } else {
      ctx.selectedDurationIds.clear();
      ctx.selectedDurationIds.add(id);
    }
    renderTimesTable();
  });

  body?.addEventListener('change', (e) => {
    const input = e.target.closest('.live-times-cell-input');
    if (!input || !ctx.canEdit) return;
    const id = input.getAttribute('data-id');
    const field = input.classList.contains('live-times-match') ? 'match' : 'buffer';
    setCellDuration(id, field, input.value);
  });

  body?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('.live-times-cell-input');
    if (!input) return;
    e.preventDefault();
    input.blur();
  });
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
  const row = document.getElementById('liveEventSelectRow');
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
    ctx.savedItems = items;
    if (row) row.hidden = !isToolMode();

    if (!items.length) {
      select.innerHTML = '<option value="">— no saved schedules —</option>';
      if (empty) empty.hidden = false;
      if (pickerPanel) pickerPanel.hidden = false;
      return true;
    }

    select.innerHTML = '<option value="">— choose a schedule —</option>' + items.map((item) => {
      return `<option value="${escapeHtml(item.eventId)}">${escapeHtml(formatOptionLabel(item))}</option>`;
    }).join('');

    const pick = resolvePickerSelection(items, selectedEventId);
    if (pick) select.value = pick;
    return true;
  } catch (err) {
    ctx.savedItems = [];
    if (row) row.hidden = true;
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
  const loaded = await loadEventOptions({
    selectedEventId: ctx.eventId
  });
  if (!loaded) return;
  if (isToolMode() && !ctx.eventId && ctx.clientId) {
    const preferred = resolvePickerSelection(ctx.savedItems, readLastEventId());
    if (preferred) {
      window.location.replace(scheduleHref(ctx.clientId, preferred));
    }
  }
}

async function applyPortalDataUpdate(payload = {}) {
  if (!isToolMode()) return;
  const eventId = String(payload.eventId || '').trim();
  const deleted = Boolean(payload.deleted);
  if (eventId) rememberLastEventId(eventId);

  const sameEvent = !ctx.eventId || !eventId || String(ctx.eventId) === eventId;
  if (sameEvent) {
    cancelAutoSave();
    ctx.dirty = false;
  }

  const loaded = await loadEventOptions({
    selectedEventId: ctx.eventId || eventId
  });
  if (!loaded) return;

  if (deleted && eventId && String(ctx.eventId) === eventId) {
    ctx.state = null;
    ctx.eventId = '';
    ctx.event = null;
    ctx.updatedAt = null;
    stopPolling();
    await showPicker();
    return;
  }

  if (ctx.clientId && ctx.eventId && sameEvent) {
    try {
      await refreshSchedule({ silent: true, force: true });
    } catch (err) {
      await showPicker();
    }
    return;
  }

  if (ctx.eventId) return;

  const preferred = preferredSavedEventId(ctx.savedItems);
  if (preferred && ctx.clientId) {
    window.location.replace(scheduleHref(ctx.clientId, preferred));
  }
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
    rememberLastEventId(eventId);
    notifyPortalEventSelected(eventId);
    window.location.href = scheduleHref(ctx.clientId, eventId);
  });

  const refreshBtn = document.getElementById('liveScheduleRefreshBtn');
  refreshBtn?.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('is-busy');
    try {
      if (ctx.clientId && ctx.eventId) {
        await refreshSchedule({ silent: false, force: true });
      } else {
        await loadEventOptions();
        const preferred = preferredSavedEventId(ctx.savedItems);
        if (preferred && ctx.clientId) {
          window.location.replace(scheduleHref(ctx.clientId, preferred));
          return;
        }
        showToast('Refreshed from database.');
      }
    } catch (err) {
      showToast(err.message || 'Unable to refresh schedule.', true);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('is-busy');
    }
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data) return;
    if (event.data.type === 'portal-focus-day') {
      try {
        localStorage.setItem(PORTAL_FOCUS_DAY_KEY, String(Math.max(0, Number(event.data.dayIndex) || 0)));
      } catch (_) { /* ignore */ }
      if (!isToolMode()) scrollBoardToNow({ smooth: true });
      return;
    }
    if (event.data.type === 'portal-event-selected') {
      const eventId = String(event.data.eventId || '').trim();
      if (!eventId || eventId === String(ctx.eventId || '')) return;
      rememberLastEventId(eventId);
      const known = !ctx.savedItems.length
        || ctx.savedItems.some((item) => String(item.eventId) === eventId);
      if (!known) return;
      const go = (clientId) => {
        if (clientId) window.location.href = scheduleHref(clientId, eventId);
      };
      if (ctx.clientId) {
        go(ctx.clientId);
        return;
      }
      loadEventOptions({ selectedEventId: eventId }).then(() => go(ctx.clientId));
      return;
    }
    if (event.data.type !== 'portal-data-updated') return;
    applyPortalDataUpdate(event.data).catch((err) => {
      showToast(err.message || 'Unable to refresh schedule.', true);
    });
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== PORTAL_FOCUS_DAY_KEY) return;
    if (!isToolMode()) scrollBoardToNow({ smooth: true });
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
    rememberLastEventId(route.eventId);
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
