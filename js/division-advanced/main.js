import { apiFetch, logInteraction, notifyPortalDataUpdated, rememberPortalEventId } from './api.js';
import { state, requireEvent, selectedDrawEntry } from './state.js';
import {
  showToast, showConfirmModal, showPromptModal, setBusy, renderDivisionsTable, renderDraws,
  loadEvents, loadTemplates, loadSavedForEvent, loadCreationStatus,
  saveDivisionsForEvent, saveNamedDivisionTemplate, switchDrawSubtab, eventNickname, loadEventTemplateLeaves,
  moveSelectedAthletesLocally, combineSoloDivisionsLocally, countSoloDivisions, setDivisionNameQuery,
  renderDrawPreviewPanels, closeTemplatePicker, toggleTemplatePicker, deleteDivisionTemplate,
  setLeafDivisionName, removeLeafAtIndex, applySimplifiedDivisionNames, applyDescriptiveDivisionNames,
  fillMissingDescriptiveDivisionNames
} from './ui.js';
import { divisionTitleFromSpec } from './merge-division.js';
import { initPatternForm, bindPatternForm, collectPatternFormPayload } from './pattern-form.js';
import { initCustomDivisionFeature } from './custom-division.js';

function setPrompt(message, { hidden = false } = {}) {
  const prompt = document.getElementById('workflowProgressText');
  if (!prompt) return;
  prompt.textContent = message;
  prompt.hidden = hidden;
}

let ringPctValue = 0;
let ringWorkingTimer = null;

function getRingPct() {
  const ring = document.getElementById('workflowStatusRing');
  if (!ring) return ringPctValue;
  const raw = Number.parseFloat(ring.style.getPropertyValue('--p'));
  if (Number.isFinite(raw)) return raw;
  return ringPctValue;
}

function setRingPct(pct, { instant = false } = {}) {
  const ring = document.getElementById('workflowStatusRing');
  if (!ring) return;
  const next = Math.max(0, Math.min(100, Number(pct) || 0));
  ringPctValue = next;
  ring.classList.toggle('da-ring-working', false);
  if (instant) {
    ring.classList.add('da-ring-no-transition');
    ring.style.setProperty('--p', String(next));
    void ring.offsetWidth;
    ring.classList.remove('da-ring-no-transition');
    return;
  }
  ring.style.setProperty('--p', String(next));
}

function stopRingWorking() {
  if (ringWorkingTimer) {
    clearInterval(ringWorkingTimer);
    ringWorkingTimer = null;
  }
  const ring = document.getElementById('workflowStatusRing');
  ring?.classList.remove('da-ring-working');
}

/**
 * Slowly fill the status ring toward `ceiling` while async work runs.
 * Stops just short of the ceiling so the final phase jump still reads as completion.
 */
function startRingWorking({ from = null, ceiling = 90, step = 0.45, everyMs = 90 } = {}) {
  stopRingWorking();
  const ring = document.getElementById('workflowStatusRing');
  if (!ring) return;
  if (from != null) setRingPct(from, { instant: true });
  const cap = Math.max(getRingPct() + 0.5, Math.min(99.5, Number(ceiling) || 90));
  ring.classList.add('da-ring-working');
  ringWorkingTimer = window.setInterval(() => {
    const cur = getRingPct();
    if (cur >= cap - 0.05) return;
    // Ease: smaller steps as we near the ceiling
    const remain = cap - cur;
    const delta = Math.min(remain, Math.max(0.08, step * (0.35 + 0.65 * (remain / Math.max(cap, 1)))));
    const next = Math.min(cap, cur + delta);
    ringPctValue = next;
    ring.style.setProperty('--p', String(next));
  }, everyMs);
}

async function withRingWorking(work, {
  from = null,
  ceiling = 90,
  prompt = null,
  donePct = null
} = {}) {
  if (prompt) setPrompt(prompt, { hidden: false });
  startRingWorking({ from, ceiling });
  try {
    const result = await work();
    stopRingWorking();
    if (donePct != null) setRingPct(donePct);
    return result;
  } catch (err) {
    stopRingWorking();
    throw err;
  }
}

