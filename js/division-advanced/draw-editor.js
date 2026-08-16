import { apiFetch } from './api.js';
import { showConfirmModal, showToast } from './ui.js';
import { state } from './state.js';
import { getPatternMeta } from './pattern-form.js';

let dragSourceId = null;
let selectedSlotId = null;
let onEdited = null;
let typeSelectBound = false;
let suppressTypeChange = false;

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isBreakingEventKey(eventKey) {
  const keys = getPatternMeta()?.listDrawTypeEventKeys;
  const list = Array.isArray(keys) && keys.length
    ? keys
    : [
      'individual_special_technique',
      'individual_power_test',
      'team_special_technique',
      'team_power_test'
    ];
  return list.includes(String(eventKey || '').trim());
}

function drawTypeOptions() {
  return getPatternMeta()?.drawTypeOptions || [
    'Single Elimination',
    'Round Robin',
    'Premier League',
    'List'
  ];
}

function syncDrawTypeSelect(entry) {
  const bar = document.getElementById('drawEditTypeBar');
  const select = document.getElementById('drawEditTypeSelect');
  if (!bar || !select) return;

  if (!entry) {
    bar.hidden = true;
    select.disabled = true;
    select.innerHTML = '';
    return;
  }

  bar.hidden = false;
  const current = String(entry.division_type || entry.json_data?.division_type || '').trim();
  const options = drawTypeOptions();
  suppressTypeChange = true;
  select.innerHTML = options.map((opt) => (
    `<option value="${escapeHtml(opt)}"${opt === current ? ' selected' : ''}>${escapeHtml(opt)}</option>`
  )).join('');
  if (current && !options.includes(current)) {
    select.insertAdjacentHTML(
      'afterbegin',
      `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`
    );
  }
  select.disabled = false;
  suppressTypeChange = false;
  ensureTypeSelectBound();
}

async function confirmDrawTypeMismatch(entry, nextType) {
  const ek = String(entry.event_key || '').trim();
  const breaking = isBreakingEventKey(ek);
  if (nextType === 'List' && !breaking) {
    return showConfirmModal({
      title: 'use list draw?',
      message:
        'List is normally used for breaking divisions (power test / special technique). '
        + 'Use List for this division anyway? The bracket will be rebuilt.',
      confirmLabel: 'use list'
    });
  }
  if (nextType !== 'List' && breaking) {
    return showConfirmModal({
      title: 'change breaking draw type?',
      message:
        'Breaking divisions (power test / special technique) normally use List. '
        + `Switch this division to ${nextType} anyway? The draw will be rebuilt.`,
      confirmLabel: 'change type'
    });
  }
  return showConfirmModal({
    title: 'change draw type',
    message: `Change this division to ${nextType}? Placements will be rebuilt from the athlete list.`,
    confirmLabel: 'change type'
  });
}

async function applyDrawTypeChange(entry, nextType) {
  const data = await apiFetch('/api/division-advanced/draws/edit', {
    method: 'POST',
    body: JSON.stringify({
      action: 'set_type',
      entry,
      drawType: nextType
    })
  });
  if (onEdited) onEdited(data.entry, data.slots, true);
}

function ensureTypeSelectBound() {
  if (typeSelectBound) return;
  const select = document.getElementById('drawEditTypeSelect');
  if (!select) return;
  typeSelectBound = true;
  select.addEventListener('change', async () => {
    if (suppressTypeChange) return;
    const catalog = state.drawsState?.catalog || [];
    const entry = catalog.find((e) => e.id === state.selectedDrawId);
    if (!entry) {
      syncDrawTypeSelect(null);
      return;
    }
    const previous = String(entry.division_type || entry.json_data?.division_type || '').trim();
    const nextType = select.value;
    if (!nextType || nextType === previous) return;

    const ok = await confirmDrawTypeMismatch(entry, nextType);
    if (!ok) {
      suppressTypeChange = true;
      select.value = previous;
      suppressTypeChange = false;
      return;
    }

    try {
      await applyDrawTypeChange(entry, nextType);
    } catch (err) {
      suppressTypeChange = true;
      select.value = previous;
      suppressTypeChange = false;
      showToast(err.message || 'could not change draw type.', true);
    }
  });
}

export function setDrawEditorCallback(cb) {
  onEdited = cb;
}

function clearSlotSelection(root) {
  selectedSlotId = null;
  root?.querySelectorAll('.da-slot-selected').forEach((el) => el.classList.remove('da-slot-selected'));
}

