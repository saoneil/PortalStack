/**
 * Schedule packing — port of Python DivisionToolApp place/pack helpers.
 * Supports durations, pack order, scratch pad, age/rank sort metadata.
 */

const { RANK_ORDER } = require('./constants');

const SCHEDULE_FORMAT_VERSION = 5;
const SCHEDULE_SLOT_MINUTES = 5;
const SCHEDULE_MIN_GAP_MINUTES = 5;
const DEFAULT_RING_COUNT = 3;
const DEFAULT_MATCH_MINUTES = 3;
const DEFAULT_BUFFER_MINUTES = 0.5;
const DEFAULT_DAY = { name: 'Day 1', start_time: '08:00', end_time: '18:00' };

const RANK_INDEX = Object.fromEntries(
  RANK_ORDER.map((rank, idx) => [String(rank).toLowerCase(), idx])
);

function parseHhmm(text) {
  const match = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

function formatHhmm(totalMinutes) {
  const m = Math.max(0, Math.floor(totalMinutes));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function dayWindowMinutes(day) {
  const start = parseHhmm(day?.start_time || '08:00');
  let end = parseHhmm(day?.end_time || '18:00');
  if (start == null || end == null) return 12 * 60;
  if (end <= start) end += 24 * 60;
  return Math.max(SCHEDULE_SLOT_MINUTES, end - start);
}

function snapMinutes(minutes) {
  let m = Math.max(0, Math.floor(minutes));
  const rem = m % SCHEDULE_SLOT_MINUTES;
  if (rem) m += SCHEDULE_SLOT_MINUTES - rem;
  return m;
}

function premierMatchCountFallback(n) {
  if (n < 6) return 0;
  const poolCount = n <= 12 ? 2 : n <= 24 ? 4 : 8;
  const base = Math.floor(n / poolCount);
  const rem = n % poolCount;
  const sizes = Array.from({ length: poolCount }, (_, i) => base + (i < rem ? 1 : 0));
  const poolRr = sizes.reduce((sum, p) => sum + (p >= 2 ? (p * (p - 1)) / 2 : 0), 0);
  const elim = { 2: 1, 4: 3, 8: 7 }[poolCount] || 0;
  return poolRr + elim;
}

function matchCount(entry) {
  const divisionType = String(entry.division_type || '').trim();
  const n = Number(entry.athlete_count || 0) || 0;
  const jsonData = entry.json_data;

  if (divisionType === 'List') return Math.max(0, n);

  if (jsonData && typeof jsonData === 'object') {
    if (divisionType === 'Single Elimination' || divisionType === 'Round Robin') {
      return (jsonData.matches || []).length;
    }
    if (divisionType === 'Premier League') {
      const poolMatches = (jsonData.pools || []).reduce(
        (sum, p) => sum + ((p.round_robin_matches || []).length),
        0
      );
      const elimMatches = (
        ((jsonData.elimination || {}).matches || jsonData.elimination_matches || [])
      ).length;
      return poolMatches + elimMatches;
    }
  }

  if (n <= 0) return 0;
  if (divisionType === 'Single Elimination') return Math.max(0, n - 1);
  if (divisionType === 'Round Robin') return (n * (n - 1)) / 2;
  if (divisionType === 'Premier League') return premierMatchCountFallback(n);
  return 0;
}

function divisionDurationMinutes(entry, matchDurations, bufferDurations) {
  const id = String(entry.id || '').trim();
  const match = Number(matchDurations[id] || 0) || 0;
  const buffer = Number(bufferDurations[id] || 0) || 0;
  return (match + buffer) * matchCount(entry);
}

function displayDurationMinutes(entry, matchDurations, bufferDurations) {
  const raw = divisionDurationMinutes(entry, matchDurations, bufferDurations);
  if (raw <= 0) return 0;
  const slots = Math.ceil(raw / SCHEDULE_SLOT_MINUTES);
  return Math.max(SCHEDULE_SLOT_MINUTES, slots * SCHEDULE_SLOT_MINUTES);
}

function entryAthletes(entry) {
  return Array.isArray(entry?.athletes) ? entry.athletes : [];
}

function divisionHasBlackBelt(entry) {
  return entryAthletes(entry).some((a) => String(a.rank || '').toLowerCase().includes('dan'));
}

function beltCategory(entry) {
  return divisionHasBlackBelt(entry) ? 'black' : 'color';
}

function entryMinAge(entry) {
  const ages = entryAthletes(entry)
    .map((a) => (a.age != null ? Number(a.age) : null))
    .filter((a) => a != null && !Number.isNaN(a));
  if (!ages.length) return null;
  return Math.min(...ages);
}

function entryMaxAge(entry) {
  const ages = entryAthletes(entry)
    .map((a) => (a.age != null ? Number(a.age) : null))
    .filter((a) => a != null && !Number.isNaN(a));
  if (!ages.length) return null;
  return Math.max(...ages);
}

function entryMinRankIndex(entry) {
  const idxs = entryAthletes(entry)
    .map((a) => RANK_INDEX[String(a.rank || '').trim().toLowerCase()])
    .filter((idx) => idx != null);
  if (!idxs.length) return null;
  return Math.min(...idxs);
}

function entryMatchesAgeFilter(entry, ageMin, ageMax) {
  const min = ageMin == null || ageMin === '' ? null : Number(ageMin);
  const max = ageMax == null || ageMax === '' ? null : Number(ageMax);
  if ((min == null || Number.isNaN(min)) && (max == null || Number.isNaN(max))) return true;
  const athletes = entryAthletes(entry);
  if (!athletes.length) return false;
  return athletes.some((a) => {
    const age = a.age != null ? Number(a.age) : null;
    if (age == null || Number.isNaN(age)) return false;
    if (min != null && !Number.isNaN(min) && age < min) return false;
    if (max != null && !Number.isNaN(max) && age > max) return false;
    return true;
  });
}

function filterCatalog(entries, {
  belt = 'all',
  ageMin = null,
  ageMax = null,
  hideTimed = false,
  matchDurations = {},
  bufferDurations = {}
} = {}) {
  return (entries || []).filter((entry) => {
    if (belt === 'color' && beltCategory(entry) !== 'color') return false;
    if (belt === 'black' && beltCategory(entry) !== 'black') return false;
    if (!entryMatchesAgeFilter(entry, ageMin, ageMax)) return false;
    if (hideTimed && displayDurationMinutes(entry, matchDurations, bufferDurations) > 0) return false;
    return true;
  });
}

function sortCatalog(entries, mode = 'catalog') {
  const list = [...(entries || [])];
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
        if (ar == null && br == null) {
          return String(a.division_name || '').localeCompare(String(b.division_name || ''));
        }
        if (ar == null) return 1;
        if (br == null) return -1;
        if (ar !== br) return ar - br;
      }
      return String(a.division_name || '').localeCompare(String(b.division_name || ''));
    });
  } else if (mode === 'rank' || mode === 'rank_age') {
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
        if (aa == null && ba == null) {
          return String(a.division_name || '').localeCompare(String(b.division_name || ''));
        }
        if (aa == null) return 1;
        if (ba == null) return -1;
        if (aa !== ba) return aa - ba;
      }
      return String(a.division_name || '').localeCompare(String(b.division_name || ''));
    });
  } else if (mode === 'name') {
    list.sort((a, b) => String(a.division_name || '').localeCompare(String(b.division_name || '')));
  }
  return list;
}