function showScreen(screen) {
  state.screen = screen;
  const start = screen === 'wheel';
  document.documentElement.classList.toggle('da-start-screen', start);
  document.documentElement.classList.toggle('da-edit-screen', !start);
  const divisions = document.getElementById('tab-divisions');
  const draws = document.getElementById('tab-draws');
  if (divisions) {
    divisions.hidden = screen !== 'divisions';
    divisions.classList.toggle('active', screen === 'divisions');
  }
  if (draws) {
    draws.hidden = screen !== 'draws';
    draws.classList.toggle('active', screen === 'draws');
  }
}

function setWheelPhase(phase) {
  stopRingWorking();
  state.wheelPhase = phase;
  const choice = document.getElementById('daDivisionChoice');
  const ready = document.getElementById('daCreateDrawsChoice');
  const complete = document.getElementById('daCompleteChoice');
  const ring = document.getElementById('workflowStatusRing');
  if (choice) choice.hidden = phase !== 'choose';
  if (ready) ready.hidden = phase !== 'ready';
  if (complete) complete.hidden = phase !== 'complete';
  ring?.classList.toggle('da-ring-complete', phase === 'complete');

  if (phase === 'pick') {
    setPrompt('select an event', { hidden: false });
    setRingPct(0);
  } else if (phase === 'choose') {
    setPrompt('choose how to build divisions', { hidden: false });
    setRingPct(28);
  } else if (phase === 'ready') {
    setPrompt('divisions ready — create draws', { hidden: false });
    setRingPct(64);
  } else if (phase === 'complete') {
    setPrompt('Complete - Proceed to scoring application', { hidden: false });
    setRingPct(100);
  }

  const progress = document.getElementById('workflowProgressText');
  if (progress) progress.classList.toggle('is-complete', phase === 'complete');
}

function soloCombinedStorageKey(eventId = state.eventId) {
  return eventId ? `da-solo-combined:${eventId}` : '';
}

function readSoloCombinedFlag(eventId = state.eventId) {
  const key = soloCombinedStorageKey(eventId);
  if (!key) return false;
  try {
    return sessionStorage.getItem(key) === '1';
  } catch (_) {
    return false;
  }
}

function writeSoloCombinedFlag(value, eventId = state.eventId) {
  const key = soloCombinedStorageKey(eventId);
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, '1');
    else sessionStorage.removeItem(key);
  } catch (_) { /* ignore */ }
}

function setChoiceBtnLabel(btn, label) {
  if (!btn) return;
  const labelEl = btn.querySelector('.da-btn-label');
  if (labelEl) labelEl.textContent = label;
  else btn.textContent = label;
}

function syncCombineSoloButton() {
  const btn = document.getElementById('combineSoloDrawsBtn');
  if (!btn) return;
  const soloCount = countSoloDivisions();
  const clicked = Boolean(state.soloDivisionsCombined) || readSoloCombinedFlag();
  state.soloDivisionsCombined = clicked;
  if (clicked || soloCount === 0) {
    btn.disabled = true;
    btn.classList.add('da-choice-btn-done');
    setChoiceBtnLabel(btn, clicked ? 'Solo Divisions Combined' : 'No Solo Divisions');
      } else {
    btn.disabled = false;
    btn.classList.remove('da-choice-btn-done');
    setChoiceBtnLabel(btn, 'Solo Divisions');
  }
}

function markCombineSoloButtonDone() {
  state.soloDivisionsCombined = true;
  writeSoloCombinedFlag(true);
  syncCombineSoloButton();
}

function savedTemplateStorageKey(eventId = state.eventId) {
  const id = String(eventId || '').trim();
  return id ? `da-saved-template:${id}` : '';
}

function readSavedTemplateName(eventId = state.eventId) {
  const key = savedTemplateStorageKey(eventId);
  if (!key) return '';
  try {
    return String(sessionStorage.getItem(key) || '').trim();
  } catch (_) {
    return '';
  }
}

function writeSavedTemplateName(name, eventId = state.eventId) {
  const key = savedTemplateStorageKey(eventId);
  if (!key) return;
  try {
    const trimmed = String(name || '').trim();
    if (trimmed) sessionStorage.setItem(key, trimmed);
    else sessionStorage.removeItem(key);
  } catch (_) { /* ignore */ }
}

