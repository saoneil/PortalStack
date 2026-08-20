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
    eventDateStart: null
  };

  let dragPayload = null;
  let dragGhostEl = null;
  let saveDirty = false;
  let saveChain = Promise.resolve();
  let saveSeq = 0;
  let selectionAnchor = null;
  let overlayTimer = null;

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
        upcoming: items.filter((item) => item.start >= inPlay.end).slice(0, 3).map((item) => item.name)
      };
    }
    const future = items.filter((item) => item.start >= ctx.nowOff);
    if (future.length) {
      return {
        current: future[0].name,
        upcoming: future.slice(1, 4).map((item) => item.name)
      };
    }
    return { current: '—', upcoming: [] };
  }

  function renderScheduleOverlay(ring) {
    const info = ringScheduleOverlay(ring);
    const upcoming = info.upcoming.length
      ? info.upcoming.map((name) => (
        '<div class="umpire-ring-sched-next">' + escapeHtml(name) + '</div>'
      )).join('')
      : '<div class="umpire-ring-sched-next">No upcoming divisions</div>';
    return (
      '<div class="umpire-ring-overlay is-schedule">' +
        '<div class="umpire-ring-sched-current">' + escapeHtml(info.current || '—') + '</div>' +
        '<div class="umpire-ring-sched-upcoming">' + upcoming + '</div>' +
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

  function slotLabel(slotKey) {
    const slot = RING_SLOTS.find((item) => item.key === slotKey);
    return slot ? slot.label : slotKey;
  }

  function emptyRingAssignments() {
    const row = {};
    RING_SLOTS.forEach((slot) => {
      row[slot.key] = null;
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

  function normalizeAssignments(raw, ringCount) {
    const next = emptyAssignments(ringCount);
    const used = new Set();
    const src = raw && typeof raw === 'object' ? raw : {};
    for (let ring = 1; ring <= ringCount; ring += 1) {
      const key = String(ring);
      const row = src[key] && typeof src[key] === 'object' ? src[key] : {};
      RING_SLOTS.forEach((slot) => {
        const id = row[slot.key] == null || row[slot.key] === '' ? '' : String(row[slot.key]);
        if (id && state.umpiresById[id] && !used.has(id)) {
          next[key][slot.key] = id;
          used.add(id);
        } else {
          next[key][slot.key] = null;
        }
      });
    }
    return next;
  }

  function slotValue(row, key) {
    if (!row) return '';
    const value = row[key];
    if (value == null || value === '') return '';
    return String(value);
  }

  function slotIsEmpty(row, key) {
    return !slotValue(row, key);
  }

  function clearUmpireFromAllSlots(id) {
    const key = String(id || '');
    if (!key) return;
    for (let ring = 1; ring <= state.ringCount; ring += 1) {
      const row = state.assignments[String(ring)];
      if (!row) continue;
      RING_SLOTS.forEach((slot) => {
        if (slotValue(row, slot.key) === key) row[slot.key] = null;
      });
    }
  }

  function enforceUniqueAssignments() {
    const used = new Set();
    for (let ring = 1; ring <= state.ringCount; ring += 1) {
      const row = state.assignments[String(ring)];
      if (!row) continue;
      RING_SLOTS.forEach((slot) => {
        const id = slotValue(row, slot.key);
        if (!id || used.has(id) || !state.umpiresById[id]) {
          row[slot.key] = null;
          return;
        }
        used.add(id);
        row[slot.key] = id;
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
        if (slotValue(row, slotKey) === umpireKey) {
          return { ring, slot: slotKey };
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
    return RING_SLOTS
      .map((slot) => row[slot.key] == null ? '' : String(row[slot.key]))
      .filter(Boolean);
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
    document.querySelectorAll('.umpire-slot').forEach((el) => {
      el.classList.toggle('is-selected', isSelected(el.getAttribute('data-umpire-id')));
    });
  }

  function renderUmpires() {
    const heading = document.getElementById('umpireCountHeading');
    const list = document.getElementById('umpireList');
    const empty = document.getElementById('umpireListEmpty');
    const count = state.umpires.length;
    const unassigned = state.umpires.filter((umpire) => !findAssignment(umpireId(umpire)));
    if (heading) {
      heading.textContent = count === 1 ? '1 registered umpire' : (count + ' registered umpires');
    }
    if (!list || !empty) return;
    if (!unassigned.length) {
      list.innerHTML = '';
      empty.hidden = false;
      empty.textContent = count
        ? 'All umpires are assigned to rings.'
        : 'No umpires are registered for this event.';
      return;
    }
    empty.hidden = true;
    list.innerHTML = unassigned.map((umpire) => {
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

  function renderSlot(ring, slot) {
    const assignedId = state.assignments[String(ring)] ? state.assignments[String(ring)][slot.key] : null;
    const umpire = assignedId ? state.umpiresById[String(assignedId)] : null;
    const filled = Boolean(umpire);
    const rank = filled ? String(umpire.rank || '').trim() : '';
    const club = filled ? String(umpire.team_name_or_country || '').trim() : '';
    const details = filled
      ? (
        '<span class="umpire-slot-person' + (isSelected(umpireId(umpire)) ? ' is-selected' : '') + '">' +
          escapeHtml(umpireDisplayName(umpire)) +
        '</span>' +
        (rank ? '<span class="umpire-slot-meta">' + escapeHtml(rank) + '</span>' : '') +
        (club ? '<span class="umpire-slot-meta">' + escapeHtml(club) + '</span>' : '')
      )
      : '<span class="umpire-slot-placeholder">Drop umpire</span>';
    return (
      '<div class="umpire-slot' + (filled ? ' is-filled' : ' is-empty') + (filled && isSelected(umpireId(umpire)) ? ' is-selected' : '') + '"' +
        (filled ? ' draggable="true" data-umpire-id="' + escapeHtml(umpireId(umpire)) + '"' : '') +
        ' data-ring="' + ring + '" data-slot="' + escapeHtml(slot.key) + '">' +
        '<div class="umpire-slot-top">' +
          '<span class="umpire-slot-role">' + escapeHtml(slot.label) + '</span>' +
          (filled
            ? '<button type="button" class="umpire-slot-clear" data-clear="1" aria-label="Remove ' + escapeHtml(umpireDisplayName(umpire)) + '">×</button>'
            : '') +
        '</div>' +
        details +
      '</div>'
    );
  }

  function renderRings() {
    const grid = document.getElementById('umpireRingGrid');
    const empty = document.getElementById('umpireRingsEmpty');
    if (!grid || !empty) return;
    const n = Math.max(0, Number(state.ringCount) || 0);
    if (n < 1) {
      grid.innerHTML = '';
      grid.hidden = true;
      empty.hidden = false;
      state.openRing = 0;
      const modal = document.getElementById('umpireRingModal');
      if (modal) modal.hidden = true;
      syncOverlayTimer();
      return;
    }
    const dims = ringGridDims(n);
    grid.hidden = Boolean(state.openRing);
    empty.hidden = true;
    grid.style.setProperty('--ring-cols', String(dims.cols));
    grid.style.setProperty('--ring-rows', String(dims.rows));
    grid.innerHTML = Array.from({ length: n }, (_, i) => {
      const ring = i + 1;
      const seenIds = new Set();
      const names = RING_SLOTS.map((slot) => {
        const id = state.assignments[String(ring)] && state.assignments[String(ring)][slot.key];
        const key = id == null || id === '' ? '' : String(id);
        if (!key || seenIds.has(key)) return '';
        seenIds.add(key);
        const umpire = state.umpiresById[key];
        return umpire ? umpireDisplayName(umpire) : '';
      }).filter(Boolean);
      const nameList = names.length
        ? names.map((name) => (
          '<span class="umpire-ring-name"><span class="umpire-ring-name-text">' + escapeHtml(name) + '</span></span>'
        )).join('')
        : '<span class="umpire-ring-name is-empty">No umpires assigned</span>';
      const overlayHtml = state.overlaySchedule
        ? renderScheduleOverlay(ring)
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
    }).join('');
    renderRingModal();
    syncOverlayTimer();
    if (!state.overlaySchedule) scheduleFitRingNames();
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
      for (let i = 0; i < 16; i += 1) {
        const mid = (lo + hi) / 2;
        texts.forEach((el) => {
          el.style.fontSize = mid + 'px';
        });
        if (namesOverflow(texts)) {
          hi = mid;
        } else {
          best = mid;
          lo = mid;
        }
      }
      texts.forEach((el) => {
        el.style.fontSize = best + 'px';
      });
    });
  }

  function scheduleFitRingNames() {
    requestAnimationFrame(function () {
      requestAnimationFrame(fitRingNameFonts);
    });
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
    if (card) card.setAttribute('data-ring', String(ring));
    if (title) title.textContent = 'Ring ' + ring;
    if (prevBtn) prevBtn.disabled = ring <= 1;
    if (nextBtn) nextBtn.disabled = ring >= state.ringCount;
    if (clearBtn) clearBtn.disabled = !ringHasAssignments(ring);
    cols.innerHTML = RING_SLOT_GROUPS.map((group) => (
      '<div class="umpire-ring-col" data-ring="' + ring + '" data-col="' + escapeHtml(group.id) + '">' +
        '<h3 class="umpire-ring-col-title">' + escapeHtml(group.title) + '</h3>' +
        '<div class="umpire-ring-col-slots">' +
          group.slots.map((key) => renderSlot(ring, { key, label: SLOT_LABELS[key] || key })).join('') +
        '</div>' +
      '</div>'
    )).join('');
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

  function renderAll() {
    pruneSelection();
    renderUmpires();
    renderRings();
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

  function placeUmpire(id, toRing, toSlot) {
    const umpireKey = String(id || '');
    if (!umpireKey || !state.umpiresById[umpireKey]) return false;
    const destRing = String(toRing);
    const dest = state.assignments[destRing];
    if (!dest || !Object.prototype.hasOwnProperty.call(dest, toSlot)) return false;

    const occupant = slotValue(dest, toSlot);
    if (occupant === umpireKey) return false;

    const from = findAssignment(umpireKey);
    clearUmpireFromAllSlots(umpireKey);
    if (occupant) {
      clearUmpireFromAllSlots(occupant);
      if (from && (from.ring !== Number(toRing) || from.slot !== toSlot)) {
        const fromRow = state.assignments[String(from.ring)];
        if (fromRow && slotIsEmpty(fromRow, from.slot)) fromRow[from.slot] = occupant;
      }
    }
    dest[toSlot] = umpireKey;
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
      const id = slotValue(row, slot.key);
      if (id) {
        removed.push(id);
        row[slot.key] = null;
      }
    });
    if (!removed.length) return false;
    const gone = new Set(removed);
    state.selectedIds = state.selectedIds.filter((id) => !gone.has(id));
    return true;
  }

  function assignToSlotsTopDown(ids, ring, slotKeys) {
    const destKey = String(ring);
    const dest = state.assignments[destKey];
    const keys = slotKeys && slotKeys.length ? slotKeys : RING_SLOTS.map((slot) => slot.key);
    if (!dest) return false;
    let changed = false;
    uniqueIds(ids).forEach((id) => {
      const loc = findAssignment(id);
      if (loc && loc.ring === Number(ring) && keys.indexOf(loc.slot) !== -1) return;
      clearUmpireFromAllSlots(id);
      const emptyKey = keys.find((key) => slotIsEmpty(dest, key));
      if (!emptyKey) return;
      dest[emptyKey] = id;
      changed = true;
    });
    if (changed) enforceUniqueAssignments();
    return changed;
  }

  function assignToRingTopDown(ids, ring) {
    return assignToSlotsTopDown(ids, ring, RING_SLOTS.map((slot) => slot.key));
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
        if (seq === saveSeq && eventId === state.eventId) setStatus('');
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
    const slot = e.target.closest('#umpireRingModal .umpire-slot');
    const col = e.target.closest('.umpire-ring-col');
    const modalCard = e.target.closest('#umpireRingModalCard');
    const ringWrap = e.target.closest('.umpire-mgmt-rings .umpire-ring');
    const ringCard = e.target.closest('.umpire-ring-card') || (ringWrap ? ringWrap.querySelector('.umpire-ring-card') : null);
    const pool = e.target.closest('#umpirePool');
    const canDropOnPool = Boolean(pool && dragIdsHasAssigned(dragPayload.ids));
    const target = slot || col || modalCard || ringCard || (canDropOnPool ? pool : null);
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
    const slot = e.target.closest('#umpireRingModal .umpire-slot');
    const col = e.target.closest('.umpire-ring-col');
    const modalCard = e.target.closest('#umpireRingModalCard');
    const ringWrap = e.target.closest('.umpire-mgmt-rings .umpire-ring');
    const ringCard = e.target.closest('.umpire-ring-card') || ringWrap;
    const pool = e.target.closest('#umpirePool');
    const payload = dragPayload;
    dragPayload = null;
    clearDropHighlights();
    document.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
    removeDragGhost();
    const ids = uniqueIds(payload.ids);
    let changed = false;

    if (slot) {
      e.preventDefault();
      const ring = Number(slot.getAttribute('data-ring'));
      const slotKey = slot.getAttribute('data-slot');
      if (ids.length === 1) {
        changed = placeUmpire(ids[0], ring, slotKey);
      } else {
        const group = RING_SLOT_GROUPS.find((item) => item.slots.indexOf(slotKey) !== -1);
        changed = assignToSlotsTopDown(ids, ring, group ? group.slots : [slotKey]);
      }
    } else if (col) {
      e.preventDefault();
      const ring = Number(col.getAttribute('data-ring'));
      const group = RING_SLOT_GROUPS.find((item) => item.id === col.getAttribute('data-col'));
      changed = assignToSlotsTopDown(ids, ring, group ? group.slots : []);
    } else if (modalCard || ringCard) {
      e.preventDefault();
      const ring = Number((modalCard || ringCard).getAttribute('data-ring'));
      changed = assignToRingTopDown(ids, ring);
    } else if (pool && dragIdsHasAssigned(ids)) {
      e.preventDefault();
      changed = unassignMany(ids);
    }

    if (changed) {
      renderAll();
      scheduleSave();
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

    const clearBtn = e.target.closest('.umpire-slot-clear');
    if (clearBtn) {
      const slotEl = clearBtn.closest('.umpire-slot');
      if (!slotEl) return;
      const ring = Number(slotEl.getAttribute('data-ring'));
      const slotKey = slotEl.getAttribute('data-slot');
      const row = state.assignments[String(ring)];
      if (!row || !row[slotKey]) return;
      const removedId = String(row[slotKey]);
      row[slotKey] = null;
      state.selectedIds = state.selectedIds.filter((id) => id !== removedId);
      renderAll();
      scheduleSave();
      return;
    }

    const filledSlot = e.target.closest('.umpire-slot.is-filled');
    const umpireEl = e.target.closest('[data-umpire-id]')
      || (filledSlot ? filledSlot.querySelector('[data-umpire-id]') : null);
    if (umpireEl && !e.target.closest('.umpire-slot-clear') && !e.target.closest('.umpire-ring-card')) {
      const scope = umpireEl.closest('#umpirePool')
        ? 'pool'
        : Number(umpireEl.closest('[data-ring]')?.getAttribute('data-ring') || 0);
      applySelectionFromClick(umpireEl.getAttribute('data-umpire-id'), scope, e);
      markSelectedInDom();
      return;
    }

    if (!state.openRing) {
      const ringWrap = e.target.closest('.umpire-mgmt-rings .umpire-ring');
      if (ringWrap) {
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
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
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
    if (eventId) rememberLastEventId(eventId);
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

  const ringGrid = document.getElementById('umpireRingGrid');
  if (ringGrid && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      if (!ringGrid.hidden && !state.overlaySchedule) fitRingNameFonts();
    }).observe(ringGrid);
  }

  window.addEventListener('pagehide', flushSaveKeepalive);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') persistAssignmentsNow();
  });

  applyGridLayout(readStoredGridLayout(), { skipStore: true });
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== 'portal-data-updated') return;
    if (event.data.eventId) rememberLastEventId(event.data.eventId);
    refreshFromServer();
  });
  loadEvents().then(() => {
    const select = document.getElementById('umpireEventSelect');
    const eventId = String((select && select.value) || readLastEventId() || '');
    if (eventId && state.events.some((event) => String(event.id) === eventId)) {
      if (select) select.value = eventId;
      return loadEvent(eventId);
    }
    return null;
  });
}());
