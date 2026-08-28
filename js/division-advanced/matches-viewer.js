/**
 * Read-only pan/zoom matches viewer (combined_app division-viewer style).
 * Driven by portal draw catalog entry.json_data — no scoring edits.
 */

const MATCH_W = 280;
const MATCH_H = 118;
const H_GAP = 72;
const V_GAP = 28;
const PAD = 36;
const HEADER_H = 28;

let panX = 0;
let panY = 0;
let zoom = 1;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let panStartX = 0;
let panStartY = 0;
const DEFAULT_VIEWER_TARGETS = {
  viewportId: 'drawMatchesViewport',
  contentId: 'drawMatchesContent',
  hintId: 'drawMatchesHint',
  zoomInId: 'matchesZoomIn',
  zoomOutId: 'matchesZoomOut',
  zoomFitId: 'matchesZoomFit',
  emptyHint: 'select a draw to view.'
};
let viewerTargets = { ...DEFAULT_VIEWER_TARGETS };
const boundViewports = new Set();

function resolveViewerTargets(targets) {
  viewerTargets = { ...DEFAULT_VIEWER_TARGETS, ...(targets && typeof targets === 'object' ? targets : {}) };
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeType(entry) {
  const json = parseDrawJson(entry);
  const raw = String(entry?.division_type || json?.division_type || '').toLowerCase();
  if (raw.includes('single')) return 'se';
  if (raw.includes('round')) return 'rr';
  if (raw.includes('premier')) return 'pl';
  if (raw.includes('list')) return 'list';
  return '';
}

function sideLabel(side, athletesById) {
  if (!side || typeof side !== 'object') return { name: 'TBD', team: '' };
  if (side.bye) return { name: 'BYE', team: '' };
  if (side.competitor) {
    return {
      name: side.competitor.name || 'TBD',
      team: side.competitor.country_dirty || side.competitor.country || ''
    };
  }
  if (side.name) {
    return { name: side.name, team: side.country_dirty || side.country || '' };
  }
  if (side.source_match_id) {
    return { name: `Winner of ${side.source_match_id}`, team: '' };
  }
  if (side.match_id) {
    const kind = side.result === 'loser' ? 'Loser' : 'Winner';
    return { name: `${kind} of ${side.match_id}`, team: '' };
  }
  if (side.pool_id != null) {
    return { name: `${side.pool_id} #${side.pool_rank || 1}`, team: '' };
  }
  if (side.competitor_id != null && athletesById) {
    const a = athletesById.get(String(side.competitor_id));
    if (a) {
      return {
        name: a.name || 'TBD',
        team: a.country_dirty || a.country || a.team || ''
      };
    }
  }
  return { name: 'TBD', team: '' };
}

function matchBoxHtml(label, aka, ao) {
  return `
    <div class="mv-match-box">
      <div class="mv-match-label">${escapeHtml(label || '')}</div>
      <div class="mv-athletes">
        <div class="mv-athlete mv-red">
          <div class="mv-name">${escapeHtml(aka.name)}</div>
          ${aka.team ? `<div class="mv-team">${escapeHtml(aka.team)}</div>` : ''}
        </div>
        <div class="mv-athlete mv-blue">
          <div class="mv-name">${escapeHtml(ao.name)}</div>
          ${ao.team ? `<div class="mv-team">${escapeHtml(ao.team)}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function applyTransform() {
  const content = document.getElementById(viewerTargets.contentId);
  if (!content) return;
  content.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function setHint(text, show) {
  const hint = document.getElementById(viewerTargets.hintId);
  const viewport = document.getElementById(viewerTargets.viewportId);
  if (hint) {
    hint.textContent = text || '';
    hint.hidden = !show;
  }
  if (viewport) viewport.hidden = Boolean(show);
}

function fitToViewport(width, height) {
  const viewport = document.getElementById(viewerTargets.viewportId);
  if (!viewport || viewport.hidden || !width || !height) return;
  const vw = Math.max(120, viewport.clientWidth - 24);
  const vh = Math.max(120, viewport.clientHeight - 24);
  zoom = Math.min(1.2, Math.max(0.25, Math.min(vw / width, vh / height)));
  panX = (vw - width * zoom) / 2 + 8;
  panY = (vh - height * zoom) / 2 + 8;
  applyTransform();
}

function fitAfterLayout(width, height) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitToViewport(width, height));
  });
}

