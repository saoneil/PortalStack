import { apiFetch } from './api.js';
import { state } from './state.js';
import { showConfirmModal, showToast, switchDrawSubtab, renderDrawPreviewPanels, escapeHtml } from './ui.js';
import { getPatternMeta } from './pattern-form.js';
import { setDrawEditorEntryResolver } from './draw-editor.js';

let deps = {
  ensureDrawsLoaded: async () => {},
  regenerateDraws: async () => {}
};
let loadedEventId = '';
let selectedSet = new Set();

const modalTargets = {
  subtabSelector: '#daCustomDivisionModal .da-subtab',
  subpanelSelector: '#daCustomDivisionModal .da-subpanel',
  rightSelector: '#daCustomDivisionModal .da-custom-division-right',
  selectedNameId: '',
  athletesListId: 'customDrawAthletesList',
  drawSubtabKey: 'customDrawSubtab',
  athletesReadOnly: true,
  matchesTargets: {
    viewportId: 'customDrawMatchesViewport',
    contentId: 'customDrawMatchesContent',
    hintId: 'customDrawMatchesHint',
    zoomInId: 'customMatchesZoomIn',
    zoomOutId: 'customMatchesZoomOut',
    zoomFitId: 'customMatchesZoomFit'
  },
  editTargets: {
    typeBarId: 'customDrawEditTypeBar',
    typeSelectId: 'customDrawEditTypeSelect',
    editorId: 'customInteractiveEditor',
    hintId: 'customDrawEditHint'
  }
};

function modalEl() {
  return document.getElementById('daCustomDivisionModal');
}

function selectedAthletes() {
  const all = state.allEventAthletes || [];
  return all.filter((a) => selectedSet.has(Number(a.index)));
}

function eventName(eventKey) {
  const names = getPatternMeta()?.eventDisplayNames || {};
  return names[eventKey] || eventKey || 'event';
}