function syncSaveDivisionTemplateButton() {
  const btn = document.getElementById('saveDivisionTemplateBtn');
  if (!btn) return;
  const savedName = String(state.savedDivisionTemplateName || '').trim() || readSavedTemplateName();
  state.savedDivisionTemplateName = savedName;
  if (savedName) {
    btn.disabled = true;
    btn.classList.add('da-choice-btn-done');
    setChoiceBtnLabel(btn, `Template Saved as "${savedName}"`);
    btn.title = `division template already saved as "${savedName}"`;
  } else {
    btn.disabled = false;
    btn.classList.remove('da-choice-btn-done');
    setChoiceBtnLabel(btn, 'Save Template');
    btn.removeAttribute('title');
  }
}

function markDivisionTemplateSaved(name) {
  const trimmed = String(name || '').trim();
  state.savedDivisionTemplateName = trimmed;
  writeSavedTemplateName(trimmed);
  syncSaveDivisionTemplateButton();
}

async function prepareCompleteWheel() {
  if (state.eventId && !state.drawsState) {
    try {
      await loadSavedForEvent();
    } catch (_) { /* ignore */ }
  }
  state.soloDivisionsCombined = readSoloCombinedFlag();
  syncCombineSoloButton();
  state.savedDivisionTemplateName = readSavedTemplateName();
  syncSaveDivisionTemplateButton();
}

function flashMissingEventSelect() {
  const select = document.getElementById('eventSelect');
  const bar = select?.closest('.da-event-gate') || select;
  if (!select) return;
  select.focus({ preventScroll: true });
  const targets = [select, bar].filter(Boolean);
  targets.forEach((el) => {
    el.classList.remove('da-flash-missing');
    void el.offsetWidth;
    el.classList.add('da-flash-missing');
  });
  window.setTimeout(() => {
    targets.forEach((el) => el.classList.remove('da-flash-missing'));
  }, 1600);
  setPrompt('select an event first');
}

async function applyProfile(profile) {
  const principleUserAdvanced = Number(profile?.principleUserAdvanced) === 1;
  if (!principleUserAdvanced) {
    if (!document.documentElement.classList.contains('da-embed')) {
      window.location.href = '/landing';
    }
    return false;
  }
  return true;
}

async function refreshWheelFromStatus() {
  showScreen('wheel');
  if (!state.eventId) {
    setWheelPhase('pick');
    return;
  }
  const status = await loadCreationStatus();
  if (status?.hasDraws) {
    setWheelPhase('complete');
    await prepareCompleteWheel();
  } else if (status?.hasDivisions) {
    setWheelPhase('ready');
  } else {
    setWheelPhase('choose');
  }
}

function resetSessionData() {
  state.leaves = [];
  state.drawsState = null;
  state.creationStatus = null;
  state.selectedDrawId = '';
  state.selectedAthleteIndices = new Set();
  state.targetGroupingId = '';
  state.drawDirty = false;
  state.drawSubtab = 'pool';
  state.filterDrawsToSolo = false;
  state.divisionMode = '';
  // In-memory only; sessionStorage flags are per-event and restored in prepareCompleteWheel.
  state.soloDivisionsCombined = false;
  state.savedDivisionTemplateName = '';
  syncCombineSoloButton();
  syncSaveDivisionTemplateButton();
}

function isEventLiveToday() {
  const event = state.events.find((e) => String(e.id) === String(state.eventId));
  if (!event) return false;
  const start = event.event_date_start ? new Date(event.event_date_start) : null;
  const end = event.event_date_end ? new Date(event.event_date_end) : start;
  if (!start) return false;
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDate = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : startDate;
  return todayDate >= startDate && todayDate <= endDate;
}

