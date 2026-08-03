import { apiFetch } from './api.js';
import { state, requireEvent } from './state.js';
import { buildMoveTargetOptions, MOVE_ALL_OTHERS_SEPARATOR } from './move-targets.js';

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
  cancelLabel = 'cancel'
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
    overlay.hidden = false;

    const cleanup = (result) => {
      overlay.hidden = true;
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

export function renderDivisionsTable() {
  const tbody = document.querySelector('#divisionsTable tbody');
  const summary = document.getElementById('divisionsSummary');
  if (!tbody) return;
  summary.textContent = `${state.leaves.length} division leaves`;
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

export function renderAthletesTable() {
  const tbody = document.querySelector('#athletesTable tbody');
  const summary = document.getElementById('athletesSummary');
  const q = state.athleteFilter.trim().toLowerCase();
  const filtered = state.athletes.filter((a) => {
    if (!q) return true;
    const hay = [
      a.first_name, a.last_name, a.rank, a.gender,
      a.team_name_or_country, a._index
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
  summary.textContent = filtered.length
    ? `${filtered.length} athlete(s)${q ? ' (filtered)' : ''}`
    : 'no athletes loaded';
  tbody.innerHTML = filtered.slice(0, 300).map((a) => `
    <tr>
      <td>${escapeHtml(`${a.first_name} ${a.last_name}`.trim())}</td>
      <td>${formatDate(a.dob)}</td>
      <td>${escapeHtml(a.rank)}</td>
      <td>${escapeHtml(a.gender)}</td>
      <td>${a.weight_kg ?? ''}</td>
      <td>${a.height_cm ?? ''}</td>
      <td>${escapeHtml(a.team_name_or_country)}</td>
    </tr>
  `).join('');
}

function athleteLine(a) {
  const club = a.club || a.team || a.team_name_or_country || '';
  const bits = [a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim(), a.rank, club]
    .filter(Boolean);
  return bits.join(' — ');
}

function filteredGroupingsCatalog(catalog) {
  let list = (catalog || []).filter((e) => Number(e.athlete_count || 0) > 0);
  const nameQ = String(state.groupingFilter || '').trim().toLowerCase();
  const athleteQ = String(state.groupingAthleteFilter || '').trim().toLowerCase();
  const eventQ = String(state.groupingEventFilter || '').trim();
  const typeQ = String(state.groupingTypeFilter || '').trim();

  if (nameQ) {
    list = list.filter((e) => String(e.division_name || e.id || '').toLowerCase().includes(nameQ));
  }
  if (athleteQ) {
    list = list.filter((e) => (e.athletes || []).some((a) =>
      athleteLine(a).toLowerCase().includes(athleteQ)
    ));
  }
  if (eventQ) {
    list = list.filter((e) => String(e.event_key || '') === eventQ);
  }
  if (typeQ) {
    list = list.filter((e) => String(e.division_type || '') === typeQ);
  }

  const sort = state.groupingSort || 'name';
  list = [...list].sort((a, b) => {
    if (sort === 'athletes-desc') return (b.athlete_count || 0) - (a.athlete_count || 0);
    if (sort === 'athletes-asc') return (a.athlete_count || 0) - (b.athlete_count || 0);
    if (sort === 'type') {
      return String(a.division_type || '').localeCompare(String(b.division_type || ''))
        || String(a.division_name || '').localeCompare(String(b.division_name || ''));
    }
    return String(a.division_name || '').localeCompare(String(b.division_name || ''));
  });
  return list;
}

function populateGroupingsEventFilter(catalog) {
  const select = document.getElementById('groupingsEventFilter');
  if (!select) return;
  const previous = select.value || state.groupingEventFilter || '';
  const keys = [...new Set((catalog || []).map((e) => e.event_key).filter(Boolean))].sort();
  select.innerHTML = '<option value="">all events</option>' +
    keys.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(key.replace(/_/g, ' '))}</option>`).join('');
  if (previous && [...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }
}

function renderAthleteList(hostId, athletes, { selectable = false } = {}) {
  const host = document.getElementById(hostId);
  if (!host) return;
  if (!athletes?.length) {
    host.innerHTML = '<p class="da-hint">no athletes in this division.</p>';
    return;
  }
  host.innerHTML = athletes.map((a, i) => {
    const idx = a.index != null ? a.index : i;
    const selected = selectable && state.selectedAthleteIndex === idx;
    return `
    <div class="da-athlete-chip ${selected ? 'selected' : ''}"
         ${selectable ? `data-index="${idx}"` : ''}>
      ${escapeHtml(athleteLine(a))}
    </div>
  `;
  }).join('');
}

function renderSourcePane(entry) {
  const meta = document.getElementById('groupingsSourceMeta');
  if (!entry) {
    if (meta) meta.textContent = 'select a division';
    renderAthleteList('groupingsSourceAthletes', [], { selectable: true });
    document.getElementById('groupingsSourceAthletes').innerHTML =
      '<p class="da-hint">select a division to view athletes.</p>';
    return;
  }
  if (meta) {
    meta.textContent = `${entry.event_key || '—'} · ${entry.division_type || '—'} · ${entry.athlete_count || 0} athletes`;
  }
  const title = document.querySelector('#groupingsSourcePane h3');
  if (title) title.textContent = entry.division_name || 'source division';
  renderAthleteList('groupingsSourceAthletes', entry.athletes || [], { selectable: true });
}

function renderTargetPane(entry) {
  const meta = document.getElementById('groupingsTargetMeta');
  const title = document.querySelector('#groupingsTargetPane h3');
  if (!entry) {
    if (meta) meta.textContent = '—';
    if (title) title.textContent = 'target division';
    document.getElementById('groupingsTargetAthletes').innerHTML =
      '<p class="da-hint">choose a target division above.</p>';
    return;
  }
  if (meta) {
    meta.textContent = `${entry.event_key || '—'} · ${entry.division_type || '—'} · ${entry.athlete_count || 0} athletes`;
  }
  if (title) title.textContent = entry.division_name || 'target division';
  renderAthleteList('groupingsTargetAthletes', entry.athletes || [], { selectable: false });
}

function populateMoveTargets(sourceEntry) {
  const select = document.getElementById('moveTargetSelect');
  const moveBar = document.getElementById('moveBar');
  if (!select || !moveBar) return;
  if (!sourceEntry) {
    moveBar.hidden = true;
    select.innerHTML = '';
    state.targetGroupingId = '';
    renderTargetPane(null);
    return;
  }

  const catalog = state.groupingsState?.catalog || [];
  const leaves = state.groupingsState?.leaves || state.leaves || [];
  const { options, suggestedCount } = buildMoveTargetOptions(sourceEntry, catalog, leaves);

  if (!options.length) {
    moveBar.hidden = true;
    select.innerHTML = '';
    state.targetGroupingId = '';
    renderTargetPane(null);
    return;
  }

  moveBar.hidden = false;
  const previous = state.targetGroupingId;
  const parts = [];
  let insertedSeparator = false;
  options.forEach((opt) => {
    if (!opt.suggested && suggestedCount > 0 && !insertedSeparator) {
      parts.push(
        `<option disabled value="">${escapeHtml(MOVE_ALL_OTHERS_SEPARATOR)}</option>`
      );
      insertedSeparator = true;
    }
    parts.push(
      `<option value="${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</option>`
    );
  });
  select.innerHTML = parts.join('');

  const ids = options.map((o) => o.id);
  if (previous && ids.includes(previous)) {
    select.value = previous;
    state.targetGroupingId = previous;
  } else {
    state.targetGroupingId = select.value || ids[0] || '';
    if (state.targetGroupingId) select.value = state.targetGroupingId;
  }
  const target = catalog.find((e) => e.id === state.targetGroupingId) || null;
  renderTargetPane(target);
}

export function renderGroupings() {
  const catalog = state.groupingsState?.catalog || [];
  const nonEmpty = catalog.filter((e) => Number(e.athlete_count || 0) > 0);
  populateGroupingsEventFilter(catalog);
  const filtered = filteredGroupingsCatalog(catalog);
  const tbody = document.querySelector('#groupingsTable tbody');
  const summary = document.getElementById('groupingsSummary');
  if (summary) {
    summary.textContent = catalog.length
      ? `${filtered.length} listed · ${nonEmpty.length} with athletes (${catalog.length - nonEmpty.length} empty hidden)`
      : 'no groupings';
  }
  if (tbody) {
    tbody.innerHTML = filtered.map((entry) => `
      <tr data-id="${escapeHtml(entry.id)}" class="${entry.id === state.selectedGroupingId ? 'selected' : ''}">
        <td>${escapeHtml(entry.division_name)}</td>
        <td>${escapeHtml(entry.division_type)}</td>
        <td>${entry.athlete_count || 0}</td>
      </tr>
    `).join('');
  }

  const source = catalog.find((e) => e.id === state.selectedGroupingId) || null;
  if (state.selectedGroupingId && !source) {
    state.selectedGroupingId = '';
    state.selectedAthleteIndex = null;
    state.targetGroupingId = '';
  }
  renderSourcePane(catalog.find((e) => e.id === state.selectedGroupingId) || null);
  populateMoveTargets(catalog.find((e) => e.id === state.selectedGroupingId) || null);

  const moveBtn = document.getElementById('moveAthleteBtn');
  if (moveBtn) {
    moveBtn.disabled = !state.selectedGroupingId || state.selectedAthleteIndex == null || !state.targetGroupingId;
  }
  const saveGroupingsBtn = document.getElementById('saveGroupingsBtn');
  if (saveGroupingsBtn) saveGroupingsBtn.disabled = !catalog.length;
}

function updateDrawSaveButtons() {
  const saveBtn = document.getElementById('saveDrawBtn');
  const revertBtn = document.getElementById('revertDrawBtn');
  const dirty = Boolean(state.drawDirty);
  if (saveBtn) saveBtn.disabled = !dirty;
  if (revertBtn) revertBtn.disabled = !dirty;
}

function populateDrawInfo(entry) {
  document.getElementById('drawInfoName').textContent = entry?.division_name || '—';
  document.getElementById('drawInfoType').textContent = entry?.division_type || '—';
  document.getElementById('drawInfoEvent').textContent = entry?.event_key || '—';
  document.getElementById('drawInfoAthletes').textContent =
    entry ? String(entry.athlete_count ?? '') : '—';
}

export function switchDrawSubtab(subtab) {
  state.drawSubtab = subtab;
  document.querySelectorAll('.da-subtab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.subtab === subtab);
  });
  document.querySelectorAll('.da-subpanel').forEach((panel) => {
    const active = panel.dataset.subpanel === subtab;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
}

export async function renderDrawPreviewPanels(entry) {
  const { renderInteractiveEditor, loadPdfPreview, loadSlotsForEntry } = await import('./draw-editor.js');
  const preview = document.getElementById('drawPreview');
  if (preview) {
    preview.textContent = entry?.body_text || 'select a division to preview plain-text draw.';
  }
  populateDrawInfo(entry);
  updateDrawSaveButtons();

  if (!entry) {
    state.drawSlots = [];
    renderInteractiveEditor(null, []);
    try { await loadPdfPreview(null); } catch (_) { /* ignore */ }
    return;
  }

  try {
    if (!state.drawSlots.length || !state.drawDirty) {
      const refreshed = await loadSlotsForEntry(entry);
      if (refreshed?.entry) {
        Object.assign(entry, {
          body_text: refreshed.entry.body_text,
          json_data: refreshed.entry.json_data,
          division_type: refreshed.entry.division_type
        });
        state.drawSlots = refreshed.slots || [];
        if (preview) preview.textContent = entry.body_text || '';
      }
    }
  } catch (_) {
    state.drawSlots = entry._draw_slot_list || [];
  }

  renderInteractiveEditor(entry, state.drawSlots);

  if (state.drawSubtab === 'pdf') {
    try {
      await loadPdfPreview(entry);
    } catch (err) {
      showToast(err.message || 'PDF preview failed', true);
    }
  }
}

export function renderDraws() {
  const catalog = state.drawsState?.catalog || [];
  const tbody = document.querySelector('#drawsTable tbody');
  const summary = document.getElementById('drawsSummary');
  const downloadBtn = document.getElementById('downloadZipBtn');
  const withAthletes = catalog.filter((e) => (e.athlete_count || 0) > 0);
  const stale = state.drawsState?.groupings_out_of_sync;
  const groupingsCount = (state.groupingsState?.catalog || []).length;
  const oneToOne = !groupingsCount || catalog.length === groupingsCount;
  summary.textContent = catalog.length
    ? `${withAthletes.length} draw(s) with athletes (${catalog.length - withAthletes.length} empty hidden)` +
      `${oneToOne ? ' · 1:1 with groupings' : ' · out of sync with groupings count'}` +
      `${stale ? ' — groupings changed, regenerate recommended' : ''}`
    : 'no draws';
  const showZip = withAthletes.length > 0;
  if (downloadBtn) downloadBtn.hidden = !showZip;
  const saveDrawsBtn = document.getElementById('saveDrawsBtn');
  if (saveDrawsBtn) saveDrawsBtn.disabled = !catalog.length;
  tbody.innerHTML = withAthletes.map((entry) => `
    <tr data-id="${escapeHtml(entry.id)}" class="${entry.id === state.selectedDrawId ? 'selected' : ''}">
      <td>${escapeHtml(entry.division_name)}</td>
      <td>${escapeHtml(entry.division_type)}</td>
      <td>${entry.athlete_count || 0}</td>
    </tr>
  `).join('');
  const selected = catalog.find((e) => e.id === state.selectedDrawId);
  renderDrawPreviewPanels(selected).catch(() => {});
}

export async function loadEvents() {
  const events = await apiFetch('/api/division-advanced/events');
  state.events = events;
  const options = '<option value="">— select an event —</option>' +
    events.map((e) => {
      const label = `${e.event_name} (${formatDate(e.event_date_start)})`;
      return `<option value="${e.id}">${escapeHtml(label)}</option>`;
    }).join('');
  document.querySelectorAll('.da-event-select').forEach((select) => {
    const previous = select.value || state.eventId || '';
    select.innerHTML = options;
    if (previous && [...select.options].some((o) => o.value === previous)) {
      select.value = previous;
    }
  });
}

export function syncEventSelects(eventId) {
  const value = eventId || '';
  document.querySelectorAll('.da-event-select').forEach((select) => {
    if (select.value !== value) select.value = value;
  });
  const statusText = value ? 'event selected' : '';
  [
    'eventStatus',
    'athletesEventStatus',
    'groupingsEventStatus',
    'drawsEventStatus',
    'scheduleEventStatus'
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = statusText;
  });
}

export async function loadTemplates() {
  state.templates = await apiFetch('/api/division-advanced/divisions/templates');
  const select = document.getElementById('templateSelect');
  select.innerHTML = '<option value="">— template —</option>' +
    state.templates.map((t) =>
      `<option value="${t.id}">${escapeHtml(t.nickname)} (${t.leaf_count})</option>`
    ).join('');
}

export { renderSchedule } from './schedule-panel.js';

export async function loadSavedForEvent() {
  if (!state.eventId) return;
  try {
    const g = await apiFetch(`/api/division-advanced/events/${state.eventId}/groupings`);
    state.groupingsState = g.state || null;
    if (state.groupingsState?.leaves) state.leaves = state.groupingsState.leaves;
  } catch (_) { /* ignore */ }
  try {
    const d = await apiFetch(`/api/division-advanced/events/${state.eventId}/draws`);
    state.drawsState = d.state || null;
  } catch (_) { /* ignore */ }
  try {
    const s = await apiFetch(`/api/division-advanced/events/${state.eventId}/schedule`);
    state.scheduleState = s.state || null;
  } catch (_) {
    state.scheduleState = null;
  }
  renderDivisionsTable();
  renderGroupings();
  renderDraws();
  renderSchedule();
}