function sourceHaystack(athlete) {
  return String(`${athlete.name || ''} ${athlete.club || athlete.team || ''}`).toLowerCase();
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

function formatMeasure(value, unit) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${n} ${unit}`;
}

function registeredEventNames(athlete) {
  const events = athlete?.events;
  if (!events || typeof events !== 'object') return '';
  return Object.keys(events)
    .filter((key) => Number(events[key] || 0) === 1)
    .map((key) => eventName(key))
    .join(', ');
}

function findAthleteByIndex(index) {
  const idx = Number(index);
  if (!Number.isFinite(idx)) return null;
  const fromAll = (state.allEventAthletes || []).find((a) => Number(a.index) === idx);
  if (fromAll) return fromAll;
  return (state.customDrawDraft?.athletes || []).find((a) => Number(a.index) === idx) || null;
}

function detailsPop() {
  return document.getElementById('daAthleteDetailsPop');
}

function hideAthleteDetails() {
  const pop = detailsPop();
  if (pop) pop.hidden = true;
}

function showAthleteDetails(index, clientX, clientY) {
  const athlete = findAthleteByIndex(index);
  const pop = detailsPop();
  const nameEl = document.getElementById('daAthleteDetailsName');
  const listEl = document.getElementById('daAthleteDetailsList');
  if (!pop || !nameEl || !listEl) return;
  if (!athlete) {
    hideAthleteDetails();
    return;
  }
  const rows = [
    ['club', dash(athlete.club || athlete.team)],
    ['age', athlete.age != null && athlete.age !== '' ? String(athlete.age) : '—'],
    ['date of birth', formatDob(athlete.dob)],
    ['rank', dash(athlete.rank)],
    ['gender', dash(athlete.gender)],
    ['weight', formatMeasure(athlete.weight_kg, 'kg')],
    ['height', formatMeasure(athlete.height_cm, 'cm')]
  ];
  const registered = registeredEventNames(athlete);
  if (registered) rows.push(['events', registered]);
  nameEl.textContent = athlete.name || `Athlete #${index}`;
  listEl.innerHTML = rows.map(([label, value]) => (
    `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
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
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function overlapWarnings() {
  const draft = state.customDrawDraft;
  if (!draft || !draft.event_key) return [];
  const catalog = state.drawsState?.catalog || [];
  const conflicts = [];
  for (const idx of draft.athlete_indices || []) {
    const other = catalog.find((entry) =>
      String(entry.id) !== String(draft.id)
      && String(entry.event_key || '') === String(draft.event_key || '')
      && (entry.athlete_indices || []).map(Number).includes(Number(idx))
    );
    if (!other) continue;
    const athlete = (state.allEventAthletes || []).find((a) => Number(a.index) === Number(idx));
    conflicts.push(`${athlete?.name || `Athlete #${idx}`} is already in "${other.division_name}" (${eventName(draft.event_key)}).`);
  }
  return conflicts;
}

function updateWarning() {
  const warning = document.getElementById('customDivisionWarning');
  if (!warning) return;
  const lines = overlapWarnings();
  warning.hidden = lines.length === 0;
  warning.textContent = lines.length ? lines.slice(0, 3).join(' ') : '';
}

function syncClearButton() {
  const btn = document.getElementById('customDivisionClearBtn');
  if (btn) btn.disabled = selectedSet.size === 0;
}

async function clearSelectedAthletes() {
  if (!selectedSet.size) return;
  selectedSet = new Set();
  renderSourceList();
  await rebuildDraftPreview();
}

function fillEventOptions() {
  const select = document.getElementById('customDivisionEventKey');
  if (!select) return;
  const names = getPatternMeta()?.eventDisplayNames || {};
  const keys = Object.keys(names);
  select.innerHTML = ['<option value="">— select event/mode —</option>']
    .concat(keys.map((key) => `<option value="${key}">${eventName(key)}</option>`))
    .join('');
}

function drawTypeChoices(eventKey) {
  const allowed = ['Single Elimination', 'Round Robin', 'Premier League'];
  const breaking = (getPatternMeta()?.listDrawTypeEventKeys || []).includes(String(eventKey || ''));
  if (breaking) allowed.push('List');
  return allowed;
}

function syncDrawTypeSelect() {
  const select = document.getElementById('customDivisionDrawType');
  const eventKey = document.getElementById('customDivisionEventKey')?.value || '';
  if (!select) return;
  const options = drawTypeChoices(eventKey);
  const current = state.customDrawDraft?.division_type || '';
  select.innerHTML = options.map((opt) => `<option value="${opt}">${opt}</option>`).join('');
  const next = options.includes(current) ? current : options[0];
  select.value = next;
  if (state.customDrawDraft) state.customDrawDraft.division_type = next;
}

function fillRankFilterOptions() {
  const ranks = getPatternMeta()?.rankOrder || [];
  ['customFilterRankMin', 'customFilterRankMax'].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const keep = select.value;
    select.innerHTML = ['<option value="">any</option>']
      .concat(ranks.map((rank) => `<option value="${escapeHtml(rank)}">${escapeHtml(rank)}</option>`))
      .join('');
    if (keep && ranks.includes(keep)) select.value = keep;
  });
}

function resetAthleteFilters() {
  const maleBtn = document.getElementById('customFilterMaleBtn');
  const femaleBtn = document.getElementById('customFilterFemaleBtn');
  maleBtn?.classList.remove('is-active');
  femaleBtn?.classList.remove('is-active');
  if (maleBtn) maleBtn.setAttribute('aria-pressed', 'false');
  if (femaleBtn) femaleBtn.setAttribute('aria-pressed', 'false');
  [
    'customFilterRankMin',
    'customFilterRankMax',
    'customFilterAgeMin',
    'customFilterAgeMax',
    'customFilterHeightMin',
    'customFilterHeightMax',
    'customFilterWeightMin',
    'customFilterWeightMax',
    'customAthleteSearch'
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function readNum(id) {
  const raw = String(document.getElementById(id)?.value || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function athleteGenderKey(athlete) {
  const g = String(athlete?.gender || '').trim().toLowerCase();
  if (g === 'm' || g.startsWith('male')) return 'male';
  if (g === 'f' || g.startsWith('female')) return 'female';
  return '';
}

function rankIndexOf(rank) {
  const key = String(rank || '').trim().toLowerCase();
  if (!key) return null;
  const ranks = getPatternMeta()?.rankOrder || [];
  const idx = ranks.findIndex((r) => String(r).toLowerCase() === key);
  return idx >= 0 ? idx : null;
}

function inRange(value, min, max) {
  if (min == null && max == null) return true;
  if (value == null || value === '' || !Number.isFinite(Number(value))) return false;
  const n = Number(value);
  if (min != null && n < min) return false;
  if (max != null && n > max) return false;
  return true;
}

function athletePassesFilters(athlete) {
  const maleOn = document.getElementById('customFilterMaleBtn')?.classList.contains('is-active');
  const femaleOn = document.getElementById('customFilterFemaleBtn')?.classList.contains('is-active');
  if (maleOn || femaleOn) {
    const g = athleteGenderKey(athlete);
    if (!(maleOn && g === 'male') && !(femaleOn && g === 'female')) return false;
  }

  const rankMin = String(document.getElementById('customFilterRankMin')?.value || '').trim();
  const rankMax = String(document.getElementById('customFilterRankMax')?.value || '').trim();
  if (rankMin || rankMax) {
    const idx = rankIndexOf(athlete.rank);
    if (idx == null) return false;
    let lo = rankIndexOf(rankMin);
    let hi = rankIndexOf(rankMax);
    if (lo != null && hi != null && lo > hi) {
      const swap = lo;
      lo = hi;
      hi = swap;
    }
    if (lo != null && idx < lo) return false;
    if (hi != null && idx > hi) return false;
  }

  if (!inRange(athlete.age, readNum('customFilterAgeMin'), readNum('customFilterAgeMax'))) return false;
  if (!inRange(athlete.height_cm, readNum('customFilterHeightMin'), readNum('customFilterHeightMax'))) return false;
  if (!inRange(athlete.weight_kg, readNum('customFilterWeightMin'), readNum('customFilterWeightMax'))) return false;
  return true;
}

function renderSourceList() {
  const host = document.getElementById('customAthleteSourceList');
  const q = String(document.getElementById('customAthleteSearch')?.value || '').trim().toLowerCase();
  if (!host) return;
  const rows = (state.allEventAthletes || [])
    .filter((a) => athletePassesFilters(a))
    .filter((a) => !q || sourceHaystack(a).includes(q))
    .map((a) => {
      const idx = Number(a.index);
      const club = a.club || a.team || '';
      return `
      <button type="button" class="da-athlete-chip" data-athlete-index="${idx}">
        ${escapeHtml(a.name || `Athlete #${idx}`)}${club ? ` — ${escapeHtml(club)}` : ''}
      </button>`;
    });
  host.innerHTML = rows.join('') || '<p class="da-hint">no athletes match these filters.</p>';
}

function syncDraftName() {
  if (!state.customDrawDraft) return;
  state.customDrawDraft.division_name = String(
    document.getElementById('customDivisionName')?.value || ''
  ).trim();
}

async function rebuildDraftPreview() {
  if (!state.customDrawDraft) return;
  syncDraftName();
  const eventSelect = document.getElementById('customDivisionEventKey');
  const typeSelect = document.getElementById('customDivisionDrawType');
  state.customDrawDraft.event_key = String(eventSelect?.value || '').trim();
  state.customDrawDraft.division_type = String(typeSelect?.value || 'Single Elimination').trim();
  state.customDrawDraft.athlete_indices = [...selectedSet].sort((a, b) => a - b);
  if (!state.customDrawDraft.athlete_indices.length) {
    state.customDrawDraft.athletes = [];
    state.customDrawDraft.athlete_count = 0;
    state.customDrawDraft.json_data = null;
    state.customDrawDraft.body_text = '';
    await renderDrawPreviewPanels(state.customDrawDraft, {
      ...modalTargets,
      onEdited: (updatedEntry) => {
        state.customDrawDraft = { ...state.customDrawDraft, ...updatedEntry };
        return state.customDrawDraft;
      }
    });
    updateWarning();
    syncClearButton();
    return;
  }
  const eventId = state.eventId;
  const response = await apiFetch(`/api/division-advanced/events/${eventId}/draws/preview-entry`, {
    method: 'POST',
    body: JSON.stringify({
      entry: {
        id: state.customDrawDraft.id,
        division_name: state.customDrawDraft.division_name || `Custom Division ${Date.now()}`,
        division_type: state.customDrawDraft.division_type,
        event_key: state.customDrawDraft.event_key,
        athlete_indices: state.customDrawDraft.athlete_indices
      }
    })
  });
  state.customDrawDraft = {
    ...state.customDrawDraft,
    ...(response?.entry || {}),
    athlete_indices: [...selectedSet].sort((a, b) => a - b)
  };
  await renderDrawPreviewPanels(state.customDrawDraft, {
    ...modalTargets,
    onEdited: (updatedEntry, slots) => {
      state.customDrawDraft = {
        ...state.customDrawDraft,
        ...updatedEntry,
        _draw_slot_list: slots || updatedEntry?._draw_slot_list || []
      };
      return state.customDrawDraft;
    }
  });
  updateWarning();
  syncClearButton();
}

function closeModal() {
  hideAthleteDetails();
  const modal = modalEl();
  if (modal) modal.hidden = true;
  state.customDrawDraft = null;
  selectedSet = new Set();
}

async function resetDraftForNext() {
  const eventKey = document.getElementById('customDivisionEventKey')?.value || '';
  const drawType = document.getElementById('customDivisionDrawType')?.value || 'Single Elimination';
  selectedSet = new Set();
  state.customDrawSubtab = 'pool';
  state.customDrawDraft = {
    id: `custom_${Date.now()}`,
    division_name: '',
    division_type: drawType,
    event_key: eventKey,
    athlete_indices: [],
    athletes: [],
    athlete_count: 0,
    body_text: '',
    json_data: null
  };
  const nameInput = document.getElementById('customDivisionName');
  if (nameInput) nameInput.value = '';
  switchDrawSubtab('pool', modalTargets);
  renderSourceList();
  await rebuildDraftPreview();
}

async function openModal() {
  if (!state.eventId) {
    showToast('select an event first.', true);
    return;
  }
  await deps.ensureDrawsLoaded();
  if (loadedEventId !== String(state.eventId)) {
    const data = await apiFetch(`/api/division-advanced/events/${state.eventId}/athletes`);
    state.allEventAthletes = data.athletes || [];
    loadedEventId = String(state.eventId);
  }
  selectedSet = new Set();
  state.customDrawSubtab = 'pool';
  fillEventOptions();
  fillRankFilterOptions();
  resetAthleteFilters();
  state.customDrawDraft = {
    id: `custom_${Date.now()}`,
    division_name: '',
    division_type: 'Single Elimination',
    event_key: '',
    athlete_indices: [],
    athletes: [],
    athlete_count: 0,
    body_text: '',
    json_data: null
  };
  const modal = modalEl();
  if (modal) modal.hidden = false;
  const nameInput = document.getElementById('customDivisionName');
  if (nameInput) nameInput.value = '';
  const eventSelect = document.getElementById('customDivisionEventKey');
  if (eventSelect) eventSelect.value = '';
  syncDrawTypeSelect();
  setDrawEditorEntryResolver(() => state.customDrawDraft);
  switchDrawSubtab('pool', modalTargets);
  renderSourceList();
  await rebuildDraftPreview();
}

async function saveDraft() {
  syncDraftName();
  const draft = state.customDrawDraft;
  if (!draft) return;
  if (!draft.division_name) throw new Error('division name is required.');
  if (!draft.event_key) throw new Error('event/mode is required.');
  if (!draft.athlete_indices?.length) throw new Error('select at least one athlete.');
  const warnings = overlapWarnings();
  if (warnings.length) {
    const ok = await showConfirmModal({
      title: 'duplicate athlete warning',
      message: `${warnings[0]} Continue and save this custom division anyway?`,
      confirmLabel: 'save anyway',
      cancelLabel: 'cancel'
    });
    if (!ok) return;
  }
  if (!state.drawsState) state.drawsState = { format_version: 1, catalog: [] };
  const savedName = draft.division_name;
  state.drawsState.catalog = [...(state.drawsState.catalog || []), { ...draft }];
  await deps.regenerateDraws();
  showToast(`success - ${savedName} created`);
  await resetDraftForNext();
}

function bindModalEvents() {
  document.getElementById('daCustomDivisionCloseBtn')?.addEventListener('click', closeModal);
  modalEl()?.addEventListener('click', (e) => {
    if (e.target === modalEl()) closeModal();
  });
  document.getElementById('customAthleteSearch')?.addEventListener('input', renderSourceList);
  const filterHost = document.getElementById('customAthleteFilters');
  filterHost?.addEventListener('input', renderSourceList);
  filterHost?.addEventListener('change', renderSourceList);
  filterHost?.addEventListener('click', (e) => {
    const btn = e.target.closest('.da-custom-filter-btn');
    if (!btn) return;
    btn.classList.toggle('is-active');
    btn.setAttribute('aria-pressed', btn.classList.contains('is-active') ? 'true' : 'false');
    renderSourceList();
  });
  document.getElementById('customAthleteSourceList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-athlete-index]');
    if (!btn) return;
    hideAthleteDetails();
    const idx = Number(btn.getAttribute('data-athlete-index'));
    if (Number.isNaN(idx)) return;
    if (selectedSet.has(idx)) selectedSet.delete(idx);
    else selectedSet.add(idx);
    renderSourceList();
    await rebuildDraftPreview();
  });
  modalEl()?.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('[data-athlete-index]');
    if (!chip || !modalEl()?.contains(chip)) return;
    e.preventDefault();
    const idx = Number(chip.getAttribute('data-athlete-index'));
    if (Number.isNaN(idx)) return;
    showAthleteDetails(idx, e.clientX, e.clientY);
  });
  document.addEventListener('click', (e) => {
    const pop = detailsPop();
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target)) return;
    hideAthleteDetails();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideAthleteDetails();
  });
  document.getElementById('customDivisionEventKey')?.addEventListener('change', async () => {
    syncDrawTypeSelect();
    await rebuildDraftPreview();
  });
  document.getElementById('customDivisionDrawType')?.addEventListener('change', rebuildDraftPreview);
  document.getElementById('customDivisionName')?.addEventListener('input', syncDraftName);
  document.getElementById('customDivisionClearBtn')?.addEventListener('click', () => {
    clearSelectedAthletes().catch((err) => {
      showToast(err.message || 'unable to clear selected athletes.', true);
    });
  });
  document.querySelectorAll('#daCustomDivisionModal .da-subtab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      switchDrawSubtab(btn.dataset.subtab, modalTargets);
      await renderDrawPreviewPanels(state.customDrawDraft, {
        ...modalTargets,
        onEdited: (updatedEntry, slots) => {
          state.customDrawDraft = {
            ...state.customDrawDraft,
            ...updatedEntry,
            _draw_slot_list: slots || updatedEntry?._draw_slot_list || []
          };
          return state.customDrawDraft;
        }
      });
    });
  });
  document.getElementById('customDivisionSaveBtn')?.addEventListener('click', async () => {
    try {
      await saveDraft();
    } catch (err) {
      showToast(err.message || 'unable to save custom division.', true);
    }
  });
}

export function initCustomDivisionFeature(options = {}) {
  deps = {
    ...deps,
    ...options
  };
  bindModalEvents();
  document.querySelectorAll('.js-open-custom-divisions').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal().catch((err) => showToast(err.message || 'unable to open custom divisions.', true));
    });
  });
}