function enrichCatalogFromGroupings(catalog, groupingsState) {
  const byId = {};
  (groupingsState?.catalog || []).forEach((entry) => {
    byId[String(entry.id)] = entry;
  });
  return (catalog || []).map((entry) => {
    const source = byId[String(entry.id)];
    if (!source) return entry;
    const athletes = Array.isArray(source.athletes) ? JSON.parse(JSON.stringify(source.athletes)) : [];
    return {
      ...entry,
      athletes,
      event_key: entry.event_key || source.event_key || '',
      age_min: source.age_min != null ? source.age_min : entry.age_min,
      age_max: source.age_max != null ? source.age_max : entry.age_max,
      rank_min: source.rank_min || entry.rank_min || '',
      rank_max: source.rank_max || entry.rank_max || ''
    };
  });
}

function ensurePackOrder(state) {
  const catalogIds = (state.catalog || []).map((e) => String(e.id));
  const existing = Array.isArray(state.pack_order) ? state.pack_order.map(String) : [];
  const kept = existing.filter((id) => catalogIds.includes(id));
  const missing = catalogIds.filter((id) => !kept.includes(id));
  return { ...state, pack_order: [...kept, ...missing] };
}

function occupiedIntervals(state, dayIndex, excludeId = null) {
  const intervals = [];
  const ringCount = state.ring_count || DEFAULT_RING_COUNT;
  Object.entries(state.placements || {}).forEach(([divisionId, placement]) => {
    if (excludeId && divisionId === excludeId) return;
    const pDay = Number(placement.day_index || 0);
    const ring = Number(placement.ring_index || 0);
    const start = Number(placement.start_offset_minutes || 0);
    if (pDay !== dayIndex || ring < 0 || ring >= ringCount) return;
    const entry = (state.catalog || []).find((e) => String(e.id) === divisionId);
    if (!entry) return;
    const duration = displayDurationMinutes(entry, state.match_durations, state.buffer_durations);
    if (duration <= 0) return;
    intervals.push({ ring, start, end: start + duration, id: divisionId });
  });
  Object.entries(state.breaks || {}).forEach(([breakId, block]) => {
    if (excludeId && breakId === excludeId) return;
    const pDay = Number(block.day_index || 0);
    if (pDay !== dayIndex) return;
    const ring = Number(block.ring_index || 0);
    const span = Math.max(1, Number(block.ring_span || 1));
    const start = Number(block.start_offset_minutes || 0);
    const duration = Math.max(SCHEDULE_SLOT_MINUTES, snapMinutes(Number(block.duration_minutes || 0)));
    for (let r = ring; r < Math.min(ringCount, ring + span); r += 1) {
      intervals.push({ ring: r, start, end: start + duration, id: breakId });
    }
  });
  return intervals;
}

