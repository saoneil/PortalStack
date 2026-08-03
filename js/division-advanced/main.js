import { apiFetch, logInteraction } from './api.js';
import { state, requireEvent, selectedDrawEntry } from './state.js';
import {
  showToast, showConfirmModal, setBusy, renderDivisionsTable, renderAthletesTable,
  renderGroupings, renderDraws, renderSchedule, loadEvents, loadTemplates, loadSavedForEvent,
  switchDrawSubtab, syncEventSelects
} from './ui.js';
import {
  setDrawEditorCallback, loadPdfPreview
} from './draw-editor.js';
import {
  initPatternForm, bindPatternForm, collectPatternFormPayload
} from './pattern-form.js';
import { bindSchedulePanel } from './schedule-panel.js';

function switchTab(tabId) {
  document.querySelectorAll('.da-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.da-panel').forEach((panel) => {
    const active = panel.dataset.panel === tabId;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
}

function clearDivisions({ silent = false } = {}) {
  state.leaves = [];
  renderDivisionsTable();
  if (!silent) showToast('divisions cleared.');
}

function clearAthletes({ silent = false } = {}) {
  state.athletes = [];
  state.athleteFilter = '';
  const search = document.getElementById('athleteSearch');
  if (search) search.value = '';
  renderAthletesTable();
  if (!silent) showToast('athletes cleared.');
}

function clearGroupings({ silent = false } = {}) {
  state.groupingsState = null;
  state.selectedGroupingId = '';
  state.targetGroupingId = '';
  state.selectedAthleteIndex = null;
  state.groupingFilter = '';
  state.groupingAthleteFilter = '';
  state.groupingEventFilter = '';
  state.groupingTypeFilter = '';
  state.groupingSort = 'name';
  const search = document.getElementById('groupingsSearch');
  const athleteSearch = document.getElementById('groupingsAthleteSearch');
  const eventFilter = document.getElementById('groupingsEventFilter');
  const typeFilter = document.getElementById('groupingsTypeFilter');
  const sortSelect = document.getElementById('groupingsSort');
  if (search) search.value = '';
  if (athleteSearch) athleteSearch.value = '';
  if (eventFilter) eventFilter.value = '';
  if (typeFilter) typeFilter.value = '';
  if (sortSelect) sortSelect.value = 'name';
  if (state.drawsState) state.drawsState.groupings_out_of_sync = true;
  renderGroupings();
  if (!silent) showToast('groupings cleared.');
}

function clearDraws({ silent = false } = {}) {
  state.drawsState = null;
  state.selectedDrawId = '';
  state.drawSlots = [];
  state.drawDirty = false;
  state.drawSnapshot = null;
  renderDraws();
  if (!silent) showToast('draws cleared.');
}

function clearSchedule({ silent = false } = {}) {
  state.scheduleState = null;
  state.scheduleSelectedIds = new Set();
  renderSchedule();
  if (!silent) showToast('schedule cleared.');
}

async function clearAllTabs() {
  const ok = await showConfirmModal({
    title: 'clear all tabs',
    message: 'clear divisions, athletes, groupings, draws, and schedule from this session?',
    confirmLabel: 'clear all'
  });
  if (!ok) return;
  clearDivisions({ silent: true });
  clearAthletes({ silent: true });
  clearGroupings({ silent: true });
  clearDraws({ silent: true });
  clearSchedule({ silent: true });
  const result = document.getElementById('workflowResult');
  if (result) result.hidden = true;
  refreshWorkflowFocus();
  showToast('all tabs cleared.');
}

function snapshotEntry(entry) {
  if (!entry) return null;
  return JSON.parse(JSON.stringify({
    body_text: entry.body_text,
    json_data: entry.json_data,
    division_type: entry.division_type
  }));
}

function applyEditedEntry(updatedEntry, slots, markDirty) {
  const catalog = state.drawsState?.catalog || [];
  const idx = catalog.findIndex((e) => e.id === updatedEntry.id);
  if (idx < 0) return;
  if (!state.drawDirty && markDirty) {
    state.drawSnapshot = snapshotEntry(catalog[idx]);
  }
  Object.assign(catalog[idx], {
    body_text: updatedEntry.body_text,
    json_data: updatedEntry.json_data,
    division_type: updatedEntry.division_type,
    athlete_count: updatedEntry.athlete_count ?? catalog[idx].athlete_count
  });
  state.drawSlots = slots || [];
  if (markDirty) state.drawDirty = true;
  renderDraws();
}

async function applyProfile(profile) {
  const principleUserAdvanced = Number(profile?.principleUserAdvanced) === 1;
  if (!principleUserAdvanced) {
    window.location.href = '/landing';
    return false;
  }
  return true;
}

function bindTabs() {
  document.querySelectorAll('.da-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function bindEventSelect() {
  document.querySelectorAll('.da-event-select').forEach((select) => {
    select.addEventListener('change', async (e) => {
      state.eventId = e.target.value;
      syncEventSelects(state.eventId);
      state.groupingsState = null;
      state.drawsState = null;
      state.scheduleState = null;
      state.athletes = [];
      state.selectedGroupingId = '';
      state.targetGroupingId = '';
      state.selectedAthleteIndex = null;
      state.selectedDrawId = '';
      state.drawDirty = false;
      state.drawSnapshot = null;
      state.drawSlots = [];
      renderAthletesTable();
      if (state.eventId) {
        await loadSavedForEvent();
        showToast('loaded saved groupings/draws/schedule if available.');
      } else {
        renderGroupings();
        renderDraws();
        renderSchedule();
      }
      refreshWorkflowFocus();
    });
  });
}

function bindDivisions() {
  document.getElementById('generatePatternBtn').addEventListener('click', async () => {
    const btn = document.getElementById('generatePatternBtn');
    setBusy(btn, true);
    try {
      const payload = collectPatternFormPayload();
      const data = await apiFetch('/api/division-advanced/divisions/generate-pattern', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const added = data.leaves || [];
      state.leaves = [...state.leaves, ...added];
      renderDivisionsTable();
      showToast(`added ${added.length} division leaves.`);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('createAllDefaultsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('createAllDefaultsBtn');
    setBusy(btn, true);
    try {
      const data = await apiFetch('/api/division-advanced/divisions/create-all-defaults', { method: 'POST' });
      state.leaves = data.leaves || [];
      renderDivisionsTable();
      showToast(`created ${data.count} default division leaves.`);
      if (data.failures?.length) showToast(`skipped: ${data.failures.join(', ')}`, true);
      refreshWorkflowFocus();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('loadTemplateBtn').addEventListener('click', async () => {
    const id = document.getElementById('templateSelect').value;
    if (!id) return showToast('select a template.', true);
    try {
      const data = await apiFetch(`/api/division-advanced/divisions/templates/${id}`);
      state.leaves = data.leaves || [];
      renderDivisionsTable();
      showToast(`loaded template "${data.nickname}".`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('saveTemplateBtn').addEventListener('click', async () => {
    if (!state.leaves.length) return showToast('no divisions to save.', true);
    const nickname = window.prompt('template nickname:');
    if (!nickname?.trim()) return;
    try {
      await apiFetch('/api/division-advanced/divisions/templates', {
        method: 'POST',
        body: JSON.stringify({ nickname: nickname.trim(), leaves: state.leaves })
      });
      await loadTemplates();
      showToast('template saved.');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('clearDivisionsBtn').addEventListener('click', async () => {
    if (!state.leaves.length) return showToast('divisions already empty.');
    const ok = await showConfirmModal({
      title: 'clear divisions',
      message: 'clear all division leaves from this session?',
      confirmLabel: 'clear'
    });
    if (!ok) return;
    clearDivisions();
  });
}

function bindAthletes() {
  document.getElementById('importAthletesBtn').addEventListener('click', async () => {
    const btn = document.getElementById('importAthletesBtn');
    setBusy(btn, true);
    try {
      const eventId = requireEvent();
      const data = await apiFetch(`/api/division-advanced/events/${eventId}/athletes`);
      state.athletes = data.athletes || [];
      renderAthletesTable();
      showToast(`imported ${data.count} athletes.`);
      refreshWorkflowFocus();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });
  document.getElementById('athleteSearch').addEventListener('input', (e) => {
    state.athleteFilter = e.target.value;
    renderAthletesTable();
  });
  document.getElementById('clearAthletesBtn').addEventListener('click', async () => {
    if (!state.athletes.length) return showToast('athletes already empty.');
    const ok = await showConfirmModal({
      title: 'clear athletes',
      message: 'clear imported athletes from this session?',
      confirmLabel: 'clear'
    });
    if (!ok) return;
    clearAthletes();
    refreshWorkflowFocus();
  });
}

function bindGroupings() {
  document.getElementById('generateGroupingsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('generateGroupingsBtn');
    setBusy(btn, true);
    try {
      const eventId = requireEvent();
      if (!state.leaves.length) throw new Error('create or load divisions first.');
      if (!state.athletes.length) {
        const data = await apiFetch(`/api/division-advanced/events/${eventId}/athletes`);
        state.athletes = data.athletes || [];
      }
      const generated = await apiFetch(`/api/division-advanced/events/${eventId}/groupings/generate`, {
        method: 'POST',
        body: JSON.stringify({ leaves: state.leaves, athletes: state.athletes })
      });
      state.groupingsState = generated.state;
      if (state.groupingsState?.leaves) state.leaves = state.groupingsState.leaves;
      if (state.drawsState) {
        state.drawsState.groupings_out_of_sync = true;
      }
      state.selectedGroupingId = '';
      state.targetGroupingId = '';
      state.selectedAthleteIndex = null;
      renderGroupings();
      showToast('groupings generated (not saved yet).');
      refreshWorkflowFocus();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('saveGroupingsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveGroupingsBtn');
    setBusy(btn, true);
    try {
      await saveGroupingsSession();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('groupingsSearch').addEventListener('input', (e) => {
    state.groupingFilter = e.target.value;
    renderGroupings();
  });
  document.getElementById('groupingsAthleteSearch').addEventListener('input', (e) => {
    state.groupingAthleteFilter = e.target.value;
    renderGroupings();
  });
  document.getElementById('groupingsEventFilter').addEventListener('change', (e) => {
    state.groupingEventFilter = e.target.value;
    renderGroupings();
  });
  document.getElementById('groupingsTypeFilter').addEventListener('change', (e) => {
    state.groupingTypeFilter = e.target.value;
    renderGroupings();
  });
  document.getElementById('groupingsSort').addEventListener('change', (e) => {
    state.groupingSort = e.target.value;
    renderGroupings();
  });
  document.getElementById('groupingsClearFiltersBtn').addEventListener('click', () => {
    state.groupingFilter = '';
    state.groupingAthleteFilter = '';
    state.groupingEventFilter = '';
    state.groupingTypeFilter = '';
    state.groupingSort = 'name';
    document.getElementById('groupingsSearch').value = '';
    document.getElementById('groupingsAthleteSearch').value = '';
    document.getElementById('groupingsEventFilter').value = '';
    document.getElementById('groupingsTypeFilter').value = '';
    document.getElementById('groupingsSort').value = 'name';
    renderGroupings();
  });

  document.querySelector('#groupingsTable tbody').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    state.selectedGroupingId = row.dataset.id;
    state.selectedAthleteIndex = null;
    state.targetGroupingId = '';
    renderGroupings();
  });

  document.getElementById('groupingsSourceAthletes').addEventListener('click', (e) => {
    const chip = e.target.closest('.da-athlete-chip[data-index]');
    if (!chip) return;
    state.selectedAthleteIndex = Number(chip.dataset.index);
    renderGroupings();
  });

  document.getElementById('moveTargetSelect').addEventListener('change', (e) => {
    state.targetGroupingId = e.target.value;
    renderGroupings();
  });

  document.getElementById('moveAthleteBtn').addEventListener('click', async () => {
    try {
      const eventId = requireEvent();
      if (!state.selectedGroupingId || state.selectedAthleteIndex == null) {
        throw new Error('select an athlete in the source division.');
      }
      const toId = document.getElementById('moveTargetSelect').value || state.targetGroupingId;
      if (!toId) throw new Error('select a target division.');
      const fromId = state.selectedGroupingId;
      if (!state.groupingsState) throw new Error('generate groupings first.');
      const moved = await apiFetch(`/api/division-advanced/events/${eventId}/groupings/move`, {
        method: 'POST',
        body: JSON.stringify({
          state: state.groupingsState,
          fromDivisionId: fromId,
          toDivisionId: toId,
          athleteIndex: state.selectedAthleteIndex
        })
      });
      state.groupingsState = moved.state;
      state.selectedGroupingId = fromId;
      state.targetGroupingId = toId;
      state.selectedAthleteIndex = null;
      renderGroupings();
      showToast('athlete moved (not saved yet).');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('clearGroupingsBtn').addEventListener('click', async () => {
    if (!state.groupingsState) return showToast('groupings already empty.');
    const ok = await showConfirmModal({
      title: 'clear groupings',
      message: 'clear groupings from this session? any previously saved DB row is unchanged until you save again.',
      confirmLabel: 'clear'
    });
    if (!ok) return;
    clearGroupings();
  });
}

function bindDraws() {
  document.getElementById('generateDrawsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('generateDrawsBtn');
    setBusy(btn, true);
    try {
      const eventId = requireEvent();
      const generated = await apiFetch(`/api/division-advanced/events/${eventId}/draws/generate`, {
        method: 'POST',
        body: JSON.stringify({ groupingsState: state.groupingsState })
      });
      state.drawsState = generated.state;
      state.drawDirty = false;
      state.drawSnapshot = null;
      state.drawSlots = [];
      renderDraws();
      showToast('draws created (not saved yet).');
      refreshWorkflowFocus();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('saveDrawsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveDrawsBtn');
    setBusy(btn, true);
    try {
      await saveDrawsSession();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('downloadZipBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('downloadZipBtn');
    setBusy(btn, true);
    try {
      await downloadDrawsZip();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.querySelector('#drawsTable tbody').addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    if (state.drawDirty && state.selectedDrawId && state.selectedDrawId !== row.dataset.id) {
      const choice = await showConfirmModal({
        title: 'unsaved draw edits',
        message: 'this division has unsaved draw edits. discard changes and switch, or stay on the current division?',
        confirmLabel: 'discard & switch',
        cancelLabel: 'stay'
      });
      if (!choice) return;
      const prev = selectedDrawEntry();
      if (prev && state.drawSnapshot) {
        Object.assign(prev, state.drawSnapshot);
      }
      state.drawDirty = false;
      state.drawSnapshot = null;
      state.drawSlots = [];
    }
    state.selectedDrawId = row.dataset.id;
    state.drawDirty = false;
    state.drawSnapshot = null;
    state.drawSlots = [];
    renderDraws();
  });

  document.querySelectorAll('.da-subtab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      switchDrawSubtab(btn.dataset.subtab);
      const entry = selectedDrawEntry();
      if (btn.dataset.subtab === 'pdf' && entry) {
        try {
          await loadPdfPreview(entry);
        } catch (err) {
          showToast(err.message || 'PDF preview failed', true);
        }
      }
    });
  });

  document.getElementById('saveDrawBtn').addEventListener('click', async () => {
    try {
      await saveDrawsSession();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('revertDrawBtn').addEventListener('click', async () => {
    const entry = selectedDrawEntry();
    if (!entry || !state.drawDirty || !state.drawSnapshot) return;
    const ok = await showConfirmModal({
      title: 'discard changes',
      message: 'discard unsaved changes and restore the last saved draw?',
      confirmLabel: 'discard'
    });
    if (!ok) return;
    Object.assign(entry, state.drawSnapshot);
    state.drawDirty = false;
    state.drawSnapshot = null;
    state.drawSlots = [];
    renderDraws();
    showToast('draw reverted.');
  });

  document.getElementById('clearDrawsBtn').addEventListener('click', async () => {
    if (!state.drawsState) return showToast('draws already empty.');
    const ok = await showConfirmModal({
      title: 'clear draws',
      message: 'clear draws from this session? any previously saved DB row is unchanged until you save again.',
      confirmLabel: 'clear'
    });
    if (!ok) return;
    clearDraws();
  });

  setDrawEditorCallback(applyEditedEntry);
}

function recommendedWorkflowStep() {
  if (!state.eventId) return 'event';
  if (!state.leaves?.length) return 'divisions';
  if (!state.athletes?.length) return 'athletes';
  if (!state.groupingsState?.catalog?.length) return 'groupings';
  if (!state.drawsState?.catalog?.length) return 'draws';
  if (!state.scheduleState?.catalog?.length) return 'schedule';
  return 'done';
}

function workflowCompletionFlags() {
  return {
    event: Boolean(state.eventId),
    divisions: Boolean(state.leaves?.length),
    athletes: Boolean(state.athletes?.length),
    groupings: Boolean(state.groupingsState?.catalog?.length),
    draws: Boolean(state.drawsState?.catalog?.length),
    schedule: Boolean(state.scheduleState?.catalog?.length)
  };
}

function progressFromRecommended(stepKey) {
  const order = ['event', 'divisions', 'athletes', 'groupings', 'draws', 'schedule', 'done'];
  const idx = Math.max(0, order.indexOf(stepKey));
  return Math.round((idx / (order.length - 1)) * 100);
}

function setWorkflowRingPct(pct) {
  const ring = document.getElementById('workflowStatusRing');
  if (!ring) return;
  const value = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  ring.style.setProperty('--p', String(value));
  const span = ring.querySelector('span');
  if (span) span.textContent = `${value}%`;
}

function setWorkflowMessage(message) {
  const text = document.getElementById('workflowProgressText');
  if (text) text.textContent = message;
}

async function saveGroupingsSession({ silent = false } = {}) {
  const eventId = requireEvent();
  if (!state.groupingsState) throw new Error('no groupings to save.');
  await apiFetch(`/api/division-advanced/events/${eventId}/groupings`, {
    method: 'PUT',
    body: JSON.stringify({ state: state.groupingsState })
  });
  if (!silent) showToast('groupings saved.');
}

async function saveDrawsSession({ silent = false } = {}) {
  const eventId = requireEvent();
  if (!state.drawsState) throw new Error('no draws to save.');
  await apiFetch(`/api/division-advanced/events/${eventId}/draws`, {
    method: 'PUT',
    body: JSON.stringify({ state: state.drawsState })
  });
  state.drawDirty = false;
  state.drawSnapshot = null;
  renderDraws();
  if (!silent) showToast('draws saved.');
}

async function saveScheduleSession({ silent = false } = {}) {
  const eventId = requireEvent();
  if (!state.scheduleState) throw new Error('no schedule to save.');
  await apiFetch(`/api/division-advanced/events/${eventId}/schedule`, {
    method: 'PUT',
    body: JSON.stringify({ state: state.scheduleState })
  });
  if (!silent) showToast('schedule saved.');
}

async function saveDivisionsTemplateAsEventName({ silent = false } = {}) {
  const eventId = requireEvent();
  if (!state.leaves?.length) throw new Error('no divisions to save.');
  const event = (state.events || []).find((e) => String(e.id) === String(eventId));
  const nickname = String(event?.event_name || '').trim() || `event_${eventId}`;
  await loadTemplates();
  const existing = (state.templates || []).find(
    (t) => String(t.nickname || '').trim().toLowerCase() === nickname.toLowerCase()
  );
  await apiFetch('/api/division-advanced/divisions/templates', {
    method: 'POST',
    body: JSON.stringify({
      nickname,
      leaves: state.leaves,
      overwriteId: existing?.id || null
    })
  });
  await loadTemplates();
  if (!silent) showToast(`divisions saved as "${nickname}".`);
  return nickname;
}

async function saveWorkflowToProfile() {
  const done = workflowCompletionFlags();
  if (!done.event || !done.divisions || !done.groupings || !done.draws || !done.schedule) {
    throw new Error('finish the full workflow before saving to profile.');
  }

  const eventId = requireEvent();
  const event = (state.events || []).find((e) => String(e.id) === String(eventId));
  const nickname = String(event?.event_name || '').trim() || `event_${eventId}`;

  await loadTemplates();
  const existing = (state.templates || []).find(
    (t) => String(t.nickname || '').trim().toLowerCase() === nickname.toLowerCase()
  );

  await Promise.all([
    apiFetch('/api/division-advanced/divisions/templates', {
      method: 'POST',
      body: JSON.stringify({
        nickname,
        leaves: state.leaves,
        overwriteId: existing?.id || null
      })
    }),
    apiFetch(`/api/division-advanced/events/${eventId}/groupings`, {
      method: 'PUT',
      body: JSON.stringify({ state: state.groupingsState })
    }),
    apiFetch(`/api/division-advanced/events/${eventId}/draws`, {
      method: 'PUT',
      body: JSON.stringify({ state: state.drawsState })
    }),
    apiFetch(`/api/division-advanced/events/${eventId}/schedule`, {
      method: 'PUT',
      body: JSON.stringify({ state: state.scheduleState })
    })
  ]);

  state.drawDirty = false;
  state.drawSnapshot = null;
  renderDraws();

  await loadTemplates();

  showToast(`saved all files to profile — divisions "${nickname}", groupings, draws, and schedule.`);
}

async function removeWorkflowFromProfile() {
  const eventId = requireEvent();
  const event = (state.events || []).find((e) => String(e.id) === String(eventId));
  const eventName = String(event?.event_name || '').trim() || `event ${eventId}`;

  const ok = await showConfirmModal({
    title: 'remove files from profile',
    message: `delete saved divisions, groupings, draws, and schedule for “${eventName}”? registration for this event will not be changed.`,
    confirmLabel: 'remove'
  });
  if (!ok) return null;

  const result = await apiFetch(`/api/division-advanced/events/${eventId}/profile-files`, {
    method: 'DELETE'
  });

  // Clear session copies of removed profile files; leave athletes/registration alone.
  clearDivisions({ silent: true });
  clearGroupings({ silent: true });
  clearDraws({ silent: true });
  clearSchedule({ silent: true });
  await loadTemplates();
  refreshWorkflowFocus();

  const deleted = result?.deleted || {};
  const bits = [
    deleted.divisions ? `${deleted.divisions} division template(s)` : null,
    deleted.groupings ? 'groupings' : null,
    deleted.draws ? 'draws' : null,
    deleted.schedules ? 'schedule' : null
  ].filter(Boolean);

  showToast(
    bits.length
      ? `removed from profile: ${bits.join(', ')}.`
      : 'no saved profile files found for this event.'
  );
  return result;
}

async function downloadDrawsZip() {
  const eventId = requireEvent();
  if (!state.drawsState) throw new Error('no draws to download.');
  const res = await apiFetch(`/api/division-advanced/events/${eventId}/draws/download.zip`, {
    method: 'POST',
    body: JSON.stringify({ state: state.drawsState })
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const header = res.headers.get('Content-Disposition') || '';
  const headerMatch = header.match(/filename="([^"]+)"/i);
  if (headerMatch?.[1]) {
    a.download = headerMatch[1];
  } else {
    const event = (state.events || []).find((e) => String(e.id) === String(eventId));
    const rawName = String(event?.event_name || '').trim() || `event_${eventId}_draws`;
    const safe = rawName
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .slice(0, 120)
      .trim() || `event_${eventId}_draws`;
    a.download = safe.toLowerCase().endsWith('.zip') ? safe : `${safe}.zip`;
  }

  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function refreshWorkflowFocus(activeStep = null, { syncRing = null, keepMessage = false } = {}) {
  const done = workflowCompletionFlags();
  const focusKey = activeStep || recommendedWorkflowStep();

  document.querySelectorAll('.da-workflow-step[data-step-key]').forEach((el) => {
    const key = el.dataset.stepKey;
    el.classList.toggle('is-done', Boolean(done[key]));
    el.classList.toggle('is-focus', focusKey !== 'done' && key === focusKey);
  });

  const workflowZipBtn = document.getElementById('workflowDownloadZipBtn');
  if (workflowZipBtn) workflowZipBtn.hidden = !done.draws;

  const saveToProfileBtn = document.getElementById('workflowSaveToProfileBtn');
  if (saveToProfileBtn) {
    const ready =
      done.event &&
      done.divisions &&
      done.athletes &&
      done.groupings &&
      done.draws &&
      done.schedule;
    saveToProfileBtn.hidden = !ready;
  }

  const removeFromProfileBtn = document.getElementById('workflowRemoveFromProfileBtn');
  if (removeFromProfileBtn) {
    removeFromProfileBtn.hidden = !done.event;
  }

  const shouldSyncRing = syncRing === true || (syncRing !== false && !activeStep);
  if (shouldSyncRing) {
    setWorkflowRingPct(progressFromRecommended(recommendedWorkflowStep()));
  }

  if (!keepMessage && !activeStep) {
    setWorkflowMessage(recommendedWorkflowStep() === 'done' ? 'complete' : 'ready');
  }
}

function updateWorkflowStatus({ step = 'event', message = '', commitProgress = false } = {}) {
  if (message) setWorkflowMessage(message);
  if (commitProgress) {
    refreshWorkflowFocus(null, { syncRing: true, keepMessage: Boolean(message) });
  } else {
    refreshWorkflowFocus(step === 'done' ? 'done' : step, { syncRing: false, keepMessage: true });
  }
}

async function runWorkflowStep(step) {
  const eventId = requireEvent();
  const result = document.getElementById('workflowResult');
  if (result) result.hidden = true;

  if (step === 'divisions') {
    updateWorkflowStatus({ step: 'divisions', message: 'creating default divisions…' });
    const data = await apiFetch('/api/division-advanced/divisions/create-all-defaults', { method: 'POST' });
    state.leaves = data.leaves || [];
    renderDivisionsTable();
    updateWorkflowStatus({
      step: 'divisions',
      message: `${state.leaves.length} divisions ready`,
      commitProgress: true
    });
    showToast(`created ${state.leaves.length} default divisions.`);
    return;
  }

  if (step === 'athletes') {
    updateWorkflowStatus({ step: 'athletes', message: 'importing athletes…' });
    const data = await apiFetch(`/api/division-advanced/events/${eventId}/athletes`);
    state.athletes = data.athletes || [];
    renderAthletesTable();
    updateWorkflowStatus({
      step: 'athletes',
      message: `${state.athletes.length} athletes imported`,
      commitProgress: true
    });
    showToast(`imported ${state.athletes.length} athletes.`);
    return;
  }

  if (step === 'groupings') {
    updateWorkflowStatus({ step: 'groupings', message: 'generating groupings…' });
    if (!state.leaves.length) throw new Error('create divisions first.');
    if (!state.athletes.length) {
      const data = await apiFetch(`/api/division-advanced/events/${eventId}/athletes`);
      state.athletes = data.athletes || [];
      renderAthletesTable();
    }
    const generated = await apiFetch(`/api/division-advanced/events/${eventId}/groupings/generate`, {
      method: 'POST',
      body: JSON.stringify({ leaves: state.leaves, athletes: state.athletes })
    });
    state.groupingsState = generated.state;
    if (state.groupingsState?.leaves) state.leaves = state.groupingsState.leaves;
    renderGroupings();
    updateWorkflowStatus({
      step: 'groupings',
      message: 'groupings generated',
      commitProgress: true
    });
    showToast('groupings generated (not saved yet).');
    return;
  }

  if (step === 'draws') {
    updateWorkflowStatus({ step: 'draws', message: 'creating draws…' });
    if (!state.groupingsState) throw new Error('generate groupings first.');
    const generated = await apiFetch(`/api/division-advanced/events/${eventId}/draws/generate`, {
      method: 'POST',
      body: JSON.stringify({ groupingsState: state.groupingsState })
    });
    state.drawsState = generated.state;
    state.drawDirty = false;
    state.drawSnapshot = null;
    state.drawSlots = [];
    renderDraws();
    updateWorkflowStatus({
      step: 'draws',
      message: 'draws created',
      commitProgress: true
    });
    showToast('draws created (not saved yet).');
    return;
  }

  if (step === 'schedule') {
    updateWorkflowStatus({ step: 'schedule', message: 'packing schedule across 3 rings…' });
    if (!state.drawsState) {
      const loaded = await apiFetch(`/api/division-advanced/events/${eventId}/draws`);
      state.drawsState = loaded.state;
      if (!state.drawsState) throw new Error('generate draws first.');
      renderDraws();
    }
    const ringCount = Number(document.getElementById('scheduleRingCount')?.value || 3);
    const generated = await apiFetch(`/api/division-advanced/events/${eventId}/schedule/generate`, {
      method: 'POST',
      body: JSON.stringify({
        drawsState: state.drawsState,
        groupingsState: state.groupingsState,
        ringCount
      })
    });
    state.scheduleState = generated.state;
    state.scheduleSelectedIds = new Set();
    renderSchedule();
    updateWorkflowStatus({
      step: 'schedule',
      message: `schedule packed · ${generated.placed || 0} placed` +
        (generated.skipped ? ` · ${generated.skipped} skipped` : ''),
      commitProgress: true
    });
    showToast('schedule generated (not saved yet).');
  }
}

function bindSchedule() {
  bindSchedulePanel({ showToast, showConfirmModal });

  document.getElementById('refreshScheduleFromDrawsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshScheduleFromDrawsBtn');
    setBusy(btn, true);
    try {
      await runWorkflowStep('schedule');
      switchTab('schedule');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('saveScheduleBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveScheduleBtn');
    setBusy(btn, true);
    try {
      await saveScheduleSession();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('clearScheduleBtn')?.addEventListener('click', async () => {
    if (!state.scheduleState) return showToast('schedule already empty.');
    const ok = await showConfirmModal({
      title: 'clear schedule',
      message: 'clear schedule from this session? any previously saved DB row is unchanged until you save again.',
      confirmLabel: 'clear'
    });
    if (!ok) return;
    clearSchedule();
  });
}

function bindWorkflow() {
  document.querySelectorAll('[data-run-step]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      setBusy(btn, true);
      try {
        await runWorkflowStep(btn.dataset.runStep);
      } catch (err) {
        showToast(err.message, true);
        refreshWorkflowFocus(null, { syncRing: false, keepMessage: true });
      } finally {
        setBusy(btn, false);
      }
    });
  });

  document.getElementById('workflowDownloadZipBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('workflowDownloadZipBtn');
    setBusy(btn, true);
    try {
      await downloadDrawsZip();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('workflowSaveToProfileBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('workflowSaveToProfileBtn');
    setBusy(btn, true);
    try {
      await saveWorkflowToProfile();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('workflowRemoveFromProfileBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('workflowRemoveFromProfileBtn');
    setBusy(btn, true);
    try {
      await removeWorkflowFromProfile();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('runAllWorkflowBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('runAllWorkflowBtn');
    const result = document.getElementById('workflowResult');
    setBusy(btn, true);
    if (result) result.hidden = true;
    try {
      if (!state.eventId) {
        flashMissingEventSelect();
        return;
      }
      updateWorkflowStatus({ step: 'divisions', message: 'starting full workflow…' });
      await runWorkflowStep('divisions');
      await runWorkflowStep('athletes');
      await runWorkflowStep('groupings');
      await runWorkflowStep('draws');
      await runWorkflowStep('schedule');
      if (result) {
        result.hidden = false;
        result.innerHTML = `
          <p>workflow complete — use <strong>save all files to profile</strong> to persist divisions, groupings, draws, and schedule.</p>
          <ul>
            <li>${state.leaves?.length || 0} divisions</li>
            <li>${state.athletes?.length || 0} athletes</li>
            <li>${state.groupingsState?.catalog?.length || 0} groupings</li>
            <li>${(state.drawsState?.catalog || []).filter((e) => (e.athlete_count || 0) > 0).length} draws</li>
            <li>${Object.keys(state.scheduleState?.placements || {}).length} schedule placements (${state.scheduleState?.ring_count || 3} rings)</li>
          </ul>
        `;
      }
      updateWorkflowStatus({ step: 'done', message: 'workflow complete', commitProgress: true });
      showToast('workflow finished (not saved yet).');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('clearAllWorkflowBtn').addEventListener('click', clearAllTabs);
  refreshWorkflowFocus();
}

function flashMissingEventSelect() {
  const select = document.getElementById('eventSelect');
  const bar = select?.closest('.da-event-bar-inline') || select;
  const step = document.querySelector('.da-workflow-step[data-step-key="event"]');
  if (step) {
    step.classList.add('is-focus');
    step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  if (!select) return;
  select.focus({ preventScroll: true });
  const targets = [select, bar].filter(Boolean);
  targets.forEach((el) => {
    el.classList.remove('da-flash-missing');
    // force reflow so the animation can restart
    void el.offsetWidth;
    el.classList.add('da-flash-missing');
  });
  const clear = () => {
    targets.forEach((el) => el.classList.remove('da-flash-missing'));
  };
  window.setTimeout(clear, 1600);
  updateWorkflowStatus({ step: 'event', message: 'select an event first' });
}

async function init() {
  logInteraction('page_view', { description: 'Advanced division creation page loaded' });
  const profile = await apiFetch('/api/profile');
  if (!(await applyProfile(profile))) return;
  bindTabs();
  bindEventSelect();
  bindPatternForm();
  await initPatternForm();
  bindDivisions();
  bindAthletes();
  bindGroupings();
  bindDraws();
  bindSchedule();
  bindWorkflow();
  await loadEvents();
  await loadTemplates();
  renderDivisionsTable();
  renderAthletesTable();
  renderGroupings();
  renderDraws();
  renderSchedule();
  refreshWorkflowFocus();
}

init().catch(() => {
  window.location.href = '/landing';
});