async function confirmStartOver() {
  const eventName = eventNickname() || 'this event';
  const first = await showConfirmModal({
    title: 'start over',
    message: `Delete all saved divisions, draws, draw results, and live schedules for "${eventName}"? This cannot be undone and may undo a lot of work. Registration will not be changed.`,
    confirmLabel: 'delete everything',
    cancelLabel: 'cancel',
    danger: true
  });
  if (!first) return false;
  if (!isEventLiveToday()) return true;
  return showConfirmModal({
    title: 'LIVE EVENT \u2014 FINAL WARNING',
    message: `This event is happening TODAY. Deleting draws and results while scoring is live cannot be undone. All scoring data for "${eventName}" will be permanently lost.`,
    confirmLabel: 'I understand \u2014 delete everything',
    cancelLabel: 'cancel',
    danger: true,
    liveWarning: true
  });
}

async function startOver() {
  if (!state.eventId) {
    flashMissingEventSelect();
    return;
  }
  const ok = await confirmStartOver();
    if (!ok) return;
  try {
    await apiFetch(`/api/division-advanced/events/${state.eventId}/profile-files`, {
      method: 'DELETE'
    });
    writeSoloCombinedFlag(false);
    writeSavedTemplateName('');
    resetSessionData();
    renderDivisionsTable();
    renderDraws();
    await loadTemplates();
    showToast('divisions, draws, results, and schedules removed. start from the beginning.');
    notifyPortalDataUpdated({ eventId: state.eventId, deleted: true });
    await refreshWheelFromStatus();
  } catch (err) {
    showToast(err.message || 'unable to start over.', true);
  }
}

async function saveDivisionsAndContinue() {
  const count = await saveDivisionsForEvent(state.leaves);
  showToast(`saved ${count} divisions for this event.`);
  await refreshWheelFromStatus();
}

async function regenerateDrawsSession({ silent = false } = {}) {
  const eventId = requireEvent();
  if (!state.drawsState) throw new Error('no draws to save.');
  const saved = await apiFetch(`/api/division-advanced/events/${eventId}/draws/regenerate`, {
    method: 'POST',
    body: JSON.stringify({ state: state.drawsState })
  });
  state.drawsState = saved.state || state.drawsState;
  state.drawDirty = false;
  state.selectedAthleteIndices = new Set();
  renderDraws();
  notifyPortalDataUpdated({ eventId });
  if (!silent) showToast('draws saved.');
}

async function ensureDrawsLoadedForEvent() {
  if (state.drawsState) return;
  await loadSavedForEvent();
  if (!state.drawsState) {
    state.drawsState = { format_version: 1, catalog: [] };
  }
}