function slotFits(state, { dayIndex, ringIndex, startOffset, duration, ringSpan = 1, excludeId = null }) {
  const ringCount = state.ring_count || DEFAULT_RING_COUNT;
  const span = Math.max(1, ringSpan);
  if (ringIndex < 0 || ringIndex + span > ringCount) return false;
  const window = dayWindowMinutes((state.days || [])[dayIndex]);
  if (startOffset < 0 || startOffset + duration > window) return false;
  const intervals = occupiedIntervals(state, dayIndex, excludeId);
  const gap = SCHEDULE_MIN_GAP_MINUTES;
  for (let r = ringIndex; r < ringIndex + span; r += 1) {
    for (const iv of intervals) {
      if (iv.ring !== r) continue;
      if (startOffset < iv.end + gap && startOffset + duration + gap > iv.start) return false;
    }
  }
  return true;
}

function earliestOnRing(state, dayIndex, ringIndex, duration, ringSpan = 1, excludeId = null) {
  const window = dayWindowMinutes((state.days || [])[dayIndex]);
  let start = 0;
  while (start + duration <= window) {
    if (slotFits(state, {
      dayIndex,
      ringIndex,
      startOffset: start,
      duration,
      ringSpan,
      excludeId
    })) {
      return start;
    }
    start += SCHEDULE_SLOT_MINUTES;
  }
  return null;
}

