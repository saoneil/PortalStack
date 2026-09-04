import { bindTouchDnD } from './touch-dnd.js';
import { logInteraction } from './portal-log.js';

(function () {
  const RING_SLOT_GROUPS = [
    {
      id: 'officials',
      title: 'Jury / IT',
      slots: ['jury_president', 'jury_member', 'it_umpire']
    },
    {
      id: 'umpires',
      title: 'Umpires',
      slots: ['umpire_1', 'umpire_2', 'umpire_3', 'umpire_4', 'umpire_5']
    },
    {
      id: 'equipment',
      title: 'Equipment Verifiers',
      slots: ['equipment_verifier_1', 'equipment_verifier_2']
    }
  ];

  const SLOT_LABELS = {
    jury_president: 'Jury President',
    jury_member: 'Jury Member',
    it_umpire: 'IT-Umpire',
    umpire_1: 'Center Referee',
    umpire_2: 'Umpire 2',
    umpire_3: 'Umpire 3',
    umpire_4: 'Umpire 4',
    umpire_5: 'Umpire 5',
    equipment_verifier_1: 'Equipment Verifier 1',
    equipment_verifier_2: 'Equipment Verifier 2'
  };

  const SLOT_ABBREV = {
    jury_president: 'JP',
    jury_member: 'JM',
    it_umpire: 'IT',
    umpire_1: 'CR',
    umpire_2: 'R',
    umpire_3: 'R',
    umpire_4: 'R',
    umpire_5: 'R',
    equipment_verifier_1: 'EV',
    equipment_verifier_2: 'EV'
  };

  const SLOT_CAPACITY = 3;

  const UMPIRE_PREFERRED_ROLE_LABELS = {
    jury_president: 'Jury President',
    jury_member: 'Jury Member',
    it_umpire: 'IT-Umpire',
    center_referee: 'Center Referee',
    referee: 'Referee',
    equipment_verifier: 'Equipment Verifier'
  };

  const COUNTRY_TO_REGION = {
    'united states': 'North America',
    'usa': 'North America',
    'us': 'North America',
    'canada': 'North America',
    'mexico': 'North America',
    'guatemala': 'North America',
    'honduras': 'North America',
    'el salvador': 'North America',
    'nicaragua': 'North America',
    'costa rica': 'North America',
    'panama': 'North America',
    'cuba': 'North America',
    'jamaica': 'North America',
    'haiti': 'North America',
    'dominican republic': 'North America',
    'puerto rico': 'North America',
    'trinidad and tobago': 'North America',
    'bahamas': 'North America',
    'barbados': 'North America',
    'belize': 'North America',
    'argentina': 'South America',
    'brazil': 'South America',
    'chile': 'South America',
    'colombia': 'South America',
    'peru': 'South America',
    'venezuela': 'South America',
    'ecuador': 'South America',
    'bolivia': 'South America',
    'paraguay': 'South America',
    'uruguay': 'South America',
    'guyana': 'South America',
    'suriname': 'South America',
    'united kingdom': 'Europe',
    'uk': 'Europe',
    'england': 'Europe',
    'scotland': 'Europe',
    'wales': 'Europe',
    'ireland': 'Europe',
    'northern ireland': 'Europe',
    'france': 'Europe',
    'germany': 'Europe',
    'italy': 'Europe',
    'spain': 'Europe',
    'portugal': 'Europe',
    'netherlands': 'Europe',
    'belgium': 'Europe',
    'switzerland': 'Europe',
    'austria': 'Europe',
    'sweden': 'Europe',
    'norway': 'Europe',
    'denmark': 'Europe',
    'finland': 'Europe',
    'poland': 'Europe',
    'czech republic': 'Europe',
    'czechia': 'Europe',
    'slovakia': 'Europe',
    'hungary': 'Europe',
    'romania': 'Europe',
    'bulgaria': 'Europe',
    'greece': 'Europe',
    'croatia': 'Europe',
    'serbia': 'Europe',
    'slovenia': 'Europe',
    'bosnia and herzegovina': 'Europe',
    'ukraine': 'Europe',
    'russia': 'Europe',
    'iceland': 'Europe',
    'luxembourg': 'Europe',
    'malta': 'Europe',
    'cyprus': 'Europe',
    'estonia': 'Europe',
    'latvia': 'Europe',
    'lithuania': 'Europe',
    'albania': 'Europe',
    'north macedonia': 'Europe',
    'montenegro': 'Europe',
    'moldova': 'Europe',
    'belarus': 'Europe',
    'china': 'Asia',
    'japan': 'Asia',
    'south korea': 'Asia',
    'korea': 'Asia',
    'north korea': 'Asia',
    'india': 'Asia',
    'pakistan': 'Asia',
    'bangladesh': 'Asia',
    'sri lanka': 'Asia',
    'nepal': 'Asia',
    'thailand': 'Asia',
    'vietnam': 'Asia',
    'philippines': 'Asia',
    'indonesia': 'Asia',
    'malaysia': 'Asia',
    'singapore': 'Asia',
    'taiwan': 'Asia',
    'hong kong': 'Asia',
    'macau': 'Asia',
    'mongolia': 'Asia',
    'kazakhstan': 'Asia',
    'uzbekistan': 'Asia',
    'cambodia': 'Asia',
    'laos': 'Asia',
    'myanmar': 'Asia',
    'iran': 'Asia',
    'iraq': 'Asia',
    'israel': 'Asia',
    'jordan': 'Asia',
    'lebanon': 'Asia',
    'saudi arabia': 'Asia',
    'united arab emirates': 'Asia',
    'uae': 'Asia',
    'qatar': 'Asia',
    'kuwait': 'Asia',
    'bahrain': 'Asia',
    'oman': 'Asia',
    'turkey': 'Asia',
    'afghanistan': 'Asia',
    'egypt': 'Africa',
    'south africa': 'Africa',
    'nigeria': 'Africa',
    'kenya': 'Africa',
    'ghana': 'Africa',
    'ethiopia': 'Africa',
    'morocco': 'Africa',
    'algeria': 'Africa',
    'tunisia': 'Africa',
    'libya': 'Africa',
    'sudan': 'Africa',
    'uganda': 'Africa',
    'tanzania': 'Africa',
    'cameroon': 'Africa',
    'senegal': 'Africa',
    'ivory coast': 'Africa',
    "cote d'ivoire": 'Africa',
    'zimbabwe': 'Africa',
    'zambia': 'Africa',
    'botswana': 'Africa',
    'namibia': 'Africa',
    'mozambique': 'Africa',
    'angola': 'Africa',
    'rwanda': 'Africa',
    'somalia': 'Africa',
    'georgia': 'Asia',
    'armenia': 'Asia',
    'azerbaijan': 'Asia',
    'australia': 'Oceania',
    'new zealand': 'Oceania',
    'fiji': 'Oceania',
    'papua new guinea': 'Oceania',
    'samoa': 'Oceania',
    'tonga': 'Oceania',
    'vanuatu': 'Oceania'
  };

  const RING_SLOTS = RING_SLOT_GROUPS.reduce((list, group) => {
    group.slots.forEach((key) => {
      list.push({ key, label: SLOT_LABELS[key] || key, group: group.id });
    });
    return list;
  }, []);

  const state = {
    events: [],
    eventId: '',
    umpires: [],
    umpiresById: {},
    ringCount: 0,
    assignments: {},
    selectedIds: [],
    openRing: 0,
    gridLayout: '1x',
    overlaySchedule: false,
    scheduleOverlay: null,
    eventDateStart: null,
    filters: {
      rank: '',
      team: '',
      region: '',
      preferredRole: '',
      class: ''
    }
  };

  let dragPayload = null;
  let dragGhostEl = null;
  let saveDirty = false;
  let saveChain = Promise.resolve();
  let saveSeq = 0;
  let selectionAnchor = null;
  let overlayTimer = null;

  function isMobileView() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function syncMobileLayoutClass() {
    document.documentElement.classList.toggle('umpire-mgmt-mobile', isMobileView());
  }

  function ringAssignedEntries(ring) {
    const row = state.assignments[String(ring)];
    const entries = [];
    RING_SLOTS.forEach((slot) => {
      const key = seatArray(row, slot.key)[0] || '';
      if (!key) return;
      const umpire = state.umpiresById[key];
      if (!umpire) return;
      entries.push({
        name: umpireDisplayName(umpire),
        abbrev: SLOT_ABBREV[slot.key] || ''
      });
    });
    return entries;
  }

  function ringCouncilEntries(ring) {
    const row = state.assignments[String(ring)];
    const entries = [];
    RING_SLOTS.forEach((slot) => {
      const seats = seatArray(row, slot.key);
      const abbrev = SLOT_ABBREV[slot.key] || '';
      for (let i = 0; i < SLOT_CAPACITY; i += 1) {
        const id = seats[i];
        if (!id) continue;
        const umpire = state.umpiresById[String(id)];
        if (!umpire) continue;
        entries.push({
          id: String(id),
          name: umpireDisplayName(umpire),
          abbrev,
          primary: i === 0
        });
      }
    });
    return entries;
  }

  function renderRingCard(ring, mobile) {
    const hideNames = Boolean(mobile);
    const entries = hideNames ? [] : ringAssignedEntries(ring);
    const names = entries.map((entry) => entry.name);
    const nameList = entries.length
      ? entries.map((entry) => (
        '<span class="umpire-ring-name">' +
          (entry.abbrev ? '<span class="umpire-ring-name-role">' + escapeHtml(entry.abbrev) + ':</span>' : '') +
          '<span class="umpire-ring-name-text">' + escapeHtml(entry.name) + '</span>' +
        '</span>'
      )).join('')
      : '<span class="umpire-ring-name is-empty">No umpires assigned</span>';
    const overlayHtml = state.overlaySchedule
      ? renderScheduleOverlay(ring)
      : hideNames
        ? ''
        : (
        '<div class="umpire-ring-overlay">' +
          '<div class="umpire-ring-names' + (names.length ? '' : ' is-empty') + '">' + nameList + '</div>' +
        '</div>'
      );
    return (
      '<div class="umpire-ring" data-ring="' + ring + '" role="button" tabindex="0">' +
        '<div class="umpire-ring-title">Ring ' + ring + '</div>' +
        '<div class="umpire-ring-body">' +
          '<div class="umpire-ring-card" data-ring="' + ring + '">' +
            '<div class="umpire-ring-square"></div>' +
            overlayHtml +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function assignSelectedToSlot(ring, slotKey, seatIndex) {
    const ids = uniqueIds(state.selectedIds);
    if (!ids.length) return false;
    if (ids.length === 1) return placeUmpire(ids[0], ring, slotKey, seatIndex);
    const group = RING_SLOT_GROUPS.find((item) => item.slots.indexOf(slotKey) !== -1);
    const slots = group ? group.slots.slice(group.slots.indexOf(slotKey)) : [slotKey];
    return assignToSlotsTopDown(ids, ring, slots);
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(message, isError) {
    const el = document.getElementById('umpireMgmtStatus');
    if (!el) return;
    const text = String(message || '').trim();
    el.textContent = text;
    el.classList.toggle('is-error', Boolean(isError));
    el.hidden = !text;
  }

  const RING_GRID_LAYOUT_KEY = 'umpireRingGridLayout';
  const PORTAL_LAST_EVENT_KEY = 'portal-last-event-id';
  const PORTAL_FOCUS_DAY_KEY = 'portal-focus-day-index';

  function readLastEventId() {
    try {
      return String(sessionStorage.getItem(PORTAL_LAST_EVENT_KEY) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function rememberLastEventId(eventId) {
    const id = String(eventId || '').trim();
    if (!id) return;
    try {
      sessionStorage.setItem(PORTAL_LAST_EVENT_KEY, id);
    } catch (_) { /* ignore */ }
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
    let raw = null;
    try {
      raw = localStorage.getItem(PORTAL_FOCUS_DAY_KEY);
    } catch (_) {
      raw = null;
    }
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    const index = Math.floor(n);
    if (dayCount > 0) return Math.max(0, Math.min(dayCount - 1, index));
    return index;
  }
  const RING_GRID_LAYOUTS = {
    '1x': { rows: 1, cols: 0 },
    '2x2': { rows: 2, cols: 2 },
    '2x3': { rows: 2, cols: 3 },
    '2x4': { rows: 2, cols: 4 },
    '3x3': { rows: 3, cols: 3 },
    '3x4': { rows: 3, cols: 4 }
  };

  function readStoredGridLayout() {
    try {
      const value = window.localStorage.getItem(RING_GRID_LAYOUT_KEY);
      if (value && RING_GRID_LAYOUTS[value]) return value;
    } catch (_) {
      /* ignore */
    }
    return '1x';
  }

  function ringGridDims(count) {
    const n = Math.max(0, Number(count) || 0);
    const layout = RING_GRID_LAYOUTS[state.gridLayout] || RING_GRID_LAYOUTS['1x'];
    if (n <= 0) return { cols: 1, rows: 1 };
    if (!layout.cols) {
      return { cols: Math.max(1, n), rows: 1 };
    }
    const cols = layout.cols;
    const rows = Math.max(layout.rows, Math.ceil(n / cols));
    return { cols, rows };
  }

  function applyGridLayout(value, options) {
    const next = RING_GRID_LAYOUTS[value] ? value : '1x';
    state.gridLayout = next;
    const select = document.getElementById('umpireGridLayoutSelect');
    if (select && select.value !== next) select.value = next;
    if (!(options && options.skipStore)) {
      try {
        window.localStorage.setItem(RING_GRID_LAYOUT_KEY, next);
      } catch (_) {
        /* ignore */
      }
    }
    if (state.ringCount > 0) renderRings();
  }

  function parseOverlayHhmm(text) {
    const match = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours > 23 || mins > 59) return null;
    return hours * 60 + mins;
  }

  function overlayTimeZone() {
    const fromSched = state.scheduleOverlay && state.scheduleOverlay.timezone;
    try {
      const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return fromSched || browser || 'America/Halifax';
    } catch (_) {
      return fromSched || 'America/Halifax';
    }
  }

  function overlayNowClockMinutes() {
    const timeZone = overlayTimeZone();
    try {
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
    } catch (_) {
      const now = new Date();
      return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    }
  }

  function overlayYmd(date, timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      const map = {};
      parts.forEach((part) => {
        if (part.type !== 'literal') map[part.type] = part.value;
      });
      return map.year + '-' + map.month + '-' + map.day;
    } catch (_) {
      return '';
    }
  }

  function overlayCalendarDiff() {
    const startRaw = state.eventDateStart;
    if (!startRaw) return 0;
    const startDate = new Date(startRaw);
    if (Number.isNaN(startDate.getTime())) return 0;
    const tz = overlayTimeZone();
    const startYmd = overlayYmd(startDate, tz);
    const todayYmd = overlayYmd(new Date(), tz);
    if (!startYmd || !todayYmd) return 0;
    const toDays = (ymd) => {
      const bits = ymd.split('-').map(Number);
      return Date.UTC(bits[0], bits[1] - 1, bits[2]) / 86400000;
    };
    return Math.floor(toDays(todayYmd) - toDays(startYmd));
  }

  function overlayNowOffset(day) {
    const startAbs = parseOverlayHhmm(day && day.start_time);
    const start = startAbs == null ? 8 * 60 : startAbs;
    const endAbsRaw = parseOverlayHhmm(day && day.end_time);
    let endAbs = endAbsRaw == null ? 18 * 60 : endAbsRaw;
    let nowAbs = overlayNowClockMinutes();
    const windowMins = Math.max(5, (endAbs <= start ? endAbs + 24 * 60 : endAbs) - start);
    if (endAbs <= start && nowAbs < start) nowAbs += 24 * 60;
    return Math.max(0, Math.min(windowMins, nowAbs - start));
  }

  function overlayDayContext() {
    const overlay = state.scheduleOverlay;
    if (!overlay) return null;
    const days = Array.isArray(overlay.days) && overlay.days.length
      ? overlay.days
      : [{ name: 'Day 1', start_time: '08:00', end_time: '18:00' }];
    const dayCount = days.length;
    const override = readFocusDayIndex(dayCount);
    if (override != null) {
      return {
        dayIndex: override,
        nowOff: overlayNowOffset(days[override] || days[0])
      };
    }
    const hasEventDate = Boolean(state.eventDateStart);
    const diff = hasEventDate ? overlayCalendarDiff() : 0;
    let dayIndex;
    let nowOff;
    if (hasEventDate && diff < 0) {
      dayIndex = 0;
      nowOff = -1;
    } else if (hasEventDate && diff >= dayCount) {
      dayIndex = dayCount - 1;
      nowOff = Number.POSITIVE_INFINITY;
    } else {
      dayIndex = hasEventDate
        ? diff
        : Math.max(0, Math.min(dayCount - 1, Number(overlay.activeDayIndex) || 0));
      nowOff = overlayNowOffset(days[dayIndex] || days[0]);
    }
    return { dayIndex, nowOff };
  }

  function ringScheduleOverlay(ring) {
    const overlay = state.scheduleOverlay;
    if (!overlay) return { current: '—', upcoming: [] };
    const ctx = overlayDayContext();
    if (!ctx) return { current: '—', upcoming: [] };
    const items = (overlay.rings && overlay.rings[String(ring)] || [])
      .filter((item) => Number(item.dayIndex) === ctx.dayIndex);
    const inPlay = items.find((item) => item.start <= ctx.nowOff && ctx.nowOff < item.end) || null;
    if (inPlay) {
      return {
        current: inPlay.name,
        upcoming: items.filter((item) => item.start >= inPlay.end).slice(0, 2).map((item) => item.name)
      };
    }
    const future = items.filter((item) => item.start >= ctx.nowOff);
    if (future.length) {
      return {
        current: future[0].name,
        upcoming: future.slice(1, 3).map((item) => item.name)
      };
    }
    return { current: '—', upcoming: [] };
  }

  function renderScheduleBlock(kind, label, name) {
    const text = String(name || '').trim() || '—';
    const empty = text === '—';
    return (
      '<div class="umpire-ring-sched-' + kind + (empty ? ' is-empty' : '') + '">' +
        '<span class="umpire-ring-sched-label">' + escapeHtml(label) + '</span>' +
        '<span class="umpire-ring-sched-text">' + escapeHtml(text) + '</span>' +
      '</div>'
    );
  }

  function renderScheduleOverlay(ring) {
    const info = ringScheduleOverlay(ring);
    return (
      '<div class="umpire-ring-overlay is-schedule">' +
        renderScheduleBlock('current', 'Now', info.current) +
        renderScheduleBlock('next', 'Next', info.upcoming[0]) +
        renderScheduleBlock('next', 'Then', info.upcoming[1]) +
      '</div>'
    );
  }

  function syncOverlayTimer() {
    if (overlayTimer) {
      clearInterval(overlayTimer);
      overlayTimer = null;
    }
    if (state.overlaySchedule && state.ringCount > 0 && !state.openRing) {
      overlayTimer = setInterval(function () {
        if (state.overlaySchedule && state.ringCount > 0 && !state.openRing) renderRings();
      }, 30000);
    }
  }

  function setOverlaySchedule(on) {
    state.overlaySchedule = Boolean(on);
    const btn = document.getElementById('umpireOverlayScheduleBtn');
    if (btn) {
      btn.classList.toggle('is-active', state.overlaySchedule);
      btn.setAttribute('aria-pressed', state.overlaySchedule ? 'true' : 'false');
    }
    if (state.ringCount > 0) renderRings();
    else syncOverlayTimer();
  }

  function formatEventLabel(event) {
    const name = event.event_name || ('event ' + event.id);
    const raw = event.event_date_start;
    if (!raw) return name;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return name;
    const date = d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    return name + ' (' + date + ')';
  }

  function umpireId(umpire) {
    return String(umpire && umpire.id != null ? umpire.id : '');
  }

  function umpireDisplayName(umpire) {
    if (!umpire) return '';
    const first = String(umpire.first_name || '').trim();
    const last = String(umpire.last_name || '').trim();
    const name = [first, last].filter(Boolean).join(' ');
    return name || umpire.contact_email || 'Unnamed umpire';
  }

  function umpireMeta(umpire) {
    const parts = [];
    if (umpire.rank) parts.push(String(umpire.rank));
    if (umpire.team_name_or_country) parts.push(String(umpire.team_name_or_country));
    return parts.join(' · ');
  }

  function dash(value) {
    const text = String(value ?? '').trim();
    return text || '—';
  }

  function formatDob(value) {
    if (!value) return '—';
    const raw = String(value).trim();
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function ageFromDob(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const monthDiff = now.getMonth() - d.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) age -= 1;
    return age >= 0 && age < 130 ? age : null;
  }

  function preferredRoleLabel(value) {
    const key = String(value || '').trim().toLowerCase();
    return UMPIRE_PREFERRED_ROLE_LABELS[key] || dash(value);
  }

  function rankFilterBucket(rank) {
    const text = String(rank || '').trim().toLowerCase();
    if (!text) return '';
    if (text.indexOf('gup') !== -1) return 'color_belt';
    const match = text.match(/(\d+)(?:st|nd|rd|th)?\s*dan/);
    if (!match) return '';
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n < 1) return '';
    if (n >= 7) return '7th_dan_plus';
    return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th') + '_dan';
  }

  function regionForTeam(team) {
    const key = String(team || '').trim().toLowerCase();
    if (!key) return 'Other';
    return COUNTRY_TO_REGION[key] || 'Other';
  }

  function umpirePassesFilters(umpire) {
    const filters = state.filters || {};
    if (filters.rank && rankFilterBucket(umpire.rank) !== filters.rank) return false;
    if (filters.team && String(umpire.team_name_or_country || '').trim() !== filters.team) return false;
    if (filters.region && regionForTeam(umpire.team_name_or_country) !== filters.region) return false;
    if (filters.preferredRole
      && String(umpire.umpire_preferred_role || '').trim().toLowerCase() !== filters.preferredRole) {
      return false;
    }
    if (filters.class && String(umpire.umpire_class || '').trim() !== filters.class) return false;
    return true;
  }

  function detailsPop() {
    return document.getElementById('umpireDetailsPop');
  }

  function hideUmpireDetails() {
    const pop = detailsPop();
    if (pop) pop.hidden = true;
  }

  function showUmpireDetails(id, clientX, clientY) {
    const umpire = state.umpiresById[String(id || '')];
    const pop = detailsPop();
    const nameEl = document.getElementById('umpireDetailsName');
    const listEl = document.getElementById('umpireDetailsList');
    if (!pop || !nameEl || !listEl) return;
    if (!umpire) {
      hideUmpireDetails();
      return;
    }
    const age = ageFromDob(umpire.dob);
    const dobText = formatDob(umpire.dob);
    const dobAge = age != null ? dobText + ' / ' + age : dobText;
    const rows = [
      ['date of birth / age', dobAge],
      ['gender', dash(umpire.gender)],
      ['rank', dash(umpire.rank)],
      ['team', dash(umpire.team_name_or_country)],
      ['preferred role', preferredRoleLabel(umpire.umpire_preferred_role)],
      ['class', dash(umpire.umpire_class)],
      ['email', dash(umpire.contact_email)]
    ];
    nameEl.textContent = umpireDisplayName(umpire);
    listEl.innerHTML = rows.map(([label, value]) => (
      '<dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd>'
    )).join('');
    pop.hidden = false;
    pop.style.left = '0px';
    pop.style.top = '0px';
    const pad = 8;
    const rect = pop.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function resetFilters() {
    state.filters = { rank: '', team: '', region: '', preferredRole: '', class: '' };
    const rankSelect = document.getElementById('umpireFilterRank');
    const teamSelect = document.getElementById('umpireFilterTeam');
    const regionSelect = document.getElementById('umpireFilterRegion');
    const preferredRoleSelect = document.getElementById('umpireFilterPreferredRole');
    const classSelect = document.getElementById('umpireFilterClass');
    if (rankSelect) rankSelect.value = '';
    if (teamSelect) teamSelect.value = '';
    if (regionSelect) regionSelect.value = '';
    if (preferredRoleSelect) preferredRoleSelect.value = '';
    if (classSelect) classSelect.value = '';
  }

  function rebuildTeamFilterOptions() {
    const select = document.getElementById('umpireFilterTeam');
    if (!select) return;
    const keep = String(state.filters.team || '');
    const teams = Array.from(new Set(
      state.umpires
        .map((umpire) => String(umpire.team_name_or_country || '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="">team</option>' + teams.map((team) => (
      '<option value="' + escapeHtml(team) + '">' + escapeHtml(team) + '</option>'
    )).join('');
    if (keep && teams.indexOf(keep) !== -1) {
      select.value = keep;
      state.filters.team = keep;
    } else {
      select.value = '';
      state.filters.team = '';
    }
  }

  function slotLabel(slotKey) {
    const slot = RING_SLOTS.find((item) => item.key === slotKey);
    return slot ? slot.label : slotKey;
  }

  function emptyRingAssignments() {
    const row = {};
    RING_SLOTS.forEach((slot) => {
      row[slot.key] = [null, null, null];
    });
    return row;
  }

  function emptyAssignments(ringCount) {
    const next = {};
    const n = Math.max(0, Number(ringCount) || 0);
    for (let ring = 1; ring <= n; ring += 1) {
      next[String(ring)] = emptyRingAssignments();
    }
    return next;
  }

  function parseSlotIds(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value;
    return [value];
  }

  function seatArray(row, key) {
    const seats = ['', '', ''];
    if (!row) return seats;
    parseSlotIds(row[key]).forEach((item, index) => {
      if (index >= SLOT_CAPACITY) return;
      const id = item == null || item === '' ? '' : String(item);
      if (id && state.umpiresById[id]) seats[index] = id;
    });
    return seats;
  }

  function setSeatArray(row, key, seats) {
    if (!row) return;
    const out = [];
    for (let i = 0; i < SLOT_CAPACITY; i += 1) {
      const id = String((seats[i] == null ? '' : seats[i]) || '');
      out.push(id && state.umpiresById[id] ? id : null);
    }
    row[key] = out;
  }

  function slotIds(row, key) {
    return seatArray(row, key).filter(Boolean);
  }

  function normalizeAssignments(raw, ringCount) {
    const next = emptyAssignments(ringCount);
    const used = new Set();
    const src = raw && typeof raw === 'object' ? raw : {};
    for (let ring = 1; ring <= ringCount; ring += 1) {
      const key = String(ring);
      const row = src[key] && typeof src[key] === 'object' ? src[key] : {};
      RING_SLOTS.forEach((slot) => {
        const seats = [null, null, null];
        parseSlotIds(row[slot.key]).forEach((item, index) => {
          if (index >= SLOT_CAPACITY) return;
          const id = item == null || item === '' ? '' : String(item);
          if (!id || !state.umpiresById[id] || used.has(id)) return;
          seats[index] = id;
          used.add(id);
        });
        next[key][slot.key] = seats;
      });
    }
    return next;
  }

  function slotIsEmpty(row, key) {
    return seatArray(row, key).every((seatId) => !seatId);
  }

  function slotHasRoom(row, key) {
    return seatArray(row, key).some((seatId) => !seatId);
  }

  function clearUmpireFromAllSlots(id) {
    const key = String(id || '');
    if (!key) return;
    for (let ring = 1; ring <= state.ringCount; ring += 1) {
      const row = state.assignments[String(ring)];
      if (!row) continue;
      RING_SLOTS.forEach((slot) => {
        const seats = seatArray(row, slot.key);
        let changed = false;
        for (let i = 0; i < SLOT_CAPACITY; i += 1) {
          if (seats[i] !== key) continue;
          seats[i] = '';
          changed = true;
        }
        if (changed) setSeatArray(row, slot.key, seats);
      });
    }
  }

  function enforceUniqueAssignments() {
    const used = new Set();
    for (let ring = 1; ring <= state.ringCount; ring += 1) {
      const row = state.assignments[String(ring)];
      if (!row) continue;
      RING_SLOTS.forEach((slot) => {
        const seats = seatArray(row, slot.key);
        for (let i = 0; i < SLOT_CAPACITY; i += 1) {
          const id = seats[i];
          if (!id || used.has(id) || !state.umpiresById[id]) {
            seats[i] = '';
            continue;
          }
          used.add(id);
        }
        setSeatArray(row, slot.key, seats);
      });
    }
  }

  function findAssignment(id) {
    const umpireKey = String(id || '');
    if (!umpireKey) return null;
    for (let ring = 1; ring <= state.ringCount; ring += 1) {
      const row = state.assignments[String(ring)];
      if (!row) continue;
      for (let i = 0; i < RING_SLOTS.length; i += 1) {
        const slotKey = RING_SLOTS[i].key;
        const seats = seatArray(row, slotKey);
        for (let index = 0; index < SLOT_CAPACITY; index += 1) {
          if (seats[index] === umpireKey) {
            return { ring, slot: slotKey, index };
          }
        }
      }
    }
    return null;
  }

  function indexUmpires() {
    state.umpiresById = {};
    state.umpires.forEach((umpire) => {
      const id = umpireId(umpire);
      if (id) state.umpiresById[id] = umpire;
    });
  }

  function uniqueIds(ids) {
    const seen = new Set();
    const out = [];
    (ids || []).forEach((id) => {
      const key = String(id || '');
      if (!key || seen.has(key) || !state.umpiresById[key]) return;
      seen.add(key);
      out.push(key);
    });
    return out;
  }

  function isSelected(id) {
    return state.selectedIds.indexOf(String(id || '')) !== -1;
  }

  function pruneSelection() {
    state.selectedIds = uniqueIds(state.selectedIds);
  }

  function visiblePoolIds() {
    return Array.from(document.querySelectorAll('#umpireList [data-umpire-id]'))
      .map((el) => el.getAttribute('data-umpire-id'))
      .filter(Boolean);
  }

  function ringAssignedIds(ring) {
    const row = state.assignments[String(ring)];
    if (!row) return [];
    const ids = [];
    RING_SLOTS.forEach((slot) => {
      slotIds(row, slot.key).forEach((id) => {
        ids.push(id);
      });
    });
    return ids;
  }

  function setSelection(ids, anchorId, anchorScope) {
    state.selectedIds = uniqueIds(ids);
    if (anchorId) {
      selectionAnchor = { id: String(anchorId), scope: anchorScope || null };
    } else if (!state.selectedIds.length) {
      selectionAnchor = null;
    }
  }

  function addToSelection(ids) {
    state.selectedIds = uniqueIds(state.selectedIds.concat(ids));
  }

  function toggleInSelection(id) {
    const key = String(id || '');
    if (!key) return;
    const idx = state.selectedIds.indexOf(key);
    if (idx === -1) state.selectedIds.push(key);
    else state.selectedIds.splice(idx, 1);
    selectionAnchor = { id: key, scope: selectionAnchor && selectionAnchor.scope };
  }

  function rangeIds(scope, fromId, toId) {
    const list = scope === 'pool' ? visiblePoolIds() : ringAssignedIds(scope);
    const a = list.indexOf(String(fromId));
    const b = list.indexOf(String(toId));
    if (a === -1 || b === -1) return [String(toId)];
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    return list.slice(start, end + 1);
  }

  function applySelectionFromClick(id, scope, evt) {
    const key = String(id || '');
    if (!key) return;
    if (evt.shiftKey && selectionAnchor && selectionAnchor.scope === scope) {
      setSelection(rangeIds(scope, selectionAnchor.id, key), selectionAnchor.id, scope);
      return;
    }
    if (evt.ctrlKey || evt.metaKey) {
      toggleInSelection(key);
      selectionAnchor = { id: key, scope };
      return;
    }
    setSelection([key], key, scope);
  }

  function selectRing(ring, additive) {
    const ids = ringAssignedIds(ring);
    if (additive) addToSelection(ids);
    else setSelection(ids, ids[0] || null, ring);
  }

  function markSelectedInDom() {
    document.querySelectorAll('[data-umpire-id]').forEach((el) => {
      el.classList.toggle('is-selected', isSelected(el.getAttribute('data-umpire-id')));
    });
    document.querySelectorAll('.umpire-slot-seat').forEach((el) => {
      el.classList.toggle('is-selected', isSelected(el.getAttribute('data-umpire-id')));
    });
  }

  function renderUmpires() {
    const heading = document.getElementById('umpireCountHeading');
    const list = document.getElementById('umpireList');
    const empty = document.getElementById('umpireListEmpty');
    const count = state.umpires.length;
    const unassigned = state.umpires.filter((umpire) => !findAssignment(umpireId(umpire)));
    const visible = unassigned.filter(umpirePassesFilters);
    if (heading) {
      heading.textContent = count === 1 ? '1 registered umpire' : (count + ' registered umpires');
    }
    if (!list || !empty) return;
    if (!visible.length) {
      list.innerHTML = '';
      empty.hidden = false;
      if (!count) {
        empty.textContent = 'No umpires are registered for this event.';
      } else if (!unassigned.length) {
        empty.textContent = 'All umpires are assigned to rings.';
      } else {
        empty.textContent = 'No unassigned umpires match the current filters.';
      }
      return;
    }
    empty.hidden = true;
    list.innerHTML = visible.map((umpire) => {
      const id = umpireId(umpire);
      const meta = umpireMeta(umpire);
      return (
        '<li class="umpire-mgmt-item' + (isSelected(id) ? ' is-selected' : '') + '" draggable="true" data-umpire-id="' + escapeHtml(id) + '">' +
          '<strong>' + escapeHtml(umpireDisplayName(umpire)) + '</strong>' +
          (meta ? '<span>' + escapeHtml(meta) + '</span>' : '') +
        '</li>'
      );
    }).join('');
  }

  function renderSeat(ring, slot, id, index) {
    const umpire = id ? state.umpiresById[String(id)] : null;
    const filled = Boolean(umpire);
    const selected = filled && isSelected(umpireId(umpire));
    const name = filled ? umpireDisplayName(umpire) : '';
    const rank = filled ? String(umpire.rank || '').trim() : '';
    const team = filled ? String(umpire.team_name_or_country || '').trim() : '';
    const placeholder = '—';
    const title = filled
      ? [name, rank, team].filter(Boolean).join(' · ')
      : slot.label;
    return (
      '<div class="umpire-slot-seat' +
        (filled ? ' is-filled' : ' is-empty') +
        (index === 0 ? ' is-primary' : ' is-secondary') +
        (selected ? ' is-selected' : '') + '"' +
        (filled ? ' draggable="true" data-umpire-id="' + escapeHtml(umpireId(umpire)) + '"' : '') +
        ' data-ring="' + ring + '" data-slot="' + escapeHtml(slot.key) + '" data-seat="' + index + '"' +
        ' title="' + escapeHtml(title) + '">' +
        (filled
          ? (
            '<div class="umpire-slot-seat-body">' +
              '<span class="umpire-slot-line umpire-slot-person' + (selected ? ' is-selected' : '') + '">' +
                escapeHtml(name) +
              '</span>' +
              (rank ? '<span class="umpire-slot-line umpire-slot-meta">' + escapeHtml(rank) + '</span>' : '') +
              (team ? '<span class="umpire-slot-line umpire-slot-meta">' + escapeHtml(team) + '</span>' : '') +
            '</div>' +
            '<button type="button" class="umpire-slot-clear" data-clear="1" aria-label="Remove ' + escapeHtml(name) + ' from ' + escapeHtml(slot.label) + '">×</button>'
          )
          : '<span class="umpire-slot-placeholder">' + placeholder + '</span>') +
      '</div>'
    );
  }

  function seatLayoutHtml(colId, seats) {
    if (colId === 'equipment') {
      return seats[0] + '<div class="umpire-slot-seat-row">' + seats[1] + seats[2] + '</div>';
    }
    if (colId === 'officials' || colId === 'umpires') {
      return seats[0] + '<div class="umpire-slot-seat-stack">' + seats[1] + seats[2] + '</div>';
    }
    return seats.join('');
  }

  function seatLayoutClass(colId) {
    if (colId === 'equipment') return ' is-stack-over-row';
    if (colId === 'officials' || colId === 'umpires') return ' is-split-stack';
    return '';
  }

  function renderSlot(ring, slot, colId) {
    const seats = seatArray(state.assignments[String(ring)], slot.key);
    const abbrev = SLOT_ABBREV[slot.key] || '';
    const seatHtml = [];
    for (let i = 0; i < SLOT_CAPACITY; i += 1) {
      seatHtml.push(renderSeat(ring, slot, seats[i] || '', i));
    }
    const layoutClass = seatLayoutClass(colId);
    const filled = seats.some(Boolean);
    return (
      '<div class="umpire-slot' + (filled ? ' is-filled' : ' is-empty') + '"' +
        ' data-ring="' + ring + '" data-slot="' + escapeHtml(slot.key) + '">' +
        '<div class="umpire-slot-row">' +
          '<span class="umpire-slot-role">' + escapeHtml(abbrev) + '</span>' +
          '<div class="umpire-slot-seats' + layoutClass + '">' + seatLayoutHtml(colId, seatHtml) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderRings() {
    const grid = document.getElementById('umpireRingGrid');
    const empty = document.getElementById('umpireRingsEmpty');
    if (!grid || !empty) return;
    syncMobileLayoutClass();
    const mobile = isMobileView();
    const n = Math.max(0, Number(state.ringCount) || 0);
    if (n < 1) {
      grid.innerHTML = '';
      grid.hidden = true;
      grid.classList.remove('is-mobile-list');
      empty.hidden = false;
      state.openRing = 0;
      const modal = document.getElementById('umpireRingModal');
      if (modal) modal.hidden = true;
      syncOverlayTimer();
      return;
    }
    grid.classList.toggle('is-mobile-list', mobile);
    grid.classList.toggle('is-schedule-overlay', Boolean(state.overlaySchedule && !mobile));
    grid.hidden = Boolean(state.openRing);
    empty.hidden = true;
    if (!mobile) {
      const dims = ringGridDims(n);
      grid.style.setProperty('--ring-cols', String(dims.cols));
      grid.style.setProperty('--ring-rows', String(dims.rows));
    } else {
      grid.style.removeProperty('--ring-cols');
      grid.style.removeProperty('--ring-rows');
    }
    grid.innerHTML = Array.from({ length: n }, (_, i) => renderRingCard(i + 1, mobile)).join('');
    renderRingModal();
    syncOverlayTimer();
    if (state.overlaySchedule) scheduleFitScheduleOverlay();
    else if (!mobile) scheduleFitRingNames();
  }

  function elementOverflows(el) {
    if (!el) return false;
    return el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5;
  }

  const textMeasureCtx = document.createElement('canvas').getContext('2d');

  function measureTextWidth(text, weight, px, family) {
    textMeasureCtx.font = weight + ' ' + px + 'px ' + family;
    return textMeasureCtx.measureText(text || '').width;
  }

  function applySeatNameSize(seat, namePx, wrapName) {
    const body = seat.querySelector('.umpire-slot-seat-body');
    if (!body) return;
    const nameLine = body.querySelector('.umpire-slot-person');
    const metaLines = Array.from(body.querySelectorAll('.umpire-slot-meta'));
    if (!nameLine) return;
    const metaPx = namePx / 2;
    nameLine.style.fontSize = namePx + 'px';
    nameLine.style.lineHeight = '1';
    nameLine.classList.toggle('is-wrap', Boolean(wrapName));
    metaLines.forEach((line) => {
      line.style.fontSize = metaPx + 'px';
      line.style.lineHeight = '1';
    });
  }

  function seatBodyOverflows(body) {
    if (body.scrollHeight > body.clientHeight + 0.5) return true;
    if (body.scrollWidth > body.clientWidth + 0.5) return true;
    const lines = body.querySelectorAll('.umpire-slot-line');
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].scrollWidth > lines[i].clientWidth + 0.5) return true;
    }
    return false;
  }

  function fitSeatFonts(seat) {
    const body = seat.querySelector('.umpire-slot-seat-body');
    if (!body) return 0;
    const nameLine = body.querySelector('.umpire-slot-person');
    const metaLines = Array.from(body.querySelectorAll('.umpire-slot-meta'));
    if (!nameLine) return 0;

    const availW = body.clientWidth;
    const availH = body.clientHeight;
    if (availW < 4 || availH < 4) return 0;

    const family = getComputedStyle(nameLine).fontFamily || 'sans-serif';
    const nameWeight = getComputedStyle(nameLine).fontWeight || '700';
    const metaWeight = metaLines[0]
      ? (getComputedStyle(metaLines[0]).fontWeight || '400')
      : '400';
    const sample = 100;
    const nameW = measureTextWidth(nameLine.textContent, nameWeight, sample, family);
    let metaW = 0;
    metaLines.forEach((line) => {
      metaW = Math.max(metaW, measureTextWidth(line.textContent, metaWeight, sample, family));
    });

    const lineGap = 1;
    const metaCount = metaLines.length;
    const gaps = lineGap * Math.max(0, metaCount);
    const desktop = !isMobileView();
    const boxW = Math.max(1, availW);
    const minPx = 6;
    const maxPx = desktop ? 64 : 52;

    const maxByMetaWidth = metaW > 0 ? (boxW * sample / metaW) * 2 : maxPx;
    const maxByNameWidth = nameW > 0 ? (boxW * sample / nameW) : maxPx;
    const maxByOneLineHeight = (availH - gaps) / (1 + metaCount / 2);
    const oneLine = Math.min(maxPx, maxByOneLineHeight, maxByNameWidth, maxByMetaWidth);

    const isSecondary = seat.classList.contains('is-secondary');
    let best = oneLine;
    let wrapName = false;
    if (isSecondary) {
      const maxByTwoLineHeight = (availH - gaps) / (2 + metaCount / 2);
      const maxByNameWrapWidth = nameW > 0 ? (boxW * 2 * sample / nameW) : maxPx;
      const twoLine = Math.min(maxPx, maxByTwoLineHeight, maxByNameWrapWidth, maxByMetaWidth);
      const wrapGain = desktop ? 1.25 : 1.08;
      if (twoLine > oneLine * wrapGain) {
        best = twoLine;
        wrapName = true;
      }
    }

    best = Math.max(minPx, best);
    applySeatNameSize(seat, best, wrapName);

    let lo = minPx;
    let hi = Math.min(maxPx, Math.max(best, maxByOneLineHeight) * (desktop ? 1.2 : 1.08));
    if (seatBodyOverflows(body)) {
      hi = best;
    } else {
      lo = best;
    }
    for (let i = 0; i < 18; i += 1) {
      const mid = (lo + hi) / 2;
      applySeatNameSize(seat, mid, wrapName);
      if (seatBodyOverflows(body)) {
        hi = mid;
      } else {
        best = mid;
        lo = mid;
      }
    }
    applySeatNameSize(seat, best, wrapName);
    return best;
  }

  function fitSlotGroup(slotEl) {
    const filled = Array.from(slotEl.querySelectorAll('.umpire-slot-seat.is-filled'));
    if (!filled.length) return false;
    let pending = false;
    filled.forEach((seat) => {
      if (!fitSeatFonts(seat)) pending = true;
    });
    return pending;
  }

  function fitEmptySeatFont(seat) {
    const placeholder = seat.querySelector('.umpire-slot-placeholder');
    if (!placeholder) return true;
    const rect = seat.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const isPrimary = seat.classList.contains('is-primary');
    let lo = 6;
    let hi = Math.max(
      rect.height * (isPrimary ? 0.85 : 0.7),
      rect.width * (isPrimary ? 0.4 : 0.32),
      isPrimary ? 24 : 16
    );
    let best = lo;
    for (let i = 0; i < 16; i += 1) {
      const mid = (lo + hi) / 2;
      placeholder.style.fontSize = mid + 'px';
      if (elementOverflows(placeholder) || elementOverflows(seat)) {
        hi = mid;
      } else {
        best = mid;
        lo = mid;
      }
    }
    placeholder.style.fontSize = best + 'px';
    return true;
  }

  function fitSlotNameFonts() {
    const modal = document.getElementById('umpireRingModal');
    const cols = document.getElementById('umpireRingModalCols');
    if (!modal || modal.hidden || !cols || cols.classList.contains('is-mobile-roster')) return;
    let pending = false;
    cols.querySelectorAll('.umpire-slot').forEach((slotEl) => {
      if (fitSlotGroup(slotEl)) pending = true;
    });
    cols.querySelectorAll('.umpire-slot-seat.is-empty').forEach((seat) => {
      if (!fitEmptySeatFont(seat)) pending = true;
    });
    if (pending) {
      requestAnimationFrame(fitSlotNameFonts);
    }
  }

  function scheduleFitSlotNames() {
    requestAnimationFrame(function () {
      requestAnimationFrame(fitSlotNameFonts);
    });
  }

  const SCHEDULE_TEXT_MAX_LINES = 2;

  function scheduleTextLineHeight(text) {
    const style = window.getComputedStyle(text);
    let lineHeight = parseFloat(style.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      const fontSize = parseFloat(style.fontSize) || 12;
      lineHeight = fontSize * 1.1;
    }
    return lineHeight;
  }

  function scheduleTextExceedsLines(text, maxLines) {
    return text.scrollHeight > scheduleTextLineHeight(text) * maxLines + 0.5;
  }

  function scheduleBlockOverflows(block, text) {
    return scheduleTextExceedsLines(text, SCHEDULE_TEXT_MAX_LINES)
      || block.scrollHeight > block.clientHeight + 0.5
      || block.scrollWidth > block.clientWidth + 0.5
      || text.scrollWidth > text.clientWidth + 0.5;
  }

  function fitScheduleOverlayFonts() {
    const grid = document.getElementById('umpireRingGrid');
    if (!grid || grid.hidden || !state.overlaySchedule) return;
    grid.querySelectorAll('.umpire-ring-sched-current, .umpire-ring-sched-next').forEach((block) => {
      const text = block.querySelector('.umpire-ring-sched-text');
      if (!text) return;
      const availW = text.clientWidth;
      const availH = text.clientHeight;
      if (availW < 4 || availH < 4) return;
      const isCurrent = block.classList.contains('umpire-ring-sched-current');
      let lo = 21;
      let hi = Math.max(
        lo,
        Math.min(isCurrent ? 99 : 57, availH * (isCurrent ? 1.3 : 1.09))
      );
      let best = lo;
      for (let i = 0; i < 18; i += 1) {
        const mid = (lo + hi) / 2;
        text.style.fontSize = mid + 'px';
        if (scheduleBlockOverflows(block, text)) {
          hi = mid;
        } else {
          best = mid;
          lo = mid;
        }
      }
      text.style.fontSize = best + 'px';
    });
  }

  function scheduleFitScheduleOverlay() {
    requestAnimationFrame(function () {
      requestAnimationFrame(fitScheduleOverlayFonts);
    });
  }

  function namesOverflow(texts) {
    return Array.from(texts).some((el) => {
      const cell = el.parentElement;
      const cellW = cell ? cell.clientWidth : el.clientWidth;
      const cellH = cell ? cell.clientHeight : el.clientHeight;
      return el.scrollWidth > cellW + 0.5 || el.scrollHeight > cellH + 0.5;
    });
  }

  function fitRingNameFonts() {
    const grid = document.getElementById('umpireRingGrid');
    if (!grid || grid.hidden || state.overlaySchedule) return;
    grid.querySelectorAll('.umpire-ring-names:not(.is-empty)').forEach((list) => {
      const texts = list.querySelectorAll('.umpire-ring-name-text');
      const roles = list.querySelectorAll('.umpire-ring-name-role');
      if (!texts.length) return;
      const cell = texts[0].parentElement;
      const maxPx = Math.max(7, Math.min(
        (cell && cell.clientHeight ? cell.clientHeight * 0.92 : 14),
        (cell && cell.clientWidth ? cell.clientWidth : 80),
        28
      ));
      let lo = 6;
      let hi = maxPx;
      let best = lo;
      const applySize = (px) => {
        texts.forEach((el) => {
          el.style.fontSize = px + 'px';
        });
        roles.forEach((el) => {
          el.style.fontSize = px + 'px';
        });
      };
      for (let i = 0; i < 16; i += 1) {
        const mid = (lo + hi) / 2;
        applySize(mid);
        if (namesOverflow(texts)) {
          hi = mid;
        } else {
          best = mid;
          lo = mid;
        }
      }
      applySize(best);
    });
  }

  function scheduleFitRingNames() {
    requestAnimationFrame(function () {
      requestAnimationFrame(fitRingNameFonts);
    });
  }

  function renderMobileRingRoster(ring) {
    const entries = ringCouncilEntries(ring);
    if (!entries.length) {
      return '<p class="umpire-ring-roster-empty">No umpires assigned</p>';
    }
    return (
      '<ul class="umpire-ring-roster">' +
        entries.map((entry) => (
          '<li class="umpire-ring-roster-item' +
            (entry.primary ? ' is-primary' : ' is-secondary') +
            (isSelected(entry.id) ? ' is-selected' : '') + '"' +
            ' draggable="true" data-umpire-id="' + escapeHtml(entry.id) + '" data-ring="' + ring + '">' +
            '<span class="umpire-ring-roster-role">' + escapeHtml(entry.abbrev) + '</span>' +
            '<span class="umpire-ring-roster-name">' + escapeHtml(entry.name) + '</span>' +
            '<button type="button" class="umpire-ring-roster-clear" data-clear="1" aria-label="Remove ' + escapeHtml(entry.name) + '">×</button>' +
          '</li>'
        )).join('') +
      '</ul>'
    );
  }

  function renderRingModal() {
    const modal = document.getElementById('umpireRingModal');
    const title = document.getElementById('umpireRingModalTitle');
    const cols = document.getElementById('umpireRingModalCols');
    const card = document.getElementById('umpireRingModalCard');
    const prevBtn = document.getElementById('umpireRingPrevBtn');
    const nextBtn = document.getElementById('umpireRingNextBtn');
    const clearBtn = document.getElementById('umpireRingClearBtn');
    if (!modal || !cols) return;
    const ring = Number(state.openRing) || 0;
    if (ring < 1 || ring > state.ringCount) {
      modal.hidden = true;
      return;
    }
    modal.hidden = false;
    const mobile = isMobileView();
    if (card) {
      card.setAttribute('data-ring', String(ring));
      card.classList.toggle('is-mobile-roster', mobile);
    }
    cols.classList.toggle('is-mobile-roster', mobile);
    if (title) title.textContent = 'Ring ' + ring;
    if (prevBtn) prevBtn.disabled = ring <= 1;
    if (nextBtn) nextBtn.disabled = ring >= state.ringCount;
    if (clearBtn) clearBtn.disabled = !ringHasAssignments(ring);
    if (mobile) {
      cols.innerHTML = renderMobileRingRoster(ring);
      return;
    }
    cols.innerHTML = RING_SLOT_GROUPS.map((group) => (
      '<div class="umpire-ring-col" data-ring="' + ring + '" data-col="' + escapeHtml(group.id) + '">' +
        '<h3 class="umpire-ring-col-title">' + escapeHtml(group.title) + '</h3>' +
        '<div class="umpire-ring-col-slots">' +
          group.slots.map((key) => renderSlot(ring, { key, label: SLOT_LABELS[key] || key }, group.id)).join('') +
        '</div>' +
      '</div>'
    )).join('');
    scheduleFitSlotNames();
  }

  function openRingModal(ring) {
    const n = Number(ring) || 0;
    if (n < 1 || n > state.ringCount) return;
    state.openRing = n;
    renderRings();
  }

  function closeRingModal() {
    if (!state.openRing) {
      const modal = document.getElementById('umpireRingModal');
      if (modal) modal.hidden = true;
      return;
    }
    state.openRing = 0;
    renderRings();
  }

  function stepRingModal(delta) {
    if (!state.openRing) return;
    openRingModal(state.openRing + delta);
  }

  function syncMobileHint() {
    const hint = document.querySelector('.umpire-mgmt-hint');
    if (!hint) return;
    hint.textContent = isMobileView()
      ? 'Long-press an umpire to drag. Tap a ring to assign, or to see who is on that ring.'
      : 'Click a ring to assign positions. Select referees, then drag onto a ring or into the ring window.';
  }

  function renderAll() {
    pruneSelection();
    syncMobileHint();
    renderUmpires();
    renderRings();
    syncScrollAffordances();
  }

  function updateScrollAffordance(el, cueId, gradientEl) {
    if (!el) return;
    const canScroll = el.scrollHeight > el.clientHeight + 6;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
    const gradient = gradientEl || el;
    gradient.classList.toggle('has-scroll', canScroll);
    gradient.classList.toggle('at-scroll-end', atBottom);
    el.classList.toggle('has-scroll', canScroll);
    el.classList.toggle('at-scroll-end', atBottom);
    const cue = cueId ? document.getElementById(cueId) : null;
    if (cue) cue.classList.toggle('is-visible', canScroll && !atBottom);
  }

  function syncScrollAffordances() {
    if (!isMobileView()) {
      document.querySelectorAll('.umpire-scroll-cue').forEach(function(cue) {
        cue.classList.remove('is-visible');
      });
      document.querySelectorAll('.has-scroll, .at-scroll-end').forEach(function(el) {
        el.classList.remove('has-scroll', 'at-scroll-end');
      });
      return;
    }
    updateScrollAffordance(document.getElementById('umpirePool'), 'umpirePoolScrollCue');
    const rings = document.getElementById('umpireRingGrid');
    const boards = document.querySelector('.umpire-mgmt-boards');
    updateScrollAffordance(rings, 'umpireRingsScrollCue', boards);
  }

  function bindScrollAffordances() {
    const pool = document.getElementById('umpirePool');
    const rings = document.getElementById('umpireRingGrid');
    [pool, rings].forEach(function(el) {
      if (!el || el.dataset.scrollAffordanceBound) return;
      el.dataset.scrollAffordanceBound = '1';
      el.addEventListener('scroll', function() {
        syncScrollAffordances();
      }, { passive: true });
    });
    if (typeof ResizeObserver !== 'undefined') {
      [pool, rings].forEach(function(el) {
        if (!el || el.dataset.scrollAffordanceRo) return;
        el.dataset.scrollAffordanceRo = '1';
        new ResizeObserver(function() {
          syncScrollAffordances();
        }).observe(el);
      });
    }
  }

  function showStage(show) {
    const stage = document.getElementById('umpireMgmtStage');
    if (stage) stage.hidden = !show;
  }

  function clearDropHighlights() {
    document.querySelectorAll('.is-drop-target').forEach((el) => {
      el.classList.remove('is-drop-target');
    });
  }

  function placeUmpire(id, toRing, toSlot, toIndex) {
    const umpireKey = String(id || '');
    if (!umpireKey || !state.umpiresById[umpireKey]) return false;
    const dest = state.assignments[String(toRing)];
    if (!dest || !Object.prototype.hasOwnProperty.call(dest, toSlot)) return false;

    const from = findAssignment(umpireKey);
    const destSeats = seatArray(dest, toSlot);
    const hasIndex = toIndex != null && Number.isFinite(Number(toIndex));
    let idx = hasIndex
      ? Math.max(0, Math.min(SLOT_CAPACITY - 1, Math.floor(Number(toIndex))))
      : destSeats.findIndex((seatId) => !seatId);
    if (idx < 0) return false;

    if (from && from.ring === Number(toRing) && from.slot === toSlot && from.index === idx) return false;

    const occupant = destSeats[idx] === umpireKey ? '' : destSeats[idx];

    if (from && from.ring === Number(toRing) && from.slot === toSlot) {
      destSeats[from.index] = '';
      if (occupant) destSeats[from.index] = occupant;
      destSeats[idx] = umpireKey;
      setSeatArray(dest, toSlot, destSeats);
      enforceUniqueAssignments();
      return true;
    }

    if (from) {
      const fromRow = state.assignments[String(from.ring)];
      const fromSeats = seatArray(fromRow, from.slot);
      fromSeats[from.index] = occupant && occupant !== umpireKey ? occupant : '';
      setSeatArray(fromRow, from.slot, fromSeats);
    } else if (occupant) {
      clearUmpireFromAllSlots(occupant);
    }

    clearUmpireFromAllSlots(umpireKey);
    const nextDest = seatArray(dest, toSlot);
    nextDest[idx] = umpireKey;
    setSeatArray(dest, toSlot, nextDest);
    enforceUniqueAssignments();
    return true;
  }

  function unassignUmpire(id) {
    const from = findAssignment(id);
    if (!from) return false;
    clearUmpireFromAllSlots(id);
    return true;
  }

  function unassignMany(ids) {
    let changed = false;
    uniqueIds(ids).forEach((id) => {
      if (unassignUmpire(id)) changed = true;
    });
    return changed;
  }

  function ringHasAssignments(ring) {
    const row = state.assignments[String(ring)];
    if (!row) return false;
    return RING_SLOTS.some((slot) => !slotIsEmpty(row, slot.key));
  }

  function clearRing(ring) {
    const row = state.assignments[String(ring)];
    if (!row) return false;
    const removed = [];
    RING_SLOTS.forEach((slot) => {
      const seats = seatArray(row, slot.key);
      for (let i = 0; i < SLOT_CAPACITY; i += 1) {
        if (!seats[i]) continue;
        removed.push(seats[i]);
        seats[i] = '';
      }
      setSeatArray(row, slot.key, seats);
    });
    if (!removed.length) return false;
    const gone = new Set(removed);
    state.selectedIds = state.selectedIds.filter((id) => !gone.has(id));
    return true;
  }

  function assignIdsToSlots(ids, ring, slotKeys, spread) {
    const dest = state.assignments[String(ring)];
    const keys = slotKeys && slotKeys.length ? slotKeys : RING_SLOTS.map((slot) => slot.key);
    if (!dest) return false;
    let changed = false;
    uniqueIds(ids).forEach((id) => {
      const loc = findAssignment(id);
      if (loc && loc.ring === Number(ring) && keys.indexOf(loc.slot) !== -1) return;
      clearUmpireFromAllSlots(id);
      let destSlot = null;
      if (spread) {
        let fewest = SLOT_CAPACITY;
        keys.forEach((key) => {
          const n = slotIds(dest, key).length;
          if (n < fewest) {
            fewest = n;
            destSlot = key;
          }
        });
      } else {
        destSlot = keys.find((key) => slotHasRoom(dest, key)) || null;
      }
      if (!destSlot || !slotHasRoom(dest, destSlot)) return;
      const seats = seatArray(dest, destSlot);
      const emptyIndex = seats.findIndex((seatId) => !seatId);
      if (emptyIndex === -1) return;
      seats[emptyIndex] = id;
      setSeatArray(dest, destSlot, seats);
      changed = true;
    });
    if (changed) enforceUniqueAssignments();
    return changed;
  }

  function assignToSlotsTopDown(ids, ring, slotKeys) {
    return assignIdsToSlots(ids, ring, slotKeys, false);
  }

  function assignToRingTopDown(ids, ring) {
    return assignIdsToSlots(ids, ring, RING_SLOTS.map((slot) => slot.key), true);
  }

  function dragIdsHasAssigned(ids) {
    return uniqueIds(ids).some((id) => Boolean(findAssignment(id)));
  }

  function removeDragGhost() {
    if (dragGhostEl && dragGhostEl.parentNode) dragGhostEl.parentNode.removeChild(dragGhostEl);
    dragGhostEl = null;
  }

  function scheduleSave() {
    if (!state.eventId) return;
    saveDirty = true;
    saveChain = saveChain.then(flushSave, flushSave);
  }

  async function flushSave() {
    while (saveDirty && state.eventId) {
      saveDirty = false;
      const eventId = state.eventId;
      const payload = JSON.parse(JSON.stringify(state.assignments));
      const seq = ++saveSeq;
      try {
        await apiFetch('/api/umpire-management/events/' + encodeURIComponent(eventId) + '/assignments', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignments: payload })
        });
        if (seq === saveSeq && eventId === state.eventId) {
          setStatus('');
          logInteraction('umpire_assignments_save', {
            eventId: eventId,
            ringCount: state.ringCount
          });
        }
      } catch (err) {
        if (eventId === state.eventId && seq === saveSeq) {
          setStatus(err.message || 'Unable to save umpire assignments.', true);
        }
        return;
      }
    }
  }

  function persistAssignmentsNow() {
    const done = saveChain.then(flushSave, flushSave);
    saveChain = done.catch(function () {});
    return done;
  }

  function flushSaveKeepalive() {
    if (!state.eventId || !saveDirty) return;
    const eventId = state.eventId;
    const payload = JSON.parse(JSON.stringify(state.assignments));
    saveDirty = false;
    try {
      fetch('/api/umpire-management/events/' + encodeURIComponent(eventId) + '/assignments', {
        method: 'PUT',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments: payload })
      });
    } catch (_) {
      saveDirty = true;
    }
  }

  async function apiFetch(url, options) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || ('Request failed (' + res.status + ')'));
    }
    return data;
  }

  async function loadEvents() {
    const select = document.getElementById('umpireEventSelect');
    if (!select) return;
    const keepId = String(select.value || state.eventId || '');
    try {
      const events = await apiFetch('/api/client-events');
      state.events = Array.isArray(events) ? events : [];
      if (!state.events.length) {
        select.innerHTML = '<option value="">— no events —</option>';
        setStatus('No events found for this organizer account.', true);
        return;
      }
      select.innerHTML = '<option value="">— choose an event —</option>' + state.events.map((event) => (
        '<option value="' + escapeHtml(event.id) + '">' + escapeHtml(formatEventLabel(event)) + '</option>'
      )).join('');
      if (keepId && state.events.some((event) => String(event.id) === keepId)) {
        select.value = keepId;
      } else {
        const lastId = readLastEventId();
        if (lastId && state.events.some((event) => String(event.id) === lastId)) {
          select.value = lastId;
        }
      }
      setStatus('');
    } catch (err) {
      select.innerHTML = '<option value="">— unable to load —</option>';
      setStatus(err.message || 'Unable to load events.', true);
    }
  }

  async function loadEvent(eventId, options) {
    await persistAssignmentsNow();
    const preserveView = Boolean(options && options.preserveView);
    const keepOpenRing = preserveView ? Number(state.openRing) || 0 : 0;
    state.eventId = String(eventId || '');
    if (state.eventId) rememberLastEventId(state.eventId);
    if (!state.eventId) {
      state.umpires = [];
      state.umpiresById = {};
      state.ringCount = 0;
      state.assignments = {};
      state.selectedIds = [];
      selectionAnchor = null;
      state.openRing = 0;
      state.scheduleOverlay = null;
      state.eventDateStart = null;
      resetFilters();
      rebuildTeamFilterOptions();
      hideUmpireDetails();
      showStage(false);
      setStatus('');
      syncOverlayTimer();
      return;
    }
    setStatus('');
    try {
      const data = await apiFetch('/api/umpire-management/events/' + encodeURIComponent(state.eventId));
      state.umpires = Array.isArray(data.umpires) ? data.umpires : [];
      indexUmpires();
      state.ringCount = Number(data.ringCount) || 0;
      state.assignments = normalizeAssignments(data.assignments, state.ringCount);
      state.scheduleOverlay = data.scheduleOverlay || null;
      state.eventDateStart = data.event && data.event.dateStart ? data.event.dateStart : null;
      enforceUniqueAssignments();
      state.selectedIds = [];
      selectionAnchor = null;
      state.openRing = keepOpenRing >= 1 && keepOpenRing <= state.ringCount ? keepOpenRing : 0;
      if (!preserveView) resetFilters();
      rebuildTeamFilterOptions();
      hideUmpireDetails();
      renderAll();
      showStage(true);
      setStatus('');
    } catch (err) {
      state.umpires = [];
      state.umpiresById = {};
      state.ringCount = 0;
      state.assignments = {};
      state.selectedIds = [];
      selectionAnchor = null;
      state.openRing = 0;
      state.scheduleOverlay = null;
      state.eventDateStart = null;
      resetFilters();
      rebuildTeamFilterOptions();
      hideUmpireDetails();
      showStage(false);
      setStatus(err.message || 'Unable to load umpire data.', true);
      syncOverlayTimer();
    }
  }

  async function refreshFromServer() {
    const btn = document.getElementById('umpireRefreshBtn');
    const select = document.getElementById('umpireEventSelect');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-busy');
    }
    try {
      await persistAssignmentsNow();
      await loadEvents();
      const preferred = String(
        (select && select.value)
        || state.eventId
        || readLastEventId()
        || ''
      );
      if (preferred && state.events.some((event) => String(event.id) === preferred)) {
        if (select) select.value = preferred;
        await loadEvent(preferred, { preserveView: true });
      } else {
        await loadEvent('');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-busy');
      }
    }
  }

  function executeUmpireDrop(ids, under) {
    if (!under) return false;
    const seat = under.closest('#umpireRingModal .umpire-slot-seat');
    const slot = seat ? seat.closest('.umpire-slot') : under.closest('#umpireRingModal .umpire-slot');
    const col = under.closest('.umpire-ring-col');
    const modalCard = under.closest('#umpireRingModalCard');
    const ringWrap = under.closest('.umpire-mgmt-rings .umpire-ring');
    const ringCard = under.closest('.umpire-ring-card') || ringWrap;
    const pool = under.closest('#umpirePool');
    const unique = uniqueIds(ids);
    let changed = false;

    if (slot) {
      const ring = Number(slot.getAttribute('data-ring'));
      const slotKey = slot.getAttribute('data-slot');
      const seatIndex = seat && seat.getAttribute('data-seat') != null
        ? Number(seat.getAttribute('data-seat'))
        : null;
      if (unique.length === 1) {
        changed = placeUmpire(unique[0], ring, slotKey, Number.isFinite(seatIndex) ? seatIndex : null);
      } else {
        const group = RING_SLOT_GROUPS.find((item) => item.slots.indexOf(slotKey) !== -1);
        const slots = group
          ? [slotKey].concat(group.slots.filter((key) => key !== slotKey))
          : [slotKey];
        changed = assignToSlotsTopDown(unique, ring, slots);
      }
    } else if (col) {
      const ring = Number(col.getAttribute('data-ring'));
      const group = RING_SLOT_GROUPS.find((item) => item.id === col.getAttribute('data-col'));
      changed = assignIdsToSlots(unique, ring, group ? group.slots : [], true);
    } else if (modalCard || ringCard) {
      const ring = Number((modalCard || ringCard).getAttribute('data-ring'));
      changed = assignToRingTopDown(unique, ring);
    } else if (pool && dragIdsHasAssigned(unique)) {
      changed = unassignMany(unique);
    }

    return changed;
  }

  function beginUmpireDrag(item) {
    const id = item.getAttribute('data-umpire-id');
    if (!id) return false;
    let ids = isSelected(id) ? state.selectedIds.slice() : [id];
    ids = uniqueIds(ids);
    if (!ids.length) return false;
    if (!isSelected(id)) {
      setSelection(ids, id, item.closest('#umpirePool') ? 'pool' : Number(item.closest('[data-ring]')?.getAttribute('data-ring') || 0) || 'pool');
    }
    dragPayload = { ids };
    ids.forEach((selectedId) => {
      document.querySelectorAll('[data-umpire-id="' + CSS.escape(selectedId) + '"]').forEach((el) => {
        el.classList.add('is-dragging');
      });
    });
    return dragPayload;
  }

  function clearUmpireDragVisuals() {
    document.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
    clearDropHighlights();
    removeDragGhost();
    dragPayload = null;
  }

  function highlightUmpireDropTarget(under) {
    clearDropHighlights();
    if (!under || !dragPayload) return;
    const seat = under.closest('#umpireRingModal .umpire-slot-seat');
    const slot = seat ? seat.closest('.umpire-slot') : under.closest('#umpireRingModal .umpire-slot');
    const col = under.closest('.umpire-ring-col');
    const modalCard = under.closest('#umpireRingModalCard');
    const ringWrap = under.closest('.umpire-mgmt-rings .umpire-ring');
    const ringCard = under.closest('.umpire-ring-card') || (ringWrap ? ringWrap.querySelector('.umpire-ring-card') : null);
    const pool = under.closest('#umpirePool');
    const canDropOnPool = Boolean(pool && dragIdsHasAssigned(dragPayload.ids));
    const target = seat || slot || col || modalCard || ringCard || (canDropOnPool ? pool : null);
    if (target) target.classList.add('is-drop-target');
  }

  document.addEventListener('dragstart', (e) => {
    const item = e.target.closest('[draggable="true"][data-umpire-id]');
    if (!item || !e.dataTransfer) return;
    const id = item.getAttribute('data-umpire-id');
    if (!id) return;
    let ids = isSelected(id) ? state.selectedIds.slice() : [id];
    ids = uniqueIds(ids);
    if (!ids.length) return;
    if (!isSelected(id)) setSelection(ids, id, item.closest('#umpirePool') ? 'pool' : Number(item.closest('[data-ring]')?.getAttribute('data-ring') || 0) || 'pool');
    dragPayload = { ids };
    ids.forEach((selectedId) => {
      document.querySelectorAll('[data-umpire-id="' + CSS.escape(selectedId) + '"]').forEach((el) => {
        el.classList.add('is-dragging');
      });
    });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ids.join(','));
    removeDragGhost();
    if (ids.length > 1) {
      dragGhostEl = document.createElement('div');
      dragGhostEl.className = 'umpire-drag-ghost';
      dragGhostEl.textContent = ids.length + ' umpires';
      document.body.appendChild(dragGhostEl);
      try {
        e.dataTransfer.setDragImage(dragGhostEl, 24, 16);
      } catch (_) {
        /* some browsers reject custom drag images */
      }
    }
  });

  document.addEventListener('dragend', () => {
    document.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
    clearDropHighlights();
    removeDragGhost();
    dragPayload = null;
  });

  document.addEventListener('dragover', (e) => {
    if (!dragPayload) return;
    const seat = e.target.closest('#umpireRingModal .umpire-slot-seat');
    const slot = seat ? seat.closest('.umpire-slot') : e.target.closest('#umpireRingModal .umpire-slot');
    const col = e.target.closest('.umpire-ring-col');
    const modalCard = e.target.closest('#umpireRingModalCard');
    const ringWrap = e.target.closest('.umpire-mgmt-rings .umpire-ring');
    const ringCard = e.target.closest('.umpire-ring-card') || (ringWrap ? ringWrap.querySelector('.umpire-ring-card') : null);
    const pool = e.target.closest('#umpirePool');
    const canDropOnPool = Boolean(pool && dragIdsHasAssigned(dragPayload.ids));
    const target = seat || slot || col || modalCard || ringCard || (canDropOnPool ? pool : null);
    if (target) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!target.classList.contains('is-drop-target')) {
        clearDropHighlights();
        target.classList.add('is-drop-target');
      }
      return;
    }
    clearDropHighlights();
  });

  document.addEventListener('drop', (e) => {
    if (!dragPayload) return;
    const payload = dragPayload;
    dragPayload = null;
    clearDropHighlights();
    document.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
    removeDragGhost();
    e.preventDefault();
    if (executeUmpireDrop(payload.ids, e.target)) {
      renderAll();
      scheduleSave();
    }
  });

  bindTouchDnD(document, {
    selector: '[draggable="true"][data-umpire-id]',
    onDragStart(item) {
      return beginUmpireDrag(item) || false;
    },
    onDragMove(_touch, payload, under) {
      if (!payload) return;
      dragPayload = payload;
      highlightUmpireDropTarget(under);
    },
    onDragEnd(_touch, payload, under) {
      if (!payload) {
        clearUmpireDragVisuals();
        return;
      }
      const ids = payload.ids;
      dragPayload = null;
      clearDropHighlights();
      document.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
      removeDragGhost();
      if (executeUmpireDrop(ids, under)) {
        renderAll();
        scheduleSave();
      }
    },
    onDragCancel() {
      clearUmpireDragVisuals();
    },
    dragImage(item) {
      const ghost = document.createElement('div');
      ghost.className = 'umpire-drag-ghost touch-dnd-follower';
      const count = isSelected(item.getAttribute('data-umpire-id'))
        ? state.selectedIds.length
        : 1;
      ghost.textContent = count > 1 ? count + ' umpires' : umpireDisplayName(state.umpiresById[item.getAttribute('data-umpire-id')] || {}) || 'Umpire';
      return ghost;
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#umpireRingModalClose') || e.target.id === 'umpireRingModal') {
      closeRingModal();
      return;
    }
    if (e.target.closest('#umpireRingPrevBtn')) {
      stepRingModal(-1);
      return;
    }
    if (e.target.closest('#umpireRingNextBtn')) {
      stepRingModal(1);
      return;
    }
    if (e.target.closest('#umpireRingClearBtn')) {
      if (clearRing(state.openRing)) {
        renderAll();
        scheduleSave();
      }
      return;
    }

    const rosterClear = e.target.closest('.umpire-ring-roster-clear');
    if (rosterClear) {
      const row = rosterClear.closest('[data-umpire-id]');
      const id = row && row.getAttribute('data-umpire-id');
      if (id && unassignUmpire(id)) {
        renderAll();
        scheduleSave();
      }
      return;
    }

    const clearBtn = e.target.closest('.umpire-slot-clear');
    if (clearBtn) {
      const seatEl = clearBtn.closest('.umpire-slot-seat');
      const slotEl = clearBtn.closest('.umpire-slot');
      if (!slotEl) return;
      const ring = Number(slotEl.getAttribute('data-ring'));
      const slotKey = slotEl.getAttribute('data-slot');
      const row = state.assignments[String(ring)];
      if (!row) return;
      const seats = seatArray(row, slotKey);
      const seatIndex = seatEl && seatEl.getAttribute('data-seat') != null
        ? Number(seatEl.getAttribute('data-seat'))
        : seats.findIndex((seatId) => seatId);
      if (!Number.isFinite(seatIndex) || seatIndex < 0 || seatIndex >= SLOT_CAPACITY) return;
      const removedId = seats[seatIndex];
      if (!removedId) return;
      seats[seatIndex] = '';
      setSeatArray(row, slotKey, seats);
      state.selectedIds = state.selectedIds.filter((id) => id !== removedId);
      renderAll();
      scheduleSave();
      return;
    }

    const emptySeat = e.target.closest('#umpireRingModal .umpire-slot-seat.is-empty');
    const emptySlot = emptySeat || e.target.closest('#umpireRingModal .umpire-slot.is-empty');
    if (emptySlot && state.selectedIds.length) {
      const slotEl = emptySeat ? emptySeat.closest('.umpire-slot') : emptySlot;
      const ring = Number(slotEl.getAttribute('data-ring'));
      const slotKey = slotEl.getAttribute('data-slot');
      const seatIndex = emptySeat && emptySeat.getAttribute('data-seat') != null
        ? Number(emptySeat.getAttribute('data-seat'))
        : null;
      if (assignSelectedToSlot(ring, slotKey, Number.isFinite(seatIndex) ? seatIndex : null)) {
        renderAll();
        scheduleSave();
      }
      return;
    }

    const filledSeat = e.target.closest('.umpire-slot-seat.is-filled');
    const umpireEl = e.target.closest('[data-umpire-id]')
      || (filledSeat ? filledSeat : null);
    if (umpireEl && !e.target.closest('.umpire-slot-clear') && !e.target.closest('.umpire-ring-roster-clear') && !e.target.closest('.umpire-ring-card')) {
      const scope = umpireEl.closest('#umpirePool')
        ? 'pool'
        : Number(umpireEl.closest('[data-ring]')?.getAttribute('data-ring') || 0);
      applySelectionFromClick(umpireEl.getAttribute('data-umpire-id'), scope, e);
      markSelectedInDom();
      showUmpireDetails(umpireEl.getAttribute('data-umpire-id'), e.clientX, e.clientY);
      return;
    }

    if (!state.openRing) {
      const ringWrap = e.target.closest('.umpire-mgmt-rings .umpire-ring');
      if (ringWrap) {
        hideUmpireDetails();
        openRingModal(Number(ringWrap.getAttribute('data-ring')));
        return;
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.target.closest('#umpireMgmtStage') && !e.target.closest('.umpire-slot, .umpire-ring, .umpire-ring-modal')) {
      if (state.selectedIds.length) {
        setSelection([]);
        markSelectedInDom();
      }
    }

    const pop = detailsPop();
    if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest('[data-umpire-id]')) {
      hideUmpireDetails();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (detailsPop() && !detailsPop().hidden) {
        hideUmpireDetails();
        return;
      }
      if (state.openRing) {
        closeRingModal();
        return;
      }
      if (state.selectedIds.length) {
        setSelection([]);
        markSelectedInDom();
      }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !state.openRing) {
      const ringWrap = e.target.closest('.umpire-mgmt-rings .umpire-ring');
      if (ringWrap) {
        e.preventDefault();
        openRingModal(Number(ringWrap.getAttribute('data-ring')));
      }
    }
  });

  document.getElementById('umpireEventSelect')?.addEventListener('change', function (e) {
    const eventId = e.target.value;
    logInteraction('umpire_event_selected', { eventId: eventId || null });
    if (eventId) rememberLastEventId(eventId);
    notifyPortalEventSelected(eventId);
    loadEvent(eventId);
  });

  document.getElementById('umpireRefreshBtn')?.addEventListener('click', function () {
    refreshFromServer();
  });

  document.getElementById('umpireGridLayoutSelect')?.addEventListener('change', function (e) {
    applyGridLayout(e.target.value);
  });

  document.getElementById('umpireOverlayScheduleBtn')?.addEventListener('click', function () {
    setOverlaySchedule(!state.overlaySchedule);
  });

  function bindFilterSelect(id, key) {
    const select = document.getElementById(id);
    if (!select) return;
    select.addEventListener('change', function () {
      state.filters[key] = String(select.value || '');
      renderUmpires();
      syncScrollAffordances();
    });
  }
  bindFilterSelect('umpireFilterRank', 'rank');
  bindFilterSelect('umpireFilterTeam', 'team');
  bindFilterSelect('umpireFilterRegion', 'region');
  bindFilterSelect('umpireFilterPreferredRole', 'preferredRole');
  bindFilterSelect('umpireFilterClass', 'class');

  const ringGrid = document.getElementById('umpireRingGrid');
  if (ringGrid && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      if (!ringGrid.hidden) {
        if (state.overlaySchedule) fitScheduleOverlayFonts();
        else fitRingNameFonts();
      }
    }).observe(ringGrid);
  }

  const ringModalCols = document.getElementById('umpireRingModalCols');
  if (ringModalCols && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      const modal = document.getElementById('umpireRingModal');
      if (modal && !modal.hidden) fitSlotNameFonts();
    }).observe(ringModalCols);
  }

  window.addEventListener('pagehide', flushSaveKeepalive);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') persistAssignmentsNow();
  });

  applyGridLayout(readStoredGridLayout(), { skipStore: true });
  syncMobileLayoutClass();
  syncMobileHint();
  bindScrollAffordances();
  let lastMobileLayout = isMobileView();
  window.addEventListener('resize', function () {
    const mobile = isMobileView();
    syncMobileLayoutClass();
    syncMobileHint();
    if (mobile !== lastMobileLayout) {
      lastMobileLayout = mobile;
      if (state.ringCount > 0) renderRings();
    }
    syncScrollAffordances();
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data) return;
    if (event.data.type === 'portal-focus-day') {
      try {
        localStorage.setItem(PORTAL_FOCUS_DAY_KEY, String(Math.max(0, Number(event.data.dayIndex) || 0)));
      } catch (_) { /* ignore */ }
      if (state.overlaySchedule && state.ringCount > 0) renderRings();
      return;
    }
    if (event.data.type === 'portal-event-selected') {
      const eventId = String(event.data.eventId || '').trim();
      if (eventId === String(state.eventId || '')) return;
      const select = document.getElementById('umpireEventSelect');
      if (eventId && !state.events.some((entry) => String(entry.id) === eventId)) return;
      if (select) select.value = eventId;
      if (eventId) rememberLastEventId(eventId);
      loadEvent(eventId);
      return;
    }
    if (event.data.type !== 'portal-data-updated') return;
    if (event.data.eventId) rememberLastEventId(event.data.eventId);
    refreshFromServer();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== PORTAL_FOCUS_DAY_KEY) return;
    if (state.overlaySchedule && state.ringCount > 0) renderRings();
  });
  loadEvents().then(() => {
    logInteraction('page_view', { description: 'Umpire management page loaded' });
    const select = document.getElementById('umpireEventSelect');
    const eventId = String((select && select.value) || readLastEventId() || '');
    if (eventId && state.events.some((event) => String(event.id) === eventId)) {
      if (select) select.value = eventId;
      return loadEvent(eventId);
    }
    return null;
  });
}());