async function downloadEventDrawPdfs() {
  const eventId = requireEvent();
  const res = await fetch(
    `/api/division-advanced/events/${encodeURIComponent(eventId)}/draws/pdfs.zip`,
    { credentials: 'same-origin' }
  );
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'unable to download PDFs.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const header = res.headers.get('Content-Disposition') || '';
  const headerMatch = header.match(/filename="([^"]+)"/i);
  if (headerMatch?.[1]) {
    a.download = headerMatch[1];
  } else {
    const rawName = eventNickname() || `event_${eventId}_draws`;
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

function bindEventSelect() {
  const select = document.getElementById('eventSelect');
  select?.addEventListener('change', async (e) => {
    state.eventId = e.target.value;
    if (state.eventId) rememberPortalEventId(state.eventId);
    resetSessionData();
    renderDivisionsTable();
    renderDraws();
    if (!state.eventId) {
      await refreshWheelFromStatus();
      return;
    }
    setWheelPhase('pick');
    setPrompt('loading event…');
    try {
      await withRingWorking(
        async () => {
          await loadSavedForEvent();
          await refreshWheelFromStatus();
        },
        { from: 0, ceiling: 24, prompt: 'loading event…' }
      );
    } catch (err) {
      showToast(err.message || 'unable to load event data.', true);
      setWheelPhase('choose');
    }
  });
}

function bindWheelActions() {
  document.getElementById('useDefaultDivisionsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('useDefaultDivisionsBtn');
    if (!state.eventId) {
      flashMissingEventSelect();
      return;
    }
    setBusy(btn, true);
    try {
      await withRingWorking(
        async () => {
          requireEvent();
          const data = await apiFetch('/api/division-advanced/divisions/create-all-defaults', {
            method: 'POST'
          });
          state.leaves = data.leaves || [];
          applyDescriptiveDivisionNames(state.leaves);
          if (data.failures?.length) showToast(`skipped: ${data.failures.join(', ')}`, true);
          const count = await saveDivisionsForEvent(state.leaves);
          showToast(`saved ${count} default divisions for this event.`);
          await refreshWheelFromStatus();
        },
        { from: 28, ceiling: 60, prompt: 'building default divisions…' }
      );
    } catch (err) {
      showToast(err.message, true);
      setWheelPhase('choose');
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('customizeDivisionsBtn')?.addEventListener('click', async () => {
    if (!state.eventId) {
      flashMissingEventSelect();
      return;
    }
    state.divisionMode = 'custom';
    try {
      if (!state.leaves.length) await loadSavedForEvent();
    } catch (_) { /* ignore */ }
    renderDivisionsTable();
    showScreen('divisions');
  });

  document.getElementById('wheelTemplateToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTemplatePicker();
  });

  document.getElementById('wheelTemplateMenu')?.addEventListener('click', async (e) => {
    const item = e.target.closest('li[data-id]');
    if (!item) return;
    const id = item.dataset.id;
    const name = item.dataset.name || 'template';
    closeTemplatePicker();
    if (!id) return;
    if (!state.eventId) {
      flashMissingEventSelect();
      return;
    }
    const toggle = document.getElementById('wheelTemplateToggle');
    if (toggle) toggle.disabled = true;
    try {
      await withRingWorking(
        async () => {
          const data = await apiFetch(`/api/division-advanced/divisions/templates/${id}`);
          state.leaves = fillMissingDescriptiveDivisionNames(data.leaves || []);
          if (!state.leaves.length) throw new Error('that template has no divisions.');
          await saveDivisionsForEvent(state.leaves);
          renderDivisionsTable();
          showToast(`loaded template "${data.nickname || name}" for this event.`);
          await refreshWheelFromStatus();
        },
        { from: 28, ceiling: 60, prompt: 'loading template…' }
      );
    } catch (err) {
      showToast(err.message, true);
      setWheelPhase('choose');
    } finally {
      if (toggle) toggle.disabled = false;
    }
  });

  document.getElementById('wheelTemplateMenu')?.addEventListener('contextmenu', async (e) => {
    const item = e.target.closest('li[data-id]');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    const id = item.dataset.id;
    const name = item.dataset.name || 'this template';
    if (!id) return;
    const ok = await showConfirmModal({
      title: 'delete template',
      message: `Delete division template "${name}"? This cannot be undone.`,
      confirmLabel: 'delete',
      danger: true
    });
    if (!ok) return;
    try {
      await deleteDivisionTemplate(id);
      showToast(`deleted template "${name}".`);
    } catch (err) {
      showToast(err.message || 'unable to delete template.', true);
    }
  });

  document.addEventListener('click', (e) => {
    const picker = document.getElementById('wheelTemplatePicker');
    if (picker && !picker.contains(e.target)) closeTemplatePicker();
  });

  document.getElementById('createDrawsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('createDrawsBtn');
    if (!state.eventId) {
      flashMissingEventSelect();
    return;
  }
    setBusy(btn, true);
    try {
      await withRingWorking(
        async () => {
          const saved = await apiFetch(
            `/api/division-advanced/events/${state.eventId}/draws/create-from-divisions`,
            {
              method: 'POST',
              body: JSON.stringify({ leaves: state.leaves })
            }
          );
          state.drawsState = saved.state || null;
          state.drawDirty = false;
          state.selectedAthleteIndices = new Set();
          state.drawSubtab = 'pool';
          state.soloDivisionsCombined = false;
          writeSoloCombinedFlag(false);
          renderDraws();
          showToast('draws created and saved.');
          notifyPortalDataUpdated({ eventId: state.eventId });
          await refreshWheelFromStatus();
        },
        { from: 64, ceiling: 96, prompt: 'creating draws…' }
      );
    } catch (err) {
      showToast(err.message, true);
      setWheelPhase('ready');
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('backToDivisionsChoiceBtn')?.addEventListener('click', () => {
    setWheelPhase('choose');
  });

  document.getElementById('modifyDrawsBtn')?.addEventListener('click', async () => {
    if (!state.drawsState) {
      try {
        await loadSavedForEvent();
      } catch (err) {
        showToast(err.message, true);
        return;
      }
    }
    state.drawSubtab = 'pool';
    switchDrawSubtab('pool');
    renderDraws();
    showScreen('draws');
  });

  document.getElementById('downloadDrawPdfsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('downloadDrawPdfsBtn');
    if (!state.eventId) {
      flashMissingEventSelect();
      return;
    }
    setBusy(btn, true);
    try {
      await downloadEventDrawPdfs();
      showToast('draw PDFs downloaded.');
    } catch (err) {
      showToast(err.message || 'unable to download PDFs.', true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('saveDivisionTemplateBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveDivisionTemplateBtn');
    if (state.savedDivisionTemplateName || readSavedTemplateName()) {
      syncSaveDivisionTemplateButton();
      return;
    }
    if (!state.eventId) {
      flashMissingEventSelect();
      return;
    }
    setBusy(btn, true);
    try {
      if (!state.leaves.length) {
        await loadEventTemplateLeaves();
      }
      if (!state.leaves.length) {
        throw new Error('no divisions available to save as a template.');
      }
      const nickname = await showPromptModal({
        title: 'save division template',
        message: 'enter a name for this division template.',
        confirmLabel: 'save',
        cancelLabel: 'cancel',
        placeholder: 'e.g. spring open defaults'
      });
      if (!nickname) return;
      const name = await saveNamedDivisionTemplate(nickname, state.leaves);
      markDivisionTemplateSaved(name);
      showToast(`division template "${name}" saved.`);
    } catch (err) {
      showToast(err.message || 'unable to save division template.', true);
    } finally {
      setBusy(btn, false);
      syncSaveDivisionTemplateButton();
    }
  });

  document.getElementById('combineSoloDrawsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('combineSoloDrawsBtn');
    if (state.soloDivisionsCombined || readSoloCombinedFlag() || countSoloDivisions() === 0) {
      syncCombineSoloButton();
      return;
    }
    if (!state.eventId) {
      flashMissingEventSelect();
      return;
    }
      setBusy(btn, true);
      try {
      if (!state.drawsState) {
        await loadSavedForEvent();
      } else if (!(state.leaves || []).length) {
        try {
          await loadEventTemplateLeaves();
        } catch (_) { /* recommendations still work without leaves */ }
      }
      if (!state.drawsState?.catalog?.length) {
        throw new Error('no draws available to combine.');
      }

      const { merged, remaining } = combineSoloDivisionsLocally();
      if (merged > 0) {
        await regenerateDrawsSession({ silent: true });
      }
      markCombineSoloButtonDone();

      if (!merged && !remaining) {
        showToast('no solo divisions found.');
      } else if (!merged && remaining) {
        showToast(
          `${remaining} solo division${remaining === 1 ? '' : 's'} could not be combined (no suitable target).`,
          true
        );
      } else if (remaining) {
        showToast(
          `combined ${merged} solo division${merged === 1 ? '' : 's'}; ${remaining} still remain without a suitable target.`
        );
      } else {
        showToast(
          `combined ${merged} solo division${merged === 1 ? '' : 's'} into recommended draws.`
        );
      }
      } catch (err) {
      showToast(err.message || 'unable to combine solo divisions.', true);
      } finally {
        setBusy(btn, false);
      syncCombineSoloButton();
      }
    });

  ['startOverReadyBtn', 'startOverCompleteBtn', 'startOverDivisionsBtn', 'startOverDrawsBtn']
    .forEach((id) => {
      document.getElementById(id)?.addEventListener('click', () => {
        startOver().catch((err) => showToast(err.message, true));
  });
    });
}

function bindDivisions() {
  document.getElementById('divisionNameSearch')?.addEventListener('input', (e) => {
    setDivisionNameQuery(e.target.value || '');
  });

  document.getElementById('generatePatternBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('generatePatternBtn');
    setBusy(btn, true);
    try {
      const payload = collectPatternFormPayload();
      const data = await apiFetch('/api/division-advanced/divisions/generate-pattern', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const added = (data.leaves || []).map((leaf) => ({
        ...leaf,
        division_name: divisionTitleFromSpec(leaf)
      }));
      state.leaves = [...state.leaves, ...added];
      renderDivisionsTable();
      showToast(`added ${added.length} division leaves.`);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('simplifyDivisionNamesBtn')?.addEventListener('click', async () => {
    if (!state.leaves.length) {
      showToast('no divisions to rename.', true);
      return;
    }
    const ok = await showConfirmModal({
      title: 'simplified division names',
      message: 'rename all divisions to short codes by event (P1, S2, TS3, etc.)? this replaces current division names.',
      confirmLabel: 'rename'
    });
    if (!ok) return;
    const count = applySimplifiedDivisionNames();
    renderDivisionsTable();
    showToast(`renamed ${count} division${count === 1 ? '' : 's'}.`);
  });

  document.querySelector('#divisionsTable tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.da-division-remove-btn');
    if (!btn) return;
    const leafIndex = Number(btn.getAttribute('data-leaf-index'));
    removeLeafAtIndex(leafIndex);
  });

  document.querySelector('#divisionsTable tbody')?.addEventListener('change', (e) => {
    const input = e.target.closest('.da-division-name-input');
    if (!input) return;
    const leafIndex = Number(input.getAttribute('data-leaf-index'));
    const previous = state.leaves[leafIndex]?.division_name || '';
    if (!setLeafDivisionName(leafIndex, input.value)) {
      input.value = previous;
      showToast('division name cannot be empty.', true);
      return;
    }
    input.value = state.leaves[leafIndex].division_name;
  });

  document.querySelector('#divisionsTable tbody')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('.da-division-name-input');
    if (!input) return;
    e.preventDefault();
    input.blur();
  });

  document.getElementById('clearDivisionsBtn')?.addEventListener('click', async () => {
    if (!state.leaves.length) return showToast('divisions already empty.');
    const ok = await showConfirmModal({
      title: 'clear divisions',
      message: 'clear all division leaves from this session?',
      confirmLabel: 'clear'
    });
    if (!ok) return;
    state.leaves = [];
    renderDivisionsTable();
    showToast('divisions cleared.');
  });

  document.getElementById('saveDivisionsContinueBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveDivisionsContinueBtn');
    setBusy(btn, true);
    try {
      if (!state.leaves.length) throw new Error('create or load divisions first.');
      await saveDivisionsAndContinue();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });
}

function bindDraws() {
  document.getElementById('saveDrawsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveDrawsBtn');
    if (!state.drawDirty) return;
    const ok = await showConfirmModal({
      title: 'save draws',
      message: "save your draw changes? athlete moves will regenerate affected draws; placement edits will be kept.",
      confirmLabel: 'save',
      cancelLabel: 'cancel'
    });
    if (!ok) return;
    setBusy(btn, true);
    try {
      await regenerateDrawsSession();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setBusy(btn, false);
    }
  });

  document.querySelector('#drawsTable tbody')?.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    state.selectedDrawId = row.dataset.id;
    state.selectedAthleteIndices = new Set();
    renderDraws();
  });

  function hideDrawsAthletesMenu() {
    const menu = document.getElementById('daDrawsAthletesMenu');
    if (menu) menu.hidden = true;
  }

  function showDrawsAthletesMenu(clientX, clientY) {
    const menu = document.getElementById('daDrawsAthletesMenu');
    if (!menu) return;
    const filterSoloBtn = menu.querySelector('[data-action="filter-solo"]');
    const showAllBtn = menu.querySelector('[data-action="show-all"]');
    if (filterSoloBtn) filterSoloBtn.hidden = Boolean(state.filterDrawsToSolo);
    if (showAllBtn) showAllBtn.hidden = !state.filterDrawsToSolo;
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.hidden = false;
    const pad = 8;
    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  document.getElementById('drawsAthletesHeader')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showDrawsAthletesMenu(e.clientX, e.clientY);
  });

  document.getElementById('daDrawsAthletesMenu')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    hideDrawsAthletesMenu();
    if (action === 'filter-solo') {
      state.filterDrawsToSolo = true;
      renderDraws();
    } else if (action === 'show-all') {
      state.filterDrawsToSolo = false;
      renderDraws();
    }
  });

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('daDrawsAthletesMenu');
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target)) return;
    hideDrawsAthletesMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideDrawsAthletesMenu();
  });

  window.addEventListener('scroll', hideDrawsAthletesMenu, true);
  window.addEventListener('resize', hideDrawsAthletesMenu);

  document.getElementById('drawAthletesList')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-index]');
    if (!chip || chip.dataset.index === '') return;
    const idx = Number(chip.dataset.index);
    if (Number.isNaN(idx)) return;
    if (state.selectedAthleteIndices.has(idx)) state.selectedAthleteIndices.delete(idx);
    else state.selectedAthleteIndices.add(idx);
    renderDraws();
  });

  document.getElementById('drawMoveTargetSelect')?.addEventListener('change', (e) => {
    state.targetGroupingId = e.target.value;
    renderDraws();
  });

  document.getElementById('drawMoveArrowBtn')?.addEventListener('click', () => {
    try {
      moveSelectedAthletesLocally();
      renderDraws();
      showToast('athletes moved (save to regenerate).');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.querySelectorAll('#tab-draws .da-subtab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      switchDrawSubtab(btn.dataset.subtab);
      await renderDrawPreviewPanels(selectedDrawEntry());
    });
  });
}