function findPackSlot(state, entry, { startDayIndex = 0, endDayIndex = null, preferredRing = null } = {}) {
  const duration = displayDurationMinutes(entry, state.match_durations, state.buffer_durations);
  if (duration <= 0) return null;
  const ringCount = Math.max(1, state.ring_count || DEFAULT_RING_COUNT);
  const firstRing = (preferredRing != null ? preferredRing : state.pack_next_ring || 0) % ringCount;
  const days = state.days || [DEFAULT_DAY];
  const lastDay = endDayIndex == null
    ? days.length - 1
    : Math.min(endDayIndex, days.length - 1);
  for (let dayIndex = startDayIndex; dayIndex <= lastDay; dayIndex += 1) {
    for (let step = 0; step < ringCount; step += 1) {
      const ringIndex = (firstRing + step) % ringCount;
      const start = earliestOnRing(state, dayIndex, ringIndex, duration);
      if (start != null) return { dayIndex, ringIndex, startOffset: start };
    }
  }
  return null;
}

function applyDefaultDurations(state) {
  const matchDurations = { ...(state.match_durations || {}) };
  const bufferDurations = { ...(state.buffer_durations || {}) };
  (state.catalog || []).forEach((entry) => {
    const id = String(entry.id || '').trim();
    if (!id) return;
    if (!(id in matchDurations) || !Number(matchDurations[id])) {
      matchDurations[id] = DEFAULT_MATCH_MINUTES;
    }
    if (!(id in bufferDurations)) {
      bufferDurations[id] = DEFAULT_BUFFER_MINUTES;
    }
  });
  return { ...state, match_durations: matchDurations, buffer_durations: bufferDurations };
}

function setDurationsForIds(state, divisionIds, { matchMinutes = null, bufferMinutes = null } = {}) {
  const next = JSON.parse(JSON.stringify(state));
  next.match_durations = next.match_durations || {};
  next.buffer_durations = next.buffer_durations || {};
  divisionIds.forEach((rawId) => {
    const id = String(rawId || '').trim();
    if (!id) return;
    if (matchMinutes != null && matchMinutes !== '') {
      next.match_durations[id] = Math.max(0, Number(matchMinutes) || 0);
    }
    if (bufferMinutes != null && bufferMinutes !== '') {
      next.buffer_durations[id] = Math.max(0, Number(bufferMinutes) || 0);
    }
  });
  return next;
}

function placeDivisionIds(state, divisionIds, {
  replaceExisting = true,
  startDayIndex = 0,
  dayOnly = false
} = {}) {
  const next = ensurePackOrder(JSON.parse(JSON.stringify(state)));
  next.placements = next.placements || {};
  const ringCount = Math.max(1, next.ring_count || DEFAULT_RING_COUNT);
  const days = next.days || [DEFAULT_DAY];
  const dayStart = Math.max(0, Math.min(Number(startDayIndex) || 0, days.length - 1));
  const dayEnd = dayOnly ? dayStart : null;
  let placed = 0;
  let skipped = 0;

  if (replaceExisting) {
    divisionIds.forEach((id) => {
      delete next.placements[String(id).trim()];
    });
    next.pack_next_ring = 0;
  }

  divisionIds.forEach((rawId) => {
    const divisionId = String(rawId || '').trim();
    if (!divisionId) return;
    const entry = (next.catalog || []).find((e) => String(e.id) === divisionId);
    if (!entry) {
      skipped += 1;
      return;
    }
    if (displayDurationMinutes(entry, next.match_durations, next.buffer_durations) <= 0) {
      skipped += 1;
      return;
    }
    if (!replaceExisting && next.placements[divisionId]) {
      skipped += 1;
      return;
    }
    next.scratch_ids = (next.scratch_ids || []).filter((d) => d !== divisionId);
    const preferred = (next.pack_next_ring || 0) % ringCount;
    const slot = findPackSlot(next, entry, {
      startDayIndex: dayStart,
      endDayIndex: dayEnd,
      preferredRing: preferred
    });
    if (!slot) {
      skipped += 1;
      return;
    }
    next.placements[divisionId] = {
      day_index: slot.dayIndex,
      ring_index: slot.ringIndex,
      start_offset_minutes: slot.startOffset
    };
    next.pack_next_ring = (slot.ringIndex + 1) % ringCount;
    placed += 1;
  });

  return { state: next, placed, skipped };
}

