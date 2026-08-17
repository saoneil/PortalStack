import { apiFetch } from './api.js';
import { state } from './state.js';
import { applyCombineToTarget } from './merge-division.js';
import {
  buildMoveTargetOptions,
  findLeafByDivisionId,
  MOVE_ALL_OTHERS_SEPARATOR
} from './move-targets.js';

let toastTimer = null;

export function showToast(message, isError = false) {
  const el = document.getElementById('daToast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle('error', isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

export function showConfirmModal({
  title = 'confirm',
  message = '',
  confirmLabel = 'confirm',
  cancelLabel = 'cancel',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('daConfirmModal');
    const titleEl = document.getElementById('daConfirmTitle');
    const messageEl = document.getElementById('daConfirmMessage');
    const okBtn = document.getElementById('daConfirmOkBtn');
    const cancelBtn = document.getElementById('daConfirmCancelBtn');
    if (!overlay || !okBtn || !cancelBtn) {
      resolve(false);
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    okBtn.classList.toggle('confirm-dialog-btn-danger', Boolean(danger));
    overlay.hidden = false;

    const cleanup = (result) => {
      overlay.hidden = true;
      okBtn.classList.remove('confirm-dialog-btn-danger');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlay = (e) => {
      if (e.target === overlay) cleanup(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
    okBtn.focus();
  });
}

/**
 * Modal text prompt. Resolves to trimmed string, or null if cancelled / empty.
 */
export function showPromptModal({
  title = 'enter a name',
  message = '',
  confirmLabel = 'save',
  cancelLabel = 'cancel',
  placeholder = '',
  defaultValue = ''
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('daPromptModal');
    const titleEl = document.getElementById('daPromptTitle');
    const messageEl = document.getElementById('daPromptMessage');
    const input = document.getElementById('daPromptInput');
    const okBtn = document.getElementById('daPromptOkBtn');
    const cancelBtn = document.getElementById('daPromptCancelBtn');
    if (!overlay || !okBtn || !cancelBtn || !input) {
      resolve(null);
      return;
    }

    titleEl.textContent = title;
    if (messageEl) {
      messageEl.textContent = message || '';
      messageEl.hidden = !message;
    }
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    input.value = defaultValue || '';
    input.placeholder = placeholder || '';
    overlay.hidden = false;

    const cleanup = (result) => {
      overlay.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      input.removeEventListener('keydown', onInputKey);
      resolve(result);
    };
    const submit = () => {
      const value = String(input.value || '').trim();
      cleanup(value || null);
    };
    const onOk = () => submit();
    const onCancel = () => cleanup(null);
    const onOverlay = (e) => {
      if (e.target === overlay) cleanup(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(null);
    };
    const onInputKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
    input.addEventListener('keydown', onInputKey);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.dataset.busy = busy ? '1' : '';
}

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

export function eventNickname(eventId = state.eventId) {
  const event = (state.events || []).find((e) => String(e.id) === String(eventId));
  return String(event?.event_name || '').trim() || (eventId ? `event_${eventId}` : '');
}

export function renderDivisionsTable() {
  const tbody = document.querySelector('#divisionsTable tbody');
  const summary = document.getElementById('divisionsSummary');
  if (!tbody) return;
  if (summary) summary.textContent = `${state.leaves.length} division leaves`;
  tbody.innerHTML = state.leaves.slice(0, 500).map((leaf, i) => `
    <tr data-index="${i}">
      <td>${leaf.enabled !== false ? '✓' : ''}</td>
      <td>${escapeHtml(leaf.division_name)}</td>
      <td>${escapeHtml(leaf.event_key)}</td>
      <td>${escapeHtml(leaf.draw_type)}</td>
      <td>${escapeHtml(leaf.gender)}</td>
      <td>${leaf.age_min ?? ''}${leaf.age_max != null ? '–' + leaf.age_max : ''}</td>
      <td>${escapeHtml(leaf.rank_min)}${leaf.rank_max ? '–' + escapeHtml(leaf.rank_max) : ''}</td>
    </tr>
  `).join('');
  if (state.leaves.length > 500) {
    tbody.innerHTML += `<tr><td colspan="7">… ${state.leaves.length - 500} more not shown</td></tr>`;
  }
}

function athleteLine(a) {
  const club = a.club || a.team || a.team_name_or_country || '';
  const bits = [a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim(), club]
    .filter(Boolean);
  return bits.join(' — ');
}

function updateMoveArrowEnabled() {
  const btn = document.getElementById('drawMoveArrowBtn');
  if (!btn) return;
  btn.disabled = !(
    state.selectedDrawId
    && state.selectedAthleteIndices.size > 0
    && state.targetGroupingId
  );
}

function renderDrawAthletes(entry) {
  const host = document.getElementById('drawAthletesList');
  if (!host) return;
  const athletes = entry?.athletes || [];
  if (!entry) {
    host.innerHTML = '<p class="da-hint">select a draw to view athletes.</p>';
    return;
  }
  if (!athletes.length) {
    host.innerHTML = '<p class="da-hint">no athletes in this draw.</p>';
    return;
  }
  host.innerHTML = athletes.map((a) => {
    const idx = a.index == null || a.index === '' ? null : Number(a.index);
    const selected = idx != null && state.selectedAthleteIndices.has(idx);
    return `
      <div class="da-athlete-chip ${selected ? 'selected' : ''}" data-index="${idx == null ? '' : idx}" role="button" tabindex="0">
        ${escapeHtml(athleteLine(a))}
      </div>
    `;
  }).join('');
}

function renderTargetAthletes() {
  const host = document.getElementById('drawTargetAthletesList');
  if (!host) return;
  const catalog = state.drawsState?.catalog || [];
  const targetId = state.targetGroupingId;
  if (!targetId) {
    host.innerHTML = '<p class="da-hint">select a destination draw to view its athletes.</p>';
    return;
  }
  const entry = catalog.find((e) => String(e.id) === String(targetId));
  if (!entry) {
    host.innerHTML = '<p class="da-hint">destination draw not found.</p>';
    return;
  }
  const athletes = entry.athletes || [];
  if (!athletes.length) {
    host.innerHTML = '<p class="da-hint">no athletes in this destination draw.</p>';
    return;
  }
  host.innerHTML = athletes.map((a) => `
    <div class="da-athlete-chip da-athlete-chip-readonly">
      ${escapeHtml(athleteLine(a))}
    </div>
  `).join('');
}

function populateDrawMoveTargets(sourceEntry) {
  const select = document.getElementById('drawMoveTargetSelect');
  if (!select) return;
  if (!sourceEntry) {
    select.innerHTML = '';
    state.targetGroupingId = '';
    renderTargetAthletes();
    updateMoveArrowEnabled();
    return;
  }

  const catalog = state.drawsState?.catalog || [];
  const leaves = state.leaves || [];
  const { options, suggestedCount } = buildMoveTargetOptions(sourceEntry, catalog, leaves);
  if (!options.length) {
    select.innerHTML = '';
    state.targetGroupingId = '';
    renderTargetAthletes();
    updateMoveArrowEnabled();
    return;
  }

  const previous = state.targetGroupingId;
  const parts = [];
  let insertedSeparator = false;
  options.forEach((opt) => {
    if (!opt.suggested && suggestedCount > 0 && !insertedSeparator) {
      parts.push(`<option disabled value="">${escapeHtml(MOVE_ALL_OTHERS_SEPARATOR)}</option>`);
      insertedSeparator = true;
    }
    parts.push(`<option value="${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</option>`);
  });
  select.innerHTML = parts.join('');
  const ids = options.map((o) => o.id);
  if (previous && ids.includes(previous)) {
    select.value = previous;
    state.targetGroupingId = previous;
  } else {
    // Default to top ★ recommendation (first option).
    state.targetGroupingId = ids[0] || '';
    if (state.targetGroupingId) select.value = state.targetGroupingId;
  }
  renderTargetAthletes();
  updateMoveArrowEnabled();
}

function updateSelectedDrawName(entry) {
  const el = document.getElementById('selectedDrawName');
  if (!el) return;
  const name = String(entry?.division_name || '').trim();
  if (!name) {
    el.textContent = '';
    el.hidden = true;
    el.removeAttribute('title');
    return;
  }
  el.textContent = name;
  el.title = name;
  el.hidden = false;
}

export function switchDrawSubtab(subtab) {
  if (subtab === 'edit' && typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
    subtab = 'pool';
  }
  state.drawSubtab = subtab;
  document.querySelectorAll('#tab-draws .da-subtab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.subtab === subtab);
  });
  document.querySelectorAll('#tab-draws .da-subpanel').forEach((panel) => {
    const active = panel.dataset.subpanel === subtab;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  const right = document.querySelector('#tab-draws .da-draws-right');
  right?.classList.toggle('da-draws-edit-mode', subtab === 'edit' || subtab === 'matches');
}

export async function renderDrawPreviewPanels(entry) {
  const { renderMatchesViewer } = await import('./matches-viewer.js');
  const dirtyHint = document.getElementById('drawDirtyHint');
  if (dirtyHint) dirtyHint.hidden = !state.drawDirty;

  if (state.drawSubtab === 'pdf') {
    state.drawSubtab = 'pool';
    switchDrawSubtab('pool');
  }

  updateSelectedDrawName(entry);
  renderDrawAthletes(entry);
  populateDrawMoveTargets(entry);
  updateMoveArrowEnabled();

  if (!entry) {
    renderMatchesViewer(null);
    try {
      const { renderInteractiveEditor } = await import('./draw-editor.js');
      renderInteractiveEditor(null);
    } catch (_) { /* ignore */ }
    return;
  }

  if (state.drawSubtab === 'matches') {
    renderMatchesViewer(entry);
  }
  if (state.drawSubtab === 'edit') {
    const {
      renderInteractiveEditor,
      loadSlotsForEntry,
      setDrawEditorCallback,
      applyEditedEntryToState
    } = await import('./draw-editor.js');
    setDrawEditorCallback((updatedEntry, slots) => {
      const next = applyEditedEntryToState(updatedEntry, slots);
      if (dirtyHint) dirtyHint.hidden = !state.drawDirty;
      renderInteractiveEditor(next || updatedEntry, slots);
    });
    try {
      const data = await loadSlotsForEntry(entry);
      if (data?.entry) {
        entry._draw_slot_list = data.slots || [];
        if (data.entry.body_text) entry.body_text = data.entry.body_text;
        if (data.entry.json_data) entry.json_data = data.entry.json_data;
      }
      renderInteractiveEditor(entry, data?.slots || entry._draw_slot_list || []);
    } catch (err) {
      showToast(err.message || 'unable to load draw editor.', true);
      renderInteractiveEditor(entry, entry._draw_slot_list || []);
    }
  }
}

export function renderDraws() {
  const catalog = state.drawsState?.catalog || [];
  const tbody = document.querySelector('#drawsTable tbody');
  const withAthletes = catalog.filter(
    (e) => (e.athlete_count || 0) > 0 || (e.athlete_indices || []).length > 0
  );
  const visible = state.filterDrawsToSolo
    ? withAthletes.filter((e) => drawAthleteCount(e) === 1)
    : withAthletes;
  const saveDrawsBtn = document.getElementById('saveDrawsBtn');
  if (saveDrawsBtn) {
    saveDrawsBtn.disabled = !catalog.length || !state.drawDirty;
  }
  const athletesHeader = document.getElementById('drawsAthletesHeader');
  if (athletesHeader) {
    athletesHeader.classList.toggle('da-th-filtered', Boolean(state.filterDrawsToSolo));
    athletesHeader.title = state.filterDrawsToSolo
      ? 'showing solos only — right-click to clear'
      : 'right-click to filter';
  }
  if (tbody) {
    tbody.innerHTML = visible.map((entry) => {
      const athleteCount = entry.athlete_count != null
        ? Number(entry.athlete_count)
        : (entry.athlete_indices || []).length;
      return `
      <tr data-id="${escapeHtml(entry.id)}" class="${entry.id === state.selectedDrawId ? 'selected' : ''}">
        <td>${escapeHtml(entry.division_name)}</td>
        <td>${escapeHtml(entry.division_type)}</td>
        <td>${athleteCount || 0}</td>
      </tr>
    `;
    }).join('');
  }
  const selected = catalog.find((e) => e.id === state.selectedDrawId);
  if (!selected && state.selectedDrawId) {
    state.selectedDrawId = '';
    state.selectedAthleteIndices = new Set();
  } else if (
    selected
    && state.filterDrawsToSolo
    && drawAthleteCount(selected) !== 1
  ) {
    state.selectedDrawId = '';
    state.selectedAthleteIndices = new Set();
  }
  const selectedVisible = catalog.find((e) => e.id === state.selectedDrawId) || null;
  renderDrawPreviewPanels(selectedVisible).catch(() => {});
}

/**
 * Move athletes from one draw into another (client-only until save/regenerate).
 */
export function moveAthletesBetweenDrawsLocally(fromId, toId, indices) {
  const catalog = state.drawsState?.catalog || [];
  const from = catalog.find((e) => String(e.id) === String(fromId));
  const to = catalog.find((e) => String(e.id) === String(toId));
  if (!from || !to) throw new Error('select source and target draws.');
  if (String(from.id) === String(to.id)) throw new Error('pick a different target draw.');
  const list = [...indices].map(Number).filter((n) => Number.isFinite(n));
  if (!list.length) throw new Error('select one or more athletes.');

  const movingSet = new Set(list);
  const fromIndices = (from.athlete_indices || []).map(Number);
  const missing = list.filter((i) => !fromIndices.includes(i));
  if (missing.length) throw new Error('selected athlete is not in this draw.');

  const leaves = state.leaves || [];
  const sourceLeaf = findLeafByDivisionId(leaves, from.id);
  const targetLeaf = findLeafByDivisionId(leaves, to.id);
  const sourceAthletesBefore = [...(from.athletes || [])];
  const targetAthletesBefore = [...(to.athletes || [])];

  const movingAthletes = (from.athletes || []).filter((a) => movingSet.has(Number(a.index)));
  from.athlete_indices = fromIndices.filter((i) => !movingSet.has(i));
  from.athletes = (from.athletes || []).filter((a) => !movingSet.has(Number(a.index)));
  from.athlete_count = from.athlete_indices.length;

  const toIndices = (to.athlete_indices || []).map(Number);
  list.forEach((i) => {
    if (!toIndices.includes(i)) toIndices.push(i);
  });
  to.athlete_indices = toIndices;
  const existing = new Set((to.athletes || []).map((a) => Number(a.index)));
  if (!Array.isArray(to.athletes)) to.athletes = [];
  movingAthletes.forEach((a) => {
    if (!existing.has(Number(a.index))) to.athletes.push(a);
  });
  to.athlete_count = to.athlete_indices.length;

  applyCombineToTarget({
    sourceEntry: from,
    targetEntry: to,
    sourceLeaf,
    targetLeaf,
    sourceAthletes: sourceAthletesBefore,
    targetAthletes: targetAthletesBefore
  });

  from.preserve_structure = false;
  to.preserve_structure = false;
  delete from._draw_slot_list;
  delete to._draw_slot_list;

  state.drawDirty = true;
  return { from, to };
}

/**
 * Move selected athletes from source draw into target draw (client-only until save).
 */
export function moveSelectedAthletesLocally() {
  const moved = moveAthletesBetweenDrawsLocally(
    state.selectedDrawId,
    state.targetGroupingId,
    [...state.selectedAthleteIndices]
  );
  state.selectedAthleteIndices = new Set();
  if (moved.from.athlete_count === 0) {
    state.selectedDrawId = moved.to.id;
  }
}

function drawAthleteCount(entry) {
  if (!entry) return 0;
  if (entry.athlete_count != null) return Number(entry.athlete_count) || 0;
  return (entry.athlete_indices || []).length;
}

export function countSoloDivisions(catalog = state.drawsState?.catalog) {
  return (catalog || []).filter((entry) => drawAthleteCount(entry) === 1).length;
}

/**
 * Merge every 1-athlete draw into its top ★ recommendation (or next non-empty peer).
 * Mutates state.drawsState.catalog in place.
 * @returns {{ merged: number, remaining: number }}
 */
export function combineSoloDivisionsLocally() {
  const catalog = state.drawsState?.catalog;
  if (!Array.isArray(catalog) || !catalog.length) {
    throw new Error('no draws available.');
  }
  const leaves = state.leaves || [];
  let merged = 0;
  const maxPasses = catalog.length + 2;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const solos = catalog.filter((entry) => drawAthleteCount(entry) === 1);
    if (!solos.length) break;
    let progress = false;

    for (const solo of solos) {
      if (drawAthleteCount(solo) !== 1) continue;
      const { options } = buildMoveTargetOptions(solo, catalog, leaves);
      const targetOpt = options.find((opt) => {
        const target = catalog.find((e) => String(e.id) === String(opt.id));
        return target && drawAthleteCount(target) >= 1;
      });
      if (!targetOpt) continue;

      const indices = (solo.athlete_indices || []).map(Number).filter((n) => Number.isFinite(n));
      if (!indices.length) continue;

      moveAthletesBetweenDrawsLocally(solo.id, targetOpt.id, indices);
      merged += 1;
      progress = true;
    }

    if (!progress) break;
  }

  state.drawsState.catalog = catalog.filter((entry) => drawAthleteCount(entry) > 0);
  const remaining = state.drawsState.catalog.filter((entry) => drawAthleteCount(entry) === 1).length;
  return { merged, remaining };
}

function sortEventsByScheduleDate(events) {
  return (Array.isArray(events) ? events.slice() : []).sort((a, b) => {
    const aTime = a?.event_date_start ? new Date(a.event_date_start).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b?.event_date_start ? new Date(b.event_date_start).getTime() : Number.POSITIVE_INFINITY;
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);
    if (aValid && bValid && aTime !== bTime) return aTime - bTime;
    if (aValid !== bValid) return aValid ? -1 : 1;
    return String(a?.event_name || '').localeCompare(String(b?.event_name || ''));
  });
}

export async function loadEvents() {
  // Prefer events already loaded by the classic boot script (same as Event Management).
  if (Array.isArray(window.__daClientEvents) && window.__daClientEvents.length) {
    state.events = sortEventsByScheduleDate(window.__daClientEvents);
  } else {
    // Same fetch path as Event Management (`loadClientEvents` in landing.html).
    const res = await fetch('/api/client-events', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Unable to load your events. Please try again.');
    const events = (await res.json()) || [];
    state.events = sortEventsByScheduleDate(Array.isArray(events) ? events : []);
  }
  window.__daClientEvents = state.events;

  const select = document.getElementById('eventSelect');
  if (!select) return state.events;

  select.innerHTML = '<option value="">— select an event —</option>';
  state.events.forEach((event) => {
    const option = document.createElement('option');
    option.value = event.id;
    const startDate = event.event_date_start
      ? new Date(event.event_date_start).toLocaleDateString()
      : '';
    option.textContent = startDate
      ? `${event.event_name} (${startDate})`
      : String(event.event_name || '');
    select.appendChild(option);
  });

  if (state.eventId && [...select.options].some((o) => o.value === String(state.eventId))) {
    select.value = String(state.eventId);
  }
  return state.events;
}

export function closeTemplatePicker() {
  const menu = document.getElementById('wheelTemplateMenu');
  const toggle = document.getElementById('wheelTemplateToggle');
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

export function openTemplatePicker() {
  const menu = document.getElementById('wheelTemplateMenu');
  const toggle = document.getElementById('wheelTemplateToggle');
  if (!menu || !toggle) return;
  menu.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
}

export function toggleTemplatePicker() {
  const menu = document.getElementById('wheelTemplateMenu');
  if (!menu) return;
  if (menu.hidden) openTemplatePicker();
  else closeTemplatePicker();
}

export async function loadTemplates() {
  state.templates = await apiFetch('/api/division-advanced/divisions/templates');
  const menu = document.getElementById('wheelTemplateMenu');
  if (!menu) return;

  const templates = state.templates || [];
  if (!templates.length) {
    menu.innerHTML = '<li class="da-template-empty" role="presentation">no templates saved</li>';
    return;
  }

  menu.innerHTML = templates.map((t) => `
    <li role="option" tabindex="-1" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(t.nickname)}">
      ${escapeHtml(t.nickname)} (${Number(t.leaf_count) || 0})
    </li>
  `).join('');
}

export async function deleteDivisionTemplate(templateId) {
  const id = String(templateId || '').trim();
  if (!id) throw new Error('template id is required.');
  await apiFetch(`/api/division-advanced/divisions/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  await loadTemplates();
}

export async function loadCreationStatus() {
  if (!state.eventId) {
    state.creationStatus = null;
    return null;
  }
  const status = await apiFetch(`/api/division-advanced/events/${state.eventId}/creation-status`);
  state.creationStatus = status;
  return status;
}

export async function loadEventTemplateLeaves() {
  if (!state.eventId) return [];
  const data = await apiFetch(`/api/division-advanced/events/${state.eventId}/divisions`);
  state.leaves = data.leaves || [];
  return state.leaves;
}

export async function saveDivisionsForEvent(leaves = state.leaves) {
  if (!Array.isArray(leaves) || !leaves.length) {
    throw new Error('no divisions to save.');
  }
  if (!state.eventId) throw new Error('select an event first.');
  await apiFetch(`/api/division-advanced/events/${state.eventId}/divisions`, {
    method: 'POST',
    body: JSON.stringify({ leaves })
  });
  return leaves.length;
}

export async function saveNamedDivisionTemplate(nickname, leaves = state.leaves) {
  const name = String(nickname || '').trim();
  if (!name) throw new Error('template name is required.');
  if (!Array.isArray(leaves) || !leaves.length) {
    throw new Error('no divisions to save.');
  }
  await loadTemplates();
  const existing = (state.templates || []).find(
    (t) => String(t.nickname || '').trim().toLowerCase() === name.toLowerCase()
  );
  await apiFetch('/api/division-advanced/divisions/templates', {
    method: 'POST',
    body: JSON.stringify({
      nickname: name,
      leaves,
      overwriteId: existing?.id || null
    })
  });
  await loadTemplates();
  return name;
}

export async function loadSavedForEvent() {
  if (!state.eventId) return;
  state.drawsState = null;
  state.leaves = [];
  try {
    const d = await apiFetch(`/api/division-advanced/events/${state.eventId}/draws`);
    state.drawsState = d.state || null;
  } catch (_) { /* ignore */ }
  try {
    await loadEventTemplateLeaves();
  } catch (_) { /* ignore */ }
  renderDivisionsTable();
  renderDraws();
}
