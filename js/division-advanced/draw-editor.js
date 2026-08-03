import { apiFetch } from './api.js';
import { showConfirmModal, showToast } from './ui.js';

let dragSourceId = null;
let onEdited = null;

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function setDrawEditorCallback(cb) {
  onEdited = cb;
}

function bindSlotDrag(root, entry) {
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
        const data = await apiFetch('/api/division-advanced/draws/edit', {
          method: 'POST',
          body: JSON.stringify({
            action: 'swap',
            entry,
            sourceSlotId: sourceId,
            targetSlotId: targetId
          })
        });
        if (onEdited) onEdited(data.entry, data.slots, true);
      } catch (err) {
        showToast(err.message || 'could not swap slots.', true);
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
  bindSlotDrag(editor, entry);
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
    <div class="da-slot-card" style="cursor:default">
      <div class="da-slot-card-title">${escapeHtml(pair[0]?.match_title || 'Match')}</div>
      ${pair.map((s) => `
        <div class="da-slot-side da-slot-card ${s.empty ? 'empty' : ''}" data-slot-id="${escapeHtml(s.slot_id)}" style="margin:4px 0;border-width:1px">
          <span class="da-slot-side-label">${escapeHtml(s.side_label || '')}</span>${escapeHtml(s.display)}
        </div>
      `).join('')}
    </div>
  `).join('')}</div>`;
  bindSlotDrag(editor, entry);
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
      <span>Drag athletes between pool slots (2–5 filled per pool).</span>
    </div>
    <div class="da-pl-pools">
      ${Object.entries(pools).map(([name, members]) => `
        <div class="da-pl-pool">
          <h4>${escapeHtml(name)}</h4>
          ${members.map((s) => `
            <div class="da-slot-card ${s.empty ? 'empty' : ''}" data-slot-id="${escapeHtml(s.slot_id)}">
              <div class="da-slot-side">${escapeHtml(s.stacked_name || s.display)}</div>
              ${s.stacked_club ? `<div class="da-slot-side" style="color:#666;font-size:11px">${escapeHtml(s.stacked_club)}</div>` : ''}
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
  bindSlotDrag(editor, entry);
}

export function renderInteractiveEditor(entry, slots) {
  const editor = document.getElementById('drawInteractiveEditor');
  const hint = document.getElementById('drawEditHint');
  if (!editor) return;
  if (!entry) {
    editor.innerHTML = '<p style="color:#555">select a division to edit.</p>';
    if (hint) hint.textContent = 'drag rows to edit draws. use save draws to persist to the database.';
    return;
  }
  const type = String(entry.division_type || entry.json_data?.division_type || '').trim();
  if (type === 'List') {
    editor.innerHTML = '<p style="color:#555">not applicable for this draw type.</p>';
    if (hint) hint.textContent = 'list draws are not interactively editable.';
    return;
  }
  if (!entry.json_data) {
    editor.innerHTML = '<p style="color:#555">no interactive draw data for this division.</p>';
    return;
  }
  const slotList = slots || entry._draw_slot_list || [];
  if (type === 'Round Robin') {
    if (hint) hint.textContent = 'drag match cards to reorder the round robin schedule.';
    renderRoundRobin(editor, entry, slotList);
  } else if (type === 'Single Elimination') {
    if (hint) hint.textContent = 'drag athletes between first-round bracket slots (including BYE slots).';
    renderSingleElim(editor, entry, slotList);
  } else if (type === 'Premier League') {
    if (hint) hint.textContent = 'drag athletes between pool slots. change pool count to re-assign.';
    renderPremierLeague(editor, entry, slotList);
  } else {
    editor.innerHTML = '<p style="color:#555">unsupported draw type for interactive edit.</p>';
  }
}

export async function loadSlotsForEntry(entry) {
  if (!entry?.json_data) return [];
  const data = await apiFetch('/api/division-advanced/draws/edit', {
    method: 'POST',
    body: JSON.stringify({ action: 'refresh', entry })
  });
  return data;
}

export async function loadPdfPreview(entry) {
  const frame = document.getElementById('drawPdfPreview');
  const hint = document.getElementById('drawPdfHint');
  if (!frame) return;
  if (!entry || !(entry.athlete_count > 0)) {
    if (frame.src && frame.src.startsWith('blob:')) URL.revokeObjectURL(frame.src);
    frame.removeAttribute('src');
    frame.hidden = true;
    if (hint) {
      hint.hidden = false;
      hint.textContent = 'select a division with athletes to preview the PDF.';
    }
    return;
  }
  const res = await fetch('/api/division-advanced/draws/preview.pdf', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'PDF preview failed');
  }
  const blob = await res.blob();
  if (frame.src && frame.src.startsWith('blob:')) URL.revokeObjectURL(frame.src);
  frame.src = URL.createObjectURL(blob);
  frame.hidden = false;
  if (hint) hint.hidden = true;
}