function parseDrawJson(entry) {
  let json = entry?.json_data;
  if (typeof json === 'string') {
    try { json = JSON.parse(json); } catch (_) { return null; }
  }
  return json && typeof json === 'object' ? json : null;
}

function entryHasAthletes(entry) {
  if (Number(entry?.athlete_count || 0) > 0) return true;
  if (Array.isArray(entry?.athletes) && entry.athletes.length) return true;
  return Array.isArray(entry?.athlete_indices) && entry.athlete_indices.length > 0;
}

function renderList(content, json) {
  const athletes = json.rows || json.athletes || json.competitors || [];
  const rows = athletes.map((a, i) => {
    const name = a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || '—';
    const team = a.team || a.country || a.club || '';
    return `<tr><td>${i + 1}</td><td>${escapeHtml(name)}</td><td>${escapeHtml(team)}</td></tr>`;
  }).join('');
  content.innerHTML = `
    <div class="mv-list-wrap">
      <table class="mv-list-table">
        <thead><tr><th>#</th><th>athlete</th><th>team</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">no athletes</td></tr>'}</tbody>
      </table>
    </div>
  `;
  const wrap = content.querySelector('.mv-list-wrap');
  fitAfterLayout(wrap?.offsetWidth || 400, wrap?.offsetHeight || 200);
}

function renderRoundRobin(content, json) {
  const matches = json.matches || [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(matches.length || 1)));
  const rows = Math.max(1, Math.ceil(matches.length / cols));
  const width = PAD * 2 + cols * MATCH_W + (cols - 1) * H_GAP;
  const height = PAD * 2 + rows * MATCH_H + (rows - 1) * V_GAP;
  const host = document.createElement('div');
  host.className = 'mv-bracket';
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  matches.forEach((m, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const el = document.createElement('div');
    el.className = 'mv-match-abs';
    el.style.left = `${PAD + col * (MATCH_W + H_GAP)}px`;
    el.style.top = `${PAD + row * (MATCH_H + V_GAP)}px`;
    el.style.width = `${MATCH_W}px`;
    el.style.height = `${MATCH_H}px`;
    el.innerHTML = matchBoxHtml(
      m.draw_label || `Match ${i + 1}`,
      sideLabel(m.aka),
      sideLabel(m.ao)
    );
    host.appendChild(el);
  });
  content.innerHTML = '';
  content.appendChild(host);
  fitAfterLayout(width, height);
}