function buildCatalogFromDraws(drawsState, groupingsState = null) {
  let catalog = (drawsState?.catalog || [])
    .filter((e) => Number(e.athlete_count || 0) > 0)
    .map((e) => JSON.parse(JSON.stringify(e)));
  if (groupingsState) {
    catalog = enrichCatalogFromGroupings(catalog, groupingsState);
  }
  return catalog;
}

function createEmptyScheduleState(catalog, ringCount = DEFAULT_RING_COUNT) {
  let state = {
    format_version: SCHEDULE_FORMAT_VERSION,
    match_durations: {},
    buffer_durations: {},
    placements: {},
    breaks: {},
    scratch_ids: [],
    pack_order: catalog.map((e) => String(e.id)),
    pack_next_ring: 0,
    color_code: false,
    days: [{ ...DEFAULT_DAY }],
    active_day_index: 0,
    ring_count: Math.max(1, Math.min(32, Number(ringCount) || DEFAULT_RING_COUNT)),
    catalog
  };
  state = applyDefaultDurations(state);
  return ensurePackOrder(state);
}

function createScheduleFromDraws(drawsState, options = {}) {
  const catalog = buildCatalogFromDraws(drawsState, options.groupingsState || null);
  let state = createEmptyScheduleState(catalog, options.ringCount);
  if (options.days) state.days = options.days;
  if (options.autoPlace === false) {
    return { state, placed: 0, skipped: 0 };
  }
  const ids = state.pack_order || catalog.map((e) => String(e.id));
  const packed = placeDivisionIds(state, ids, { replaceExisting: true });
  return {
    state: packed.state,
    placed: packed.placed,
    skipped: packed.skipped
  };
}

/**
 * Create or update the single event schedule from current draws.
 * - create / no existing: full auto-pack
 * - update: keep days/rings/times/placements/scratch; refresh catalog; pack only new unplaced ids
 */
function syncScheduleFromDraws(existingState, drawsState, options = {}) {
  const mode = options.mode || (existingState ? 'update' : 'create');
  if (mode === 'create' || !existingState || typeof existingState !== 'object') {
    return createScheduleFromDraws(drawsState, {
      groupingsState: options.groupingsState || null,
      ringCount: options.ringCount,
      autoPlace: options.autoPlace !== false
    });
  }

  const catalog = buildCatalogFromDraws(drawsState, options.groupingsState || null);
  const catalogIds = new Set(catalog.map((e) => String(e.id)));
  let next = JSON.parse(JSON.stringify(existingState));
  next.catalog = catalog;
  next.format_version = SCHEDULE_FORMAT_VERSION;
  next.placements = next.placements || {};
  next.breaks = next.breaks || {};
  next.scratch_ids = Array.isArray(next.scratch_ids) ? next.scratch_ids : [];
  next.match_durations = next.match_durations || {};
  next.buffer_durations = next.buffer_durations || {};

  Object.keys(next.placements).forEach((id) => {
    if (!catalogIds.has(String(id))) delete next.placements[id];
  });
  next.scratch_ids = next.scratch_ids.filter((id) => catalogIds.has(String(id)));
  Object.keys(next.match_durations).forEach((id) => {
    if (!catalogIds.has(String(id))) delete next.match_durations[id];
  });
  Object.keys(next.buffer_durations).forEach((id) => {
    if (!catalogIds.has(String(id))) delete next.buffer_durations[id];
  });

  next = applyDefaultDurations(next);
  next = ensurePackOrder(next);
  next = clampScheduleToBounds(next);

  const scratchSet = new Set((next.scratch_ids || []).map(String));
  const toPack = (next.pack_order || catalog.map((e) => String(e.id))).filter((id) => {
    if (!catalogIds.has(String(id))) return false;
    if (next.placements[String(id)]) return false;
    if (scratchSet.has(String(id))) return false;
    return true;
  });

  if (!toPack.length) {
    return { state: next, placed: 0, skipped: 0 };
  }
  const packed = placeDivisionIds(next, toPack, { replaceExisting: false });
  return {
    state: packed.state,
    placed: packed.placed,
    skipped: packed.skipped
  };
}