/**
 * Leave modify-draws back to the wheel (same as former Back button).
 * @returns {Promise<boolean>} false if user cancelled due to unsaved changes
 */
async function leaveDrawsScreen() {
  if (state.drawDirty) {
    const ok = await showConfirmModal({
      title: 'unsaved changes',
      message: 'you have unsaved draw changes. leave without saving?',
      confirmLabel: 'leave',
      cancelLabel: 'stay',
      danger: true
    });
    if (!ok) return false;
    try {
      await loadSavedForEvent();
      state.drawDirty = false;
      state.selectedAthleteIndices = new Set();
    } catch (_) { /* ignore */ }
  }
  await refreshWheelFromStatus();
  return true;
}

function bindEmbedCloseAsBack() {
  if (!document.documentElement.classList.contains('da-embed')) return;
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== 'da-close-request') return;
    const requestId = event.data.id;
    const reply = (handled) => {
      event.source?.postMessage(
        { type: 'da-close-response', id: requestId, handled: Boolean(handled) },
        event.origin
      );
    };
    if (state.screen === 'divisions') {
      refreshWheelFromStatus()
        .then(() => reply(true))
        .catch(() => reply(false));
      return;
    }
    if (state.screen === 'draws') {
      leaveDrawsScreen()
        .then(() => reply(true))
        .catch(() => reply(true));
      return;
    }
    reply(false);
  });
}