function renderSingleElim(content, json) {
  const matches = json.matches || [];
  const rounds = [...(json.rounds || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const byRound = new Map();
  rounds.forEach((r) => byRound.set(r.round_id, []));
  matches.forEach((m) => {
    const key = m.round_id || 'R1';
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(m);
  });
  const roundIds = rounds.length
    ? rounds.map((r) => r.round_id)
    : [...byRound.keys()];
  const first = byRound.get(roundIds[0]) || matches;
  const positions = {};
  const width = PAD * 2 + roundIds.length * MATCH_W + Math.max(0, roundIds.length - 1) * H_GAP;
  const height = PAD * 2 + HEADER_H
    + Math.max(1, first.length) * MATCH_H
    + Math.max(0, first.length - 1) * V_GAP;

  roundIds.forEach((rid, col) => {
    const list = (byRound.get(rid) || []).slice().sort((a, b) => {
      const na = parseInt(String(a.match_id || '').replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(String(b.match_id || '').replace(/\D/g, ''), 10) || 0;
      return na - nb;
    });
    list.forEach((m, i) => {
      const id = m.match_id || `M${col}-${i}`;
      let y;
      if (col === 0) {
        y = PAD + HEADER_H + i * (MATCH_H + V_GAP);
      } else {
        const srcA = m.aka?.source_match_id;
        const srcB = m.ao?.source_match_id;
        const ya = positions[srcA]?.y;
        const yb = positions[srcB]?.y;
        if (ya != null && yb != null) y = (ya + yb) / 2;
        else if (ya != null) y = ya;
        else if (yb != null) y = yb;
        else y = PAD + HEADER_H + i * (MATCH_H + V_GAP);
      }
      positions[id] = {
        x: PAD + col * (MATCH_W + H_GAP),
        y,
        match: m,
        label: m.match_id || `Match ${i + 1}`
      };
    });
  });

  const host = document.createElement('div');
  host.className = 'mv-bracket';
  host.style.width = `${width}px`;
  host.style.height = `${Math.max(height, ...Object.values(positions).map((p) => p.y + MATCH_H + PAD))}px`;

  roundIds.forEach((rid, col) => {
    const round = rounds.find((r) => r.round_id === rid);
    const header = document.createElement('div');
    header.className = 'mv-round-header';
    header.style.left = `${PAD + col * (MATCH_W + H_GAP)}px`;
    header.style.top = `${PAD / 2}px`;
    header.style.width = `${MATCH_W}px`;
    header.textContent = round?.name || rid;
    host.appendChild(header);
  });

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'mv-connectors');
  svg.style.width = host.style.width;
  svg.style.height = host.style.height;

  Object.values(positions).forEach((pos) => {
    const m = pos.match;
    ['aka', 'ao'].forEach((side) => {
      const srcId = m[side]?.source_match_id;
      const src = srcId ? positions[srcId] : null;
      if (!src) return;
      const x1 = src.x + MATCH_W;
      const y1 = src.y + MATCH_H / 2;
      const x2 = pos.x;
      const y2 = pos.y + MATCH_H / 2;
      const mid = (x1 + x2) / 2;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
      path.setAttribute('class', 'mv-connector-line');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
    });
  });
  host.appendChild(svg);

  Object.values(positions).forEach((pos) => {
    const el = document.createElement('div');
    el.className = 'mv-match-abs';
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${MATCH_W}px`;
    el.style.height = `${MATCH_H}px`;
    el.innerHTML = matchBoxHtml(pos.label, sideLabel(pos.match.aka), sideLabel(pos.match.ao));
    host.appendChild(el);
  });

  content.innerHTML = '';
  content.appendChild(host);
  fitAfterLayout(parseFloat(host.style.width), parseFloat(host.style.height));
}

function buildAthletesById(json) {
  const map = new Map();
  (json.athletes || []).forEach((a) => {
    if (a.id != null) map.set(String(a.id), a);
    if (a.competitor_id != null) map.set(String(a.competitor_id), a);
  });
  return map;
}

function renderPremierLeague(content, json) {
  const athletesById = buildAthletesById(json);
  const pools = json.pools || [];
  const elim = json.elimination?.matches || [];
  const poolGap = 40;
  let cursorX = PAD;
  let maxBottom = PAD;
  const host = document.createElement('div');
  host.className = 'mv-bracket';

  pools.forEach((pool) => {
    const rr = pool.round_robin_matches || pool.matches || [];
    const memberIds = pool.competitor_ids || [];
    const members = memberIds.length
      ? memberIds.map((id) => athletesById.get(String(id)) || { id, name: String(id) })
      : (pool.competitors || pool.athletes || []);
    const cols = Math.max(1, Math.min(2, rr.length || 1));
    const rows = Math.max(1, Math.ceil((rr.length || 1) / cols));
    const boxW = cols * MATCH_W + (cols - 1) * 20 + 24;
    const boxH = 48 + Math.max(members.length, 1) * 18 + rows * (MATCH_H + 12) + 24;
    const frame = document.createElement('div');
    frame.className = 'mv-pool-frame';
    frame.style.left = `${cursorX}px`;
    frame.style.top = `${PAD}px`;
    frame.style.width = `${boxW}px`;
    frame.style.height = `${boxH}px`;
    frame.innerHTML = `<div class="mv-pool-label">${escapeHtml(pool.pool_id || pool.pool_name || pool.name || 'Pool')}</div>`;
    const memberList = document.createElement('div');
    memberList.className = 'mv-pool-members';
    memberList.innerHTML = members.map((a) => (
      `<div>${escapeHtml(a.name || a.id || '—')}</div>`
    )).join('') || '<div>—</div>';
    frame.appendChild(memberList);
    rr.forEach((m, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const el = document.createElement('div');
      el.className = 'mv-match-abs';
      el.style.position = 'absolute';
      el.style.left = `${12 + col * (MATCH_W + 20)}px`;
      el.style.top = `${48 + members.length * 18 + 8 + row * (MATCH_H + 12)}px`;
      el.style.width = `${MATCH_W}px`;
      el.style.height = `${MATCH_H}px`;
      el.innerHTML = matchBoxHtml(
        m.draw_label || m.match_id || `M${i + 1}`,
        sideLabel(m.aka, athletesById),
        sideLabel(m.ao, athletesById)
      );
      frame.appendChild(el);
    });
    host.appendChild(frame);
    maxBottom = Math.max(maxBottom, PAD + boxH);
    cursorX += boxW + poolGap;
  });

  const elimStartY = maxBottom + 40;
  const elimTitle = document.createElement('div');
  elimTitle.className = 'mv-section-title';
  elimTitle.style.left = `${PAD}px`;
  elimTitle.style.top = `${elimStartY - 28}px`;
  elimTitle.textContent = 'Elimination';
  host.appendChild(elimTitle);

  elim.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'mv-match-abs';
    el.style.left = `${PAD + i * (MATCH_W + H_GAP)}px`;
    el.style.top = `${elimStartY}px`;
    el.style.width = `${MATCH_W}px`;
    el.style.height = `${MATCH_H}px`;
    el.innerHTML = matchBoxHtml(
      m.stage || m.match_id || `E${i + 1}`,
      sideLabel(m.aka, athletesById),
      sideLabel(m.ao, athletesById)
    );
    host.appendChild(el);
  });

  const width = Math.max(cursorX + PAD, PAD + Math.max(elim.length, 1) * (MATCH_W + H_GAP));
  const height = elimStartY + MATCH_H + PAD;
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  content.innerHTML = '';
  content.appendChild(host);
  fitAfterLayout(width, height);
}

function bindPanZoom() {
  const viewportId = viewerTargets.viewportId;
  const viewport = document.getElementById(viewportId);
  if (!viewport || boundViewports.has(viewportId)) return;
  boundViewports.add(viewportId);

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoom = Math.min(2.5, Math.max(0.2, zoom * factor));
    applyTransform();
  }, { passive: false });

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.da-matches-zoom')) return;
    dragging = true;
    viewport.classList.add('is-dragging');
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    viewport.setPointerCapture?.(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    applyTransform();
  });
  const endDrag = () => {
    dragging = false;
    viewport.classList.remove('is-dragging');
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  document.getElementById(viewerTargets.zoomInId)?.addEventListener('click', () => {
    zoom = Math.min(2.5, zoom * 1.15);
    applyTransform();
  });
  document.getElementById(viewerTargets.zoomOutId)?.addEventListener('click', () => {
    zoom = Math.max(0.2, zoom / 1.15);
    applyTransform();
  });
  document.getElementById(viewerTargets.zoomFitId)?.addEventListener('click', () => {
    const bracket = document.querySelector(
      `#${viewerTargets.contentId} .mv-bracket, #${viewerTargets.contentId} .mv-list-wrap`
    );
    if (bracket) {
      fitToViewport(bracket.offsetWidth || 400, bracket.offsetHeight || 300);
    }
  });
}

export function renderMatchesViewer(entry, targets = null) {
  resolveViewerTargets(targets);
  bindPanZoom();
  const content = document.getElementById(viewerTargets.contentId);
  if (!content) return;
  panX = 0;
  panY = 0;
  zoom = 1;
  content.innerHTML = '';
  applyTransform();

  const emptyHint = viewerTargets.emptyHint || 'select a draw to view.';
  if (!entry || !entryHasAthletes(entry)) {
    setHint(emptyHint, true);
    return;
  }
  const json = parseDrawJson(entry);
  if (!json) {
    setHint('no draw data yet. save after moving athletes to regenerate.', true);
    return;
  }

  setHint('', false);
  const type = normalizeType(entry);
  if (type === 'list') renderList(content, json);
  else if (type === 'rr') renderRoundRobin(content, json);
  else if (type === 'se') renderSingleElim(content, json);
  else if (type === 'pl') renderPremierLeague(content, json);
  else setHint('unsupported draw type for this view.', true);
}

export function clearMatchesViewer(targets = null) {
  resolveViewerTargets(targets);
  const content = document.getElementById(viewerTargets.contentId);
  if (content) content.innerHTML = '';
  setHint(viewerTargets.emptyHint || 'select a draw to view.', true);
}