/** Drop or clamp placements/breaks that fall outside current days/rings. */
function clampScheduleToBounds(state) {
  const next = JSON.parse(JSON.stringify(state || {}));
  const ringCount = Math.max(1, Math.min(32, Number(next.ring_count) || DEFAULT_RING_COUNT));
  next.ring_count = ringCount;
  if (!Array.isArray(next.days) || !next.days.length) {
    next.days = [{ ...DEFAULT_DAY }];
  }
  const dayCount = next.days.length;
  next.active_day_index = Math.max(0, Math.min(Number(next.active_day_index) || 0, dayCount - 1));
  next.placements = next.placements || {};
  next.breaks = next.breaks || {};
  next.scratch_ids = Array.isArray(next.scratch_ids) ? next.scratch_ids.map(String) : [];

  Object.entries(next.placements).forEach(([id, placement]) => {
    const dayIndex = Number(placement?.day_index || 0);
    const ringIndex = Number(placement?.ring_index || 0);
    if (dayIndex < 0 || dayIndex >= dayCount || ringIndex < 0 || ringIndex >= ringCount) {
      delete next.placements[id];
      if (!next.scratch_ids.includes(String(id))) next.scratch_ids.push(String(id));
    }
  });

  Object.entries(next.breaks).forEach(([breakId, br]) => {
    const dayIndex = Number(br?.day_index || 0);
    const ringIndex = Number(br?.ring_index || 0);
    if (dayIndex < 0 || dayIndex >= dayCount || ringIndex < 0 || ringIndex >= ringCount) {
      delete next.breaks[breakId];
    }
  });

  return ensurePackOrder(next);
}

function boardRowsForDay(state, dayIndex = 0) {
  const day = (state.days || [])[dayIndex] || DEFAULT_DAY;
  const startAbs = parseHhmm(day.start_time) ?? 8 * 60;
  const ringCount = state.ring_count || DEFAULT_RING_COUNT;
  const rows = [];

  Object.entries(state.placements || {}).forEach(([divisionId, placement]) => {
    if (Number(placement.day_index || 0) !== dayIndex) return;
    const entry = (state.catalog || []).find((e) => String(e.id) === divisionId);
    if (!entry) return;
    const duration = displayDurationMinutes(entry, state.match_durations, state.buffer_durations);
    const start = Number(placement.start_offset_minutes || 0);
    rows.push({
      kind: 'division',
      id: divisionId,
      name: entry.division_name,
      type: entry.division_type,
      event_key: entry.event_key,
      athletes: entry.athlete_count || 0,
      ring: Number(placement.ring_index || 0),
      start,
      end: start + duration,
      startLabel: formatHhmm(startAbs + start),
      endLabel: formatHhmm(startAbs + start + duration),
      duration
    });
  });

  rows.sort((a, b) => a.ring - b.ring || a.start - b.start || String(a.name).localeCompare(String(b.name)));
  return { day, ringCount, rows, startAbs };
}

module.exports = {
  SCHEDULE_FORMAT_VERSION,
  SCHEDULE_SLOT_MINUTES,
  SCHEDULE_MIN_GAP_MINUTES,
  DEFAULT_RING_COUNT,
  DEFAULT_MATCH_MINUTES,
  DEFAULT_BUFFER_MINUTES,
  createScheduleFromDraws,
  syncScheduleFromDraws,
  clampScheduleToBounds,
  createEmptyScheduleState,
  buildCatalogFromDraws,
  placeDivisionIds,
  applyDefaultDurations,
  setDurationsForIds,
  ensurePackOrder,
  filterCatalog,
  sortCatalog,
  beltCategory,
  entryMinAge,
  entryMinRankIndex,
  boardRowsForDay,
  displayDurationMinutes,
  divisionDurationMinutes,
  matchCount,
  formatHhmm,
  parseHhmm
};