async function swapSlots(entry, sourceSlotId, targetSlotId) {
  const data = await apiFetch('/api/division-advanced/draws/edit', {
    method: 'POST',
    body: JSON.stringify({
      action: 'swap',
      entry,
      sourceSlotId,
      targetSlotId
    })
  });
  if (onEdited) onEdited(data.entry, data.slots, true);
}

function bindMatchDrag(root, entry) {
  root.querySelectorAll('[data-slot-id]').forEach((el) => {
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      dragSourceId = el.dataset.slotId;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSourceId);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      root.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
      dragSourceId = null;
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const targetId = el.dataset.slotId;
      const sourceId = dragSourceId || e.dataTransfer.getData('text/plain');
      if (!sourceId || !targetId || sourceId === targetId) return;
      try {
        await swapSlots(entry, sourceId, targetId);
      } catch (err) {
        showToast(err.message || 'could not reorder matches.', true);
      }
    });
  });
}

/**
 * Click an athlete, then click another athlete/BYE/empty slot to swap.
 */
function bindClickSwap(root, entry, { allowEmptyFirst = false } = {}) {
  root.querySelectorAll('[data-slot-id]').forEach((el) => {
    el.classList.add('da-slot-clickable');
    el.addEventListener('click', async () => {
      const id = el.dataset.slotId;
      if (!id) return;

      if (!selectedSlotId) {
        if (!allowEmptyFirst && el.classList.contains('empty')) {
          showToast('select an athlete first.', true);
          return;
        }
        selectedSlotId = id;
        el.classList.add('da-slot-selected');
        return;
      }

      if (selectedSlotId === id) {
        clearSlotSelection(root);
        return;
      }

      const sourceId = selectedSlotId;
      clearSlotSelection(root);
      try {
        await swapSlots(entry, sourceId, id);
      } catch (err) {
        showToast(err.message || 'could not swap places.', true);
      }
    });
  });
}

function renderRoundRobin(editor, entry, slots) {
  const matches = slots.filter((s) => s.kind === 'rr_match_order');
  editor.innerHTML = `<div class="da-rr-grid">${matches.map((s) => `
    <div class="da-slot-card" data-slot-id="${escapeHtml(s.slot_id)}">
      <div class="da-slot-card-title">${escapeHtml(s.match_title)}</div>
      <div class="da-slot-side"><span class="da-slot-side-label">Red</span>${escapeHtml(s.aka_display)}</div>
      <div class="da-slot-side"><span class="da-slot-side-label">Blue</span>${escapeHtml(s.ao_display)}</div>
    </div>
  `).join('')}</div>`;
  bindMatchDrag(editor, entry);
}

function renderSingleElim(editor, entry, slots) {
  const seSlots = slots.filter((s) => s.kind === 'se_placement');
  const groups = {};
  seSlots.forEach((s) => {
    const key = s.match_group || 'match';
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });
  editor.innerHTML = `<div class="da-se-list">${Object.values(groups).map((pair) => `
    <div class="da-slot-card da-slot-card-static">
      <div class="da-slot-card-title">${escapeHtml(pair[0]?.match_title || 'Match')}</div>
      ${pair.map((s) => `
        <div class="da-slot-side da-slot-pick ${s.empty ? 'empty' : ''}" data-slot-id="${escapeHtml(s.slot_id)}">
          <span class="da-slot-side-label">${escapeHtml(s.side_label || '')}</span>${escapeHtml(s.display)}
        </div>
      `).join('')}
    </div>
  `).join('')}</div>`;
  bindClickSwap(editor, entry, { allowEmptyFirst: false });
}

function renderPremierLeague(editor, entry, slots) {
  const pools = {};
  let currentPool = null;
  slots.forEach((s) => {
    if (s.kind === 'section' || s.section) {
      currentPool = s.section || s.display;
      pools[currentPool] = [];
      return;
    }
    if (s.kind === 'pl_roster' && currentPool != null) {
      pools[currentPool].push(s);
    }
  });
  const poolCount = Object.keys(pools).length;
  editor.innerHTML = `
    <div class="da-pl-pool-controls">
      <span>Number of pools:</span>
      ${[2, 4, 8].map((c) => `
        <button type="button" class="da-btn" data-pool-count="${c}" ${c === poolCount ? 'disabled' : ''}>${c}</button>
      `).join('')}
      <span>select an athlete, then another athlete or empty slot (2–5 per pool).</span>
    </div>
    <div class="da-pl-pools">
      ${Object.entries(pools).map(([name, members]) => `
        <div class="da-pl-pool">
          <h4>${escapeHtml(name)}</h4>
          ${members.map((s) => `
            <div class="da-slot-card da-slot-pick ${s.empty ? 'empty' : ''}" data-slot-id="${escapeHtml(s.slot_id)}">
              <div class="da-slot-side">${escapeHtml(s.stacked_name || s.display)}</div>
              ${s.stacked_club ? `<div class="da-slot-side da-slot-club">${escapeHtml(s.stacked_club)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;
  editor.querySelectorAll('[data-pool-count]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const count = Number(btn.dataset.poolCount);
      const ok = await showConfirmModal({
        title: 'change pool count',
        message: `set this division to ${count} pools? all athletes will be re-assigned across pools.`,
        confirmLabel: 'change pools'
      });
      if (!ok) return;
      try {
        const data = await apiFetch('/api/division-advanced/draws/edit', {
          method: 'POST',
          body: JSON.stringify({ action: 'set_pool_count', entry, poolCount: count })
        });
        if (onEdited) onEdited(data.entry, data.slots, true);
      } catch (err) {
        showToast(err.message || 'could not change pool count.', true);
      }
    });
  });
  bindClickSwap(editor, entry, { allowEmptyFirst: false });
}