async function init() {
  logInteraction('page_view', { description: 'Advanced division creation page loaded' });
  bindEmbedCloseAsBack();
  try {
    await loadEvents();
  } catch (err) {
    showToast(err?.message || 'Unable to load your events. Please try again.', true);
  }

  try {
  const profile = await apiFetch('/api/profile');
    if (!(await applyProfile(profile))) {
      showToast('advanced division tool access required.', true);
      return;
    }
  bindEventSelect();
    bindWheelActions();
    initCustomDivisionFeature({
      ensureDrawsLoaded: ensureDrawsLoadedForEvent,
      regenerateDraws: async () => {
        await regenerateDrawsSession({ silent: true });
        renderDraws();
      }
    });
  bindPatternForm();
  bindDivisions();
  bindDraws();
    try {
      await initPatternForm();
    } catch (err) {
      showToast(err?.message || 'pattern form failed to load.', true);
    }
    try {
  await loadTemplates();
    } catch (_) { /* ignore */ }
  renderDivisionsTable();
  renderDraws();
    await refreshWheelFromStatus();
  } catch (err) {
    try {
      showToast(err?.message || 'unable to load draw creation.', true);
    } catch (_) { /* ignore */ }
    if (!document.documentElement.classList.contains('da-embed')) {
      window.location.href = '/landing';
    }
  }
}

init();