export function renderInteractiveEditor(entry, slots) {
  const editor = document.getElementById('drawInteractiveEditor');
  const hint = document.getElementById('drawEditHint');
  clearSlotSelection(editor);
  syncDrawTypeSelect(entry);
  if (!editor) return;

  if (!entry) {
    editor.innerHTML = '<p class="da-hint">select a draw to edit.</p>';
    if (hint) hint.textContent = 'choose a draw from the list to edit placements.';
    return;
  }

  const type = String(entry.division_type || entry.json_data?.division_type || '').trim();
  if (type === 'List') {
    editor.innerHTML = '<p class="da-hint">list draws are not interactively editable. change the draw type above to rebuild a bracket.</p>';
    if (hint) hint.textContent = 'list draws have no bracket or match order to edit.';
    return;
  }
  if (!entry.json_data) {
    editor.innerHTML = '<p class="da-hint">no interactive draw data for this division.</p>';
    if (hint) hint.textContent = 'save after moving athletes to regenerate draw structure first.';
    return;
  }

  const slotList = slots || entry._draw_slot_list || [];
  if (type === 'Round Robin') {
    if (hint) hint.textContent = 'drag match cards to reorder the round robin schedule. save to keep changes.';
    renderRoundRobin(editor, entry, slotList);
  } else if (type === 'Single Elimination') {
    if (hint) hint.textContent = 'select an athlete, then select another athlete or BYE to swap places. save to keep changes.';
    renderSingleElim(editor, entry, slotList);
  } else if (type === 'Premier League') {
    if (hint) hint.textContent = 'select an athlete, then another athlete or empty pool slot (2–5 per pool). elimination is rebuilt from pools. save to keep changes.';
    renderPremierLeague(editor, entry, slotList);
  } else {
    editor.innerHTML = '<p class="da-hint">unsupported draw type for interactive edit.</p>';
    if (hint) hint.textContent = '';
  }
}

export async function loadSlotsForEntry(entry) {
  if (!entry?.json_data) return { entry, slots: [] };
  const data = await apiFetch('/api/division-advanced/draws/edit', {
    method: 'POST',
    body: JSON.stringify({ action: 'refresh', entry })
  });
  return data;
}

export function applyEditedEntryToState(updatedEntry, slots) {
  if (!updatedEntry || !state.drawsState?.catalog) return null;
  const catalog = state.drawsState.catalog;
  const idx = catalog.findIndex((e) => String(e.id) === String(updatedEntry.id));
  if (idx < 0) return null;
  const prev = catalog[idx];
  catalog[idx] = {
    ...prev,
    ...updatedEntry,
    json_data: updatedEntry.json_data,
    body_text: updatedEntry.body_text,
    division_type: updatedEntry.division_type || prev.division_type,
    _draw_slot_list: slots || updatedEntry._draw_slot_list || [],
    preserve_structure: true,
    athletes: updatedEntry.athletes || prev.athletes,
    athlete_indices: updatedEntry.athlete_indices || prev.athlete_indices,
    athlete_count: updatedEntry.athlete_count != null ? updatedEntry.athlete_count : prev.athlete_count
  };
  state.drawDirty = true;
  const next = catalog[idx];
  const typeCell = document.querySelector(
    `#drawsTable tbody tr[data-id="${CSS.escape(String(next.id))}"] td:nth-child(2)`
  );
  if (typeCell) typeCell.textContent = next.division_type || '';
  const saveDrawsBtn = document.getElementById('saveDrawsBtn');
  if (saveDrawsBtn) {
    saveDrawsBtn.disabled = !catalog.length || !state.drawDirty;
  }
  return next;
}
