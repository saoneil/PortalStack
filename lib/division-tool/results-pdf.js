const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { ALL_RESULTS_PDF_FILENAME, EVENT_DISPLAY_NAMES } = require('./constants');
const { safeDivisionBasename, stripDivisionTypeTag } = require('./utils');

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 28;
const TEAM_GREY = rgb(0.32, 0.32, 0.32);
const NAME_BLACK = rgb(0, 0, 0);
const LINE_GREY = rgb(0.75, 0.75, 0.75);
const BOX_BORDER = rgb(0.2, 0.2, 0.2);
const WIN_GREEN = rgb(0.05, 0.45, 0.2);
const WIN_FILL = rgb(0.88, 0.97, 0.9);

/** Helvetica/WinAnsi cannot encode arrows and many Unicode punctuation. */
function sanitizePdfText(text) {
  return String(text || '')
    .replace(/\u2192|\u2794|\u21D2/g, '->')
    .replace(/\u2190|\u21D0/g, '<-')
    .replace(/\u00D7/g, 'x')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

function fitText(font, text, maxWidth, size) {
  let t = sanitizePdfText(text);
  if (!t) return '';
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  const ellipsis = '...';
  while (t.length && font.widthOfTextAtSize(t + ellipsis, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t ? `${t}${ellipsis}` : ellipsis;
}

function toTitleCaseWords(text) {
  return String(text || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatEventKeyLabel(eventKey) {
  const key = String(eventKey || '').trim();
  if (!key) return '';
  if (EVENT_DISPLAY_NAMES[key]) return toTitleCaseWords(EVENT_DISPLAY_NAMES[key]);
  return toTitleCaseWords(key);
}

function formatDivisionTypeLabel(type) {
  const raw = String(type || '').trim();
  if (!raw) return '';
  return toTitleCaseWords(raw.replace(/-/g, ' '));
}

/** Strip club:/province:/country: tokens so boxes show the bare club/country name. */
function formatTeamLabel(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  return t.replace(/^(club|province|country)\s*:\s*/i, '').trim() || t;
}

function drawPdfHeader(page, bold, font, {
  divisionName = '',
  eventName = '',
  divisionType = '',
  eventKey = ''
} = {}) {
  const usableW = PAGE_W - 2 * MARGIN;
  let y = PAGE_H - MARGIN;
  const title = stripDivisionTypeTag(divisionName);
  const titleText = fitText(bold, title, usableW, 13);
  page.drawText(titleText, {
    x: (PAGE_W - bold.widthOfTextAtSize(titleText, 13)) / 2,
    y,
    size: 13,
    font: bold
  });
  y -= 14;

  const bits = [];
  const en = String(eventName || '').trim();
  if (en) bits.push(en);
  const dt = formatDivisionTypeLabel(divisionType);
  if (dt) bits.push(dt);
  const ek = formatEventKeyLabel(eventKey);
  if (ek) bits.push(ek);
  if (bits.length) {
    const meta = fitText(font, bits.join('  ·  '), usableW, 8);
    page.drawText(meta, {
      x: (PAGE_W - font.widthOfTextAtSize(meta, 8)) / 2,
      y,
      size: 8,
      font,
      color: TEAM_GREY
    });
    y -= 12;
  }
  return y - 2;
}

function sideName(side) {
  if (!side || typeof side !== 'object') return '';
  if (side.bye) return 'BYE';
  if (side.competitor) return String(side.competitor.name || '').trim();
  return String(side.name || '').trim();
}

function sideTeam(side) {
  if (!side || typeof side !== 'object') return '';
  if (side.competitor) {
    return formatTeamLabel(side.competitor.country_dirty || side.competitor.country || '');
  }
  return formatTeamLabel(side.country_dirty || side.country || '');
}

/**
 * Overlay result athlete display onto a draw side without wiping source_match_id.
 */
function mergeSideDisplay(drawSide, resultSide) {
  const base = drawSide && typeof drawSide === 'object' ? { ...drawSide } : {};
  if (!resultSide || typeof resultSide !== 'object') {
    return Object.keys(base).length ? base : null;
  }
  const sourceMatchId = base.source_match_id != null
    ? base.source_match_id
    : (base.sourceMatchId != null
      ? base.sourceMatchId
      : (resultSide.source_match_id != null ? resultSide.source_match_id : resultSide.sourceMatchId));
  const merged = { ...base, ...resultSide };
  if (sourceMatchId != null) merged.source_match_id = sourceMatchId;
  return merged;
}

function winnerSide(winner) {
  const w = String(winner || '').trim().toLowerCase();
  if (w === 'hong' || w === 'aka' || w === 'red') return 'red';
  if (w === 'chong' || w === 'ao' || w === 'blue') return 'blue';
  return null;
}

function scorePair(match) {
  const scores = match?.overall_scores || match?.overallScores;
  if (!scores || typeof scores !== 'object') return null;
  const red = scores.redOverall != null ? scores.redOverall : scores.red;
  const blue = scores.blueOverall != null ? scores.blueOverall : scores.blue;
  if (red == null && blue == null) return null;
  return { red: red != null ? red : '-', blue: blue != null ? blue : '-' };
}

function normalizeResultMatch(m) {
  if (!m || typeof m !== 'object') return null;
  const red = m.red || m.aka || m.hong || null;
  const blue = m.blue || m.ao || m.chong || null;
  return {
    match_id: m.match_id || m.matchId || m.match_number || null,
    draw_label: m.draw_label || m.drawLabel || m.matchLabel || null,
    stage: m.stage || null,
    pool_id: m.pool_id || m.poolId || null,
    round_id: m.round_id || m.roundId || null,
    winner: m.winner || null,
    red,
    blue,
    overall_scores: m.overall_scores || m.overallScores || null,
    aka: red,
    ao: blue
  };
}

function indexResultMatches(result) {
  const map = new Map();
  (result?.matches || []).forEach((raw) => {
    const m = normalizeResultMatch(raw);
    if (!m) return;
    const keys = [m.match_id, m.draw_label]
      .filter(Boolean)
      .map((k) => String(k).trim().toLowerCase());
    keys.forEach((k) => map.set(k, m));
  });
  return map;
}

function lookupResultMatch(resultMap, match) {
  if (!match) return null;
  const keys = [
    match.match_id,
    match.matchId,
    match.draw_label,
    match.drawLabel
  ].filter(Boolean).map((k) => String(k).trim().toLowerCase());
  for (const k of keys) {
    if (resultMap.has(k)) return resultMap.get(k);
  }
  return null;
}

function drawCheckmark(page, x, y, size = 8) {
  const s = Number(size) || 8;
  page.drawLine({
    start: { x, y: y + s * 0.35 },
    end: { x: x + s * 0.35, y },
    thickness: 1.4,
    color: WIN_GREEN
  });
  page.drawLine({
    start: { x: x + s * 0.35, y },
    end: { x: x + s, y: y + s * 0.85 },
    thickness: 1.4,
    color: WIN_GREEN
  });
}

function drawAthleteLane(page, {
  bold,
  font,
  name,
  team,
  x,
  y,
  maxWidth,
  nameSize = 9,
  won = false
}) {
  const nm = String(name || '').trim() || 'TBD';
  const tm = String(team || '').trim();
  const text = tm ? `${nm} - ${tm}` : nm;
  const drawn = fitText(won ? bold : font, text, maxWidth, nameSize);
  page.drawText(drawn, {
    x,
    y,
    size: nameSize,
    font: won ? bold : font,
    color: won ? WIN_GREEN : NAME_BLACK
  });
}

function placementRank(row, index) {
  if (row.rank != null) return Number(row.rank);
  if (row.order != null) return Number(row.order);
  if (row.medal === 'gold') return 1;
  if (row.medal === 'silver') return 2;
  if (row.medal === 'bronze') return 3;
  return index + 1;
}

function placementRankLabel(row, index) {
  return String(placementRank(row, index));
}

function placementName(row) {
  const name = String(row.name || '').trim() || 'TBD';
  const country = formatTeamLabel(row.country);
  return country ? `${name} (${country})` : name;
}

function personKey(side) {
  if (!side || typeof side !== 'object') return '';
  const id = side.competitor_id != null ? side.competitor_id
    : (side.competitorId != null ? side.competitorId : side.id);
  if (id != null && String(id).trim()) return `id:${String(id).trim().toLowerCase()}`;
  const name = sideName(side).toLowerCase();
  if (!name || name === 'bye' || name === 'tbd') return '';
  const country = formatTeamLabel(side.country_dirty || side.country || '').toLowerCase();
  return `n:${name}|${country}`;
}

function personFromSide(side) {
  return {
    name: sideName(side) || 'TBD',
    country: sideTeam(side) || formatTeamLabel(side?.country_dirty || side?.country || ''),
    competitor_id: side?.competitor_id || side?.competitorId || side?.id || null
  };
}

function matchSearchBlob(m) {
  return `${m?.stage || ''} ${m?.match_id || ''} ${m?.draw_label || ''} ${m?.round_id || ''}`.toLowerCase();
}

function isBronzeMatch(m) {
  const id = String(m?.match_id || '').toLowerCase();
  if (id === 'br' || id.startsWith('br')) return true;
  return /bronze|3rd|third\s*place|place\s*3|\bbf\b|bronze.?final/.test(matchSearchBlob(m));
}

function isFinalMatch(m) {
  if (!m || isBronzeMatch(m)) return false;
  const rid = String(m.round_id || '').toUpperCase();
  if (rid === 'F') return true;
  const s = matchSearchBlob(m);
  if (/semi|quarter|qf|\bsf\b|bronze/.test(s)) return false;
  const id = String(m.match_id || '').toUpperCase();
  if (id === 'F' || id === 'FINAL') return true;
  return /(^|\b)final(\b|$)/.test(s);
}

function isSemiMatch(m) {
  if (!m || isBronzeMatch(m) || isFinalMatch(m)) return false;
  const rid = String(m.round_id || '').toUpperCase();
  if (rid === 'SF') return true;
  return /semi|\bsf\b/.test(matchSearchBlob(m));
}

function matchWinnerLoser(m) {
  const side = winnerSide(m?.winner);
  if (!side) return null;
  const red = m.red || m.aka;
  const blue = m.blue || m.ao;
  if (side === 'red') return { winner: red, loser: blue };
  if (side === 'blue') return { winner: blue, loser: red };
  return null;
}

/**
 * Premier League overall places come from elimination only:
 * 1 = final winner, 2 = final loser,
 * without bronze: both SF losers tied for 3rd,
 * with bronze match: bronze winner 3rd, loser 4th.
 * Pool W-L do not affect overall rank.
 */
function derivePremierLeagueOverallPlacements(result) {
  const matches = (result?.matches || [])
    .map((raw) => normalizeResultMatch(raw))
    .filter(Boolean)
    .filter((m) => m.pool_id == null || m.pool_id === '');

  const final = matches.find(isFinalMatch);
  const finalWl = final ? matchWinnerLoser(final) : null;
  if (!finalWl?.winner) return null;

  const rows = [];
  rows.push({
    rank: 1,
    medal: 'gold',
    ...personFromSide(finalWl.winner)
  });
  rows.push({
    rank: 2,
    medal: 'silver',
    ...personFromSide(finalWl.loser)
  });

  const bronze = matches.find(isBronzeMatch);
  const bronzeWl = bronze ? matchWinnerLoser(bronze) : null;
  if (bronzeWl?.winner) {
    rows.push({
      rank: 3,
      medal: 'bronze',
      ...personFromSide(bronzeWl.winner)
    });
    rows.push({
      rank: 4,
      medal: null,
      ...personFromSide(bronzeWl.loser)
    });
    return rows;
  }

  const finalKeys = new Set(
    [personKey(finalWl.winner), personKey(finalWl.loser)].filter(Boolean)
  );
  const third = [];
  const seen = new Set();
  const addThird = (side) => {
    const key = personKey(side);
    if (!key || finalKeys.has(key) || seen.has(key)) return;
    seen.add(key);
    third.push(personFromSide(side));
  };

  matches.filter(isSemiMatch).forEach((sm) => {
    const wl = matchWinnerLoser(sm);
    if (wl?.loser) addThird(wl.loser);
  });

  // Fallback if semis lack winners: anyone in a semi who is not a finalist.
  if (!third.length) {
    matches.filter(isSemiMatch).forEach((sm) => {
      addThird(sm.red || sm.aka);
      addThird(sm.blue || sm.ao);
    });
  }

  third.forEach((p) => {
    rows.push({
      rank: 3,
      medal: 'bronze',
      tied: true,
      ...p
    });
  });
  return rows;
}

/**
 * Compact standings block. Returns y below the block.
 */
function drawStandingsBlock(page, bold, font, yStart, result, divisionType) {
  const placements = Array.isArray(result.placements) ? result.placements : [];
  const listAthletes = Array.isArray(result.list_athletes) ? result.list_athletes : [];
  const type = String(divisionType || '').toLowerCase();
  const isList = type.includes('list') || listAthletes.length > 0;
  const isElim = type.includes('single') || type.includes('elim');
  const isPremier = type.includes('premier');

  let rows;
  if (isPremier) {
    // Final ranking is elim athletes only (1/2/3/4) — never the full pool field.
    const overall = derivePremierLeagueOverallPlacements(result);
    if (overall && overall.length) {
      rows = overall;
    } else {
      rows = placements.filter((r) => r && (r.pool_id == null || r.pool_id === ''));
    }
  } else if (placements.length) {
    rows = placements;
  } else {
    rows = listAthletes.map((a, i) => ({
      order: i + 1,
      name: a.name,
      country: a.country,
      total: a.total
    }));
  }

  if (!rows.length) return yStart;

  let y = yStart;
  const usableW = PAGE_W - 2 * MARGIN;
  page.drawText(isList || (isPremier && !rows.some((r) => r.pool_id))
    ? 'Final Ranking'
    : 'Division Standings', {
    x: MARGIN,
    y,
    size: 10,
    font: bold
  });
  y -= 13;

  // Overall PL podium is elim-only — do not surface pool W-L on those rows.
  const showWl = !isPremier && rows.some((r) => r.wins != null || r.losses != null);
  const showRefs = !isElim && !isPremier && rows.some((r) => r.refereesFor != null || r.refereesAgainst != null);
  const showPoints = !isElim && !isPremier && rows.some((r) => r.pointsFor != null || r.pointsAgainst != null);
  const showTotal = rows.some((r) => r.total != null);
  const showPool = rows.some((r) => r.pool_id);

  const cols = [{ key: 'rank', label: 'Rank', w: 36 }];
  if (showPool) cols.push({ key: 'pool', label: 'Pool', w: 44 });
  cols.push({ key: 'name', label: 'Name', w: 0 });
  if (showWl) cols.push({ key: 'wl', label: 'W-L', w: 44 });
  if (showRefs) cols.push({ key: 'refs', label: 'Refs', w: 54 });
  if (showPoints) cols.push({ key: 'pts', label: 'Points', w: 60 });
  if (showTotal) cols.push({ key: 'total', label: 'Total', w: 48 });
  const fixed = cols.reduce((sum, c) => sum + (c.w || 0), 0);
  const nameCol = cols.find((c) => c.key === 'name');
  if (nameCol) nameCol.w = Math.max(160, usableW - fixed);

  let x = MARGIN;
  cols.forEach((col) => {
    page.drawText(col.label, { x, y, size: 7, font: bold, color: TEAM_GREY });
    x += col.w;
  });
  y -= 3;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + usableW, y },
    thickness: 0.5,
    color: LINE_GREY
  });
  y -= 11;

  const maxRows = Math.min(rows.length, 12);
  for (let i = 0; i < maxRows; i += 1) {
    const row = rows[i];
    x = MARGIN;
    const cells = {
      rank: placementRankLabel(row, i),
      pool: row.pool_id != null ? String(row.pool_id) : '',
      name: placementName(row),
      wl: (row.wins != null || row.losses != null) ? `${Number(row.wins || 0)}-${Number(row.losses || 0)}` : '',
      refs: (row.refereesFor != null || row.refereesAgainst != null)
        ? `${Number(row.refereesFor || 0)}-${Number(row.refereesAgainst || 0)}`
        : '',
      pts: (row.pointsFor != null || row.pointsAgainst != null)
        ? `${Number(row.pointsFor || 0)}-${Number(row.pointsAgainst || 0)}`
        : '',
      total: row.total != null ? String(row.total) : ''
    };
    cols.forEach((col) => {
      const text = fitText(font, cells[col.key] || '', col.w - 3, 8);
      page.drawText(text, {
        x,
        y,
        size: 8,
        font: col.key === 'name' ? bold : font,
        color: NAME_BLACK
      });
      x += col.w;
    });
    y -= 11;
  }
  if (rows.length > maxRows) {
    page.drawText(`… +${rows.length - maxRows} more`, {
      x: MARGIN,
      y,
      size: 7,
      font,
      color: TEAM_GREY
    });
    y -= 10;
  }
  return y - 6;
}

function drawMatchBox(page, bold, font, {
  x,
  y1,
  boxW,
  boxH,
  label,
  redName,
  redTeam,
  blueName,
  blueTeam,
  winner,
  score,
  compact = false
}) {
  const headerH = compact
    ? Math.min(10, Math.max(7.5, boxH * 0.3))
    : Math.min(14, Math.max(11, boxH * 0.28));
  const labelSize = compact ? Math.min(6.5, Math.max(5, headerH * 0.72)) : 8;
  const scoreSize = compact ? 5.5 : 7;
  const checkSize = compact ? 5 : 8;
  const side = winnerSide(winner);
  page.drawRectangle({
    x,
    y: y1,
    width: boxW,
    height: boxH,
    borderColor: BOX_BORDER,
    borderWidth: compact ? 0.7 : 1,
    color: rgb(1, 1, 1)
  });
  page.drawLine({
    start: { x, y: y1 + boxH - headerH },
    end: { x: x + boxW, y: y1 + boxH - headerH },
    thickness: compact ? 0.7 : 1,
    color: BOX_BORDER
  });
  page.drawLine({
    start: { x, y: y1 + (boxH - headerH) / 2 },
    end: { x: x + boxW, y: y1 + (boxH - headerH) / 2 },
    thickness: 0.5,
    color: rgb(0.55, 0.55, 0.55)
  });

  const labelText = fitText(bold, String(label || ''), boxW - (score ? 28 : 8), labelSize);
  page.drawText(labelText, {
    x: x + 3,
    y: y1 + boxH - headerH + Math.max(0.5, (headerH - labelSize) / 2),
    size: labelSize,
    font: bold
  });
  if (score) {
    const scoreStr = `${score.red}-${score.blue}`;
    const sw = bold.widthOfTextAtSize(scoreStr, scoreSize);
    page.drawText(scoreStr, {
      x: x + boxW - sw - 3,
      y: y1 + boxH - headerH + Math.max(0.5, (headerH - scoreSize) / 2),
      size: scoreSize,
      font: bold,
      color: TEAM_GREY
    });
  }

  const laneH = (boxH - headerH) / 2;
  const nameSize = compact
    ? Math.min(6.5, Math.max(4.5, laneH * 0.55))
    : Math.min(9, Math.max(6.5, laneH * 0.45));
  const checkW = side ? (compact ? 8 : 12) : 0;

  // Winner lane tint
  if (side === 'red') {
    page.drawRectangle({
      x: x + 1,
      y: y1 + (boxH - headerH) / 2 + 0.5,
      width: boxW - 2,
      height: (boxH - headerH) / 2 - 1,
      color: WIN_FILL,
      borderWidth: 0
    });
  } else if (side === 'blue') {
    page.drawRectangle({
      x: x + 1,
      y: y1 + 1,
      width: boxW - 2,
      height: (boxH - headerH) / 2 - 1,
      color: WIN_FILL,
      borderWidth: 0
    });
  }

  drawAthleteLane(page, {
    bold,
    font,
    name: redName,
    team: redTeam,
    x: x + (compact ? 3 : 5),
    y: y1 + boxH - headerH - Math.min(compact ? 9 : 13, laneH * 0.62),
    maxWidth: boxW - (compact ? 8 : 10) - checkW,
    nameSize,
    won: side === 'red'
  });
  drawAthleteLane(page, {
    bold,
    font,
    name: blueName,
    team: blueTeam,
    x: x + (compact ? 3 : 5),
    y: y1 + laneH - Math.min(compact ? 9 : 13, laneH * 0.62),
    maxWidth: boxW - (compact ? 8 : 10) - checkW,
    nameSize,
    won: side === 'blue'
  });

  if (side === 'red') {
    drawCheckmark(
      page,
      x + boxW - (compact ? 10 : 14),
      y1 + boxH - headerH - laneH * 0.55,
      checkSize
    );
  } else if (side === 'blue') {
    drawCheckmark(page, x + boxW - (compact ? 10 : 14), y1 + laneH * 0.35, checkSize);
  }
}

function resolveMatchSides(match, resultMatch) {
  const src = resultMatch || match || {};
  const red = src.red || src.aka || match?.aka || match?.red || null;
  const blue = src.blue || src.ao || match?.ao || match?.blue || null;
  return {
    redName: sideName(red) || 'TBD',
    redTeam: sideTeam(red),
    blueName: sideName(blue) || 'TBD',
    blueTeam: sideTeam(blue),
    winner: src.winner || match?.winner || null,
    score: scorePair(src) || scorePair(match),
    label: String(
      src.draw_label || match?.draw_label || src.match_id || match?.match_id || ''
    ).trim()
  };
}

function drawRoundRobinTree(page, bold, font, areaTop, matches, resultMap) {
  const list = (matches || []).map((m) => {
    const rm = lookupResultMatch(resultMap, m) || normalizeResultMatch(m);
    return { match: m, result: rm };
  }).filter((x) => x.match || x.result);

  if (!list.length) {
    page.drawText('No matches recorded.', {
      x: MARGIN,
      y: areaTop - 16,
      size: 10,
      font,
      color: TEAM_GREY
    });
    return;
  }

  const maxRows = 4;
  const rows = Math.min(maxRows, Math.max(1, list.length));
  const cols = Math.max(1, Math.ceil(list.length / maxRows));
  const boxW = Math.min(210, (PAGE_W - 2 * MARGIN - Math.max(0, cols - 1) * 16) / cols);
  const boxH = 70;
  const rowGap = 10;
  const colGap = 16;
  const contentW = cols * boxW + Math.max(0, cols - 1) * colGap;
  const contentH = rows * boxH + Math.max(0, rows - 1) * rowGap;
  const gridLeft = (PAGE_W - contentW) / 2;
  const gridTop = areaTop - 4;

  list.forEach((item, idx) => {
    const col = Math.floor(idx / rows);
    const row = idx % rows;
    const x = gridLeft + col * (boxW + colGap);
    const y2 = gridTop - row * (boxH + rowGap);
    const y1 = y2 - boxH;
    const sides = resolveMatchSides(item.match, item.result);
    drawMatchBox(page, bold, font, {
      x,
      y1,
      boxW,
      boxH,
      label: sides.label || `Match ${idx + 1}`,
      redName: sides.redName,
      redTeam: sides.redTeam,
      blueName: sides.blueName,
      blueTeam: sides.blueTeam,
      winner: sides.winner,
      score: sides.score
    });
  });
}

function drawSingleElimTree(page, bold, font, areaTop, drawJson, resultMatches, resultMap) {
  const sourceMatches = (drawJson?.matches?.length
    ? drawJson.matches
    : resultMatches).filter((m) => m && typeof m === 'object');

  const rounds = [...(drawJson?.rounds || [])]
    .filter((r) => r && typeof r === 'object')
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  const normalized = sourceMatches.map((m) => {
    const rm = lookupResultMatch(resultMap, m) || normalizeResultMatch(m);
    const drawAka = m.aka || m.red || null;
    const drawAo = m.ao || m.blue || null;
    return {
      match_id: m.match_id || m.matchId || rm?.match_id,
      draw_label: m.draw_label || rm?.draw_label,
      round_id: m.round_id || m.roundId || rm?.round_id || inferRoundId(m, rm),
      aka: mergeSideDisplay(drawAka, rm?.red || null),
      ao: mergeSideDisplay(drawAo, rm?.blue || null),
      winner: rm?.winner || m.winner || null,
      overall_scores: rm?.overall_scores || m.overall_scores || null,
      result: rm
    };
  });

  const byRound = new Map();
  rounds.forEach((r) => byRound.set(String(r.round_id), []));
  normalized.forEach((m) => {
    const key = String(m.round_id || 'R1');
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(m);
  });

  let roundIds = rounds.length
    ? rounds.map((r) => String(r.round_id))
    : [...byRound.keys()].sort((a, b) => roundSortKey(a) - roundSortKey(b));

  if (!roundIds.length) {
    drawRoundRobinTree(page, bold, font, areaTop, normalized, resultMap);
    return;
  }

  const sortMatches = (list) => [...list].sort((a, b) => {
    const na = parseInt(String(a.match_id || '').replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(String(b.match_id || '').replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });

  const firstList = sortMatches(byRound.get(roundIds[0]) || normalized);
  const nFirst = Math.max(1, firstList.length);
  const colCount = roundIds.length;
  const labelBand = 16;
  const usableH = Math.max(80, areaTop - MARGIN - labelBand - 4);
  const usableW = PAGE_W - 2 * MARGIN;

  // Compact bracket like the scoring division viewer: preferred box/gap sizes,
  // shrink only when the field does not fit — never stretch gaps to fill the page.
  const boxWIdeal = 148;
  const boxHIdeal = 48;
  const hGapIdeal = 26;
  const vGapIdeal = 10;
  let hGap = colCount > 1 ? hGapIdeal : 0;
  let boxW = Math.min(
    boxWIdeal,
    Math.max(92, (usableW - Math.max(0, colCount - 1) * hGap) / colCount)
  );
  let boxH = boxHIdeal;
  let vGap = nFirst > 1 ? vGapIdeal : 0;
  let neededH = nFirst * boxH + Math.max(0, nFirst - 1) * vGap;
  if (neededH > usableH) {
    const shrinkV = nFirst > 1
      ? Math.max(3, (usableH - nFirst * 36) / (nFirst - 1))
      : 0;
    vGap = Math.min(vGapIdeal, shrinkV);
    boxH = Math.max(36, (usableH - Math.max(0, nFirst - 1) * vGap) / nFirst);
    neededH = nFirst * boxH + Math.max(0, nFirst - 1) * vGap;
  }
  const contentW = colCount * boxW + Math.max(0, colCount - 1) * hGap;
  const gridLeft = MARGIN + Math.max(0, (usableW - contentW) / 2);
  // Top-align the compact cluster (viewer-style), with a small pad if it is short.
  const gridTop = areaTop - labelBand - (neededH < usableH * 0.55 ? 4 : 0);
  const positions = {};
  const roundLists = roundIds.map((rid) => sortMatches(byRound.get(rid) || []));

  roundIds.forEach((rid, col) => {
    const list = roundLists[col];
    list.forEach((m, i) => {
      const id = String(m.match_id || `M${col}-${i}`);
      let y2;
      if (col === 0) {
        y2 = gridTop - i * (boxH + vGap);
      } else {
        const srcA = m.aka?.source_match_id || m.red?.source_match_id;
        const srcB = m.ao?.source_match_id || m.blue?.source_match_id;
        const ya = srcA != null ? positions[String(srcA)]?.y2 : null;
        const yb = srcB != null ? positions[String(srcB)]?.y2 : null;
        if (ya != null && yb != null) {
          y2 = (ya + yb) / 2;
        } else if (ya != null) {
          y2 = ya;
        } else if (yb != null) {
          y2 = yb;
        } else {
          // Index-pair fallback (demo SE / results-only brackets).
          const prev = roundLists[col - 1] || [];
          const left = prev[2 * i];
          const right = prev[2 * i + 1];
          const leftPos = left ? positions[String(left.match_id || `M${col - 1}-${2 * i}`)] : null;
          const rightPos = right ? positions[String(right.match_id || `M${col - 1}-${2 * i + 1}`)] : null;
          if (leftPos && rightPos) y2 = (leftPos.y2 + rightPos.y2) / 2;
          else if (leftPos) y2 = leftPos.y2;
          else if (rightPos) y2 = rightPos.y2;
          else y2 = gridTop - i * (boxH + vGap);
        }
      }
      positions[id] = {
        x: gridLeft + col * (boxW + hGap),
        y2,
        y1: y2 - boxH,
        match: m,
        col,
        index: i
      };
    });
  });

  roundIds.forEach((rid, col) => {
    const round = rounds.find((r) => String(r.round_id) === rid);
    const label = String(round?.name || prettyRoundLabel(rid));
    const x = gridLeft + col * (boxW + hGap);
    const drawn = fitText(bold, label, boxW, 9);
    page.drawText(drawn, {
      x: x + (boxW - bold.widthOfTextAtSize(drawn, 9)) / 2,
      y: areaTop - 2,
      size: 9,
      font: bold
    });
  });

  const lineColor = rgb(0.35, 0.35, 0.35);
  const drawElbow = (src, dest) => {
    if (!src || !dest) return;
    const midX = (src.x + boxW + dest.x) / 2;
    const yA = src.y1 + boxH / 2;
    const yB = dest.y1 + boxH / 2;
    page.drawLine({ start: { x: src.x + boxW, y: yA }, end: { x: midX, y: yA }, thickness: 1.1, color: lineColor });
    page.drawLine({ start: { x: midX, y: yA }, end: { x: midX, y: yB }, thickness: 1.1, color: lineColor });
    page.drawLine({ start: { x: midX, y: yB }, end: { x: dest.x, y: yB }, thickness: 1.1, color: lineColor });
  };

  Object.values(positions).forEach((pos) => {
    const m = pos.match;
    let drew = false;
    ['aka', 'ao'].forEach((side) => {
      const srcId = m[side]?.source_match_id;
      if (srcId == null) return;
      const src = positions[String(srcId)];
      if (!src) return;
      drawElbow(src, pos);
      drew = true;
    });
    if (!drew && pos.col > 0) {
      const prev = roundLists[pos.col - 1] || [];
      const left = prev[2 * pos.index];
      const right = prev[2 * pos.index + 1];
      if (left) {
        drawElbow(
          positions[String(left.match_id || `M${pos.col - 1}-${2 * pos.index}`)],
          pos
        );
      }
      if (right) {
        drawElbow(
          positions[String(right.match_id || `M${pos.col - 1}-${2 * pos.index + 1}`)],
          pos
        );
      }
    }
  });

  Object.values(positions).forEach((pos) => {
    const sides = resolveMatchSides(pos.match, pos.match.result);
    drawMatchBox(page, bold, font, {
      x: pos.x,
      y1: pos.y1,
      boxW,
      boxH,
      label: sides.label || String(pos.match.match_id || ''),
      redName: sides.redName,
      redTeam: sides.redTeam,
      blueName: sides.blueName,
      blueTeam: sides.blueTeam,
      winner: sides.winner,
      score: sides.score
    });
  });
}

function roundSortKey(id) {
  const s = String(id || '').toUpperCase();
  if (s === 'F' || (s.includes('FINAL') && !s.includes('SEMI'))) return 900;
  if (s.includes('SF') || s.includes('SEMI')) return 800;
  if (s.includes('QF') || s.includes('QUARTER')) return 700;
  const n = parseInt(s.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 500;
}

function prettyRoundLabel(id) {
  const s = String(id || '');
  if (/^f$/i.test(s) || /final/i.test(s)) return 'Final';
  if (/sf|semi/i.test(s)) return 'Semi-Final';
  if (/qf|quarter/i.test(s)) return 'Quarter-Final';
  return s;
}

function inferRoundId(match, resultMatch) {
  const label = String(
    resultMatch?.draw_label || match?.draw_label || resultMatch?.match_id || match?.match_id || ''
  ).toUpperCase();
  if (label === 'F' || (label.includes('FINAL') && !label.includes('SEMI'))) return 'F';
  if (label.includes('SF') || label.includes('SEMI')) return 'SF';
  if (label.includes('QF') || label.includes('QUARTER')) return 'QF';
  if (resultMatch?.round_id) return resultMatch.round_id;
  if (match?.round_id) return match.round_id;
  if (resultMatch?.stage) return resultMatch.stage;
  return 'R1';
}

function drawPremierLeagueTree(pdfDoc, page, bold, font, areaTop, drawJson, resultMatches, resultMap, headerMeta, result) {
  const pools = (drawJson?.pools || result?.pools || []).filter((p) => p && typeof p === 'object');
  const athletesById = {};
  [...(drawJson?.athletes || []), ...(result?.athletes || [])].forEach((a) => {
    if (a?.id != null) athletesById[String(a.id)] = a;
  });

  const elimFromDraw = (
    (drawJson?.elimination && drawJson.elimination.matches) ||
    drawJson?.elimination_matches ||
    []
  ).filter((m) => m && typeof m === 'object');

  const elimFromResults = (resultMatches || []).filter((m) => {
    if (!m) return false;
    if (m.pool_id != null && m.pool_id !== '') return false;
    const stage = String(m.stage || m.draw_label || m.match_id || '').toLowerCase();
    return /elim|semi|final|sf|qf|knock|bronze/i.test(stage) || elimFromDraw.length === 0;
  });

  let elimMatches;
  if (elimFromDraw.length) {
    elimMatches = elimFromDraw.map((m) => {
      const rm = lookupResultMatch(resultMap, m) || normalizeResultMatch(m);
      return {
        ...m,
        aka: mergeSideDisplay(m.aka || m.red, rm?.red || null),
        ao: mergeSideDisplay(m.ao || m.blue, rm?.blue || null),
        winner: rm?.winner || m.winner || null,
        overall_scores: rm?.overall_scores || m.overall_scores || null,
        result: rm
      };
    });
  } else {
    elimMatches = elimFromResults.map((m) => {
      const rm = lookupResultMatch(resultMap, m) || m;
      return {
        ...m,
        aka: mergeSideDisplay(m.aka || m.red, rm?.red || null),
        ao: mergeSideDisplay(m.ao || m.blue, rm?.blue || null),
        winner: rm?.winner || m.winner || null,
        overall_scores: rm?.overall_scores || m.overall_scores || null,
        result: rm
      };
    });
  }

  // Pool RR matches with winners/scores from results (or draw RR definitions).
  const poolMatchesRaw = (resultMatches || []).filter((m) => m && m.pool_id != null && m.pool_id !== '');
  const poolFromDraw = [];
  pools.forEach((pool) => {
    (pool.round_robin_matches || []).forEach((m) => {
      if (m && typeof m === 'object') {
        poolFromDraw.push({ ...m, pool_id: m.pool_id != null ? m.pool_id : pool.pool_id });
      }
    });
  });
  const poolSource = poolMatchesRaw.length ? poolMatchesRaw : poolFromDraw;
  const poolMatches = poolSource.map((m) => {
    const rm = lookupResultMatch(resultMap, m) || normalizeResultMatch(m);
    return {
      ...m,
      pool_id: m.pool_id != null ? m.pool_id : rm?.pool_id,
      aka: mergeSideDisplay(m.aka || m.red, rm?.red || null),
      ao: mergeSideDisplay(m.ao || m.blue, rm?.blue || null),
      winner: rm?.winner || m.winner || null,
      overall_scores: rm?.overall_scores || m.overall_scores || null,
      result: rm
    };
  });

  if (!pools.length && !poolMatches.length) {
    const matches = (drawJson?.matches?.length ? drawJson.matches : resultMatches) || [];
    if (!matches.length && !elimMatches.length) {
      page.drawText('No matches recorded.', {
        x: MARGIN,
        y: areaTop - 16,
        size: 10,
        font,
        color: TEAM_GREY
      });
      return;
    }
    if (Array.isArray(drawJson?.rounds) && drawJson.rounds.length) {
      drawSingleElimTree(page, bold, font, areaTop, drawJson, resultMatches, resultMap);
      return;
    }
    drawRoundRobinTree(page, bold, font, areaTop, matches.length ? matches : elimMatches, resultMap);
    return;
  }

  // Prefer showing every pool match outcome (winner check + score). Fall back to
  // roster-style pool boxes only when no pool match results exist.
  const poolRosters = collectPremierLeaguePoolRosters(
    pools,
    athletesById,
    result,
    poolMatches
  );
  if (poolMatches.length) {
    drawPremierLeagueMatchResults(
      pdfDoc,
      page,
      bold,
      font,
      areaTop,
      poolMatches,
      elimMatches,
      headerMeta,
      poolRosters
    );
    return;
  }

  drawPremierLeaguePoolRosters(page, bold, font, areaTop, pools, athletesById, elimMatches);
}

/**
 * Build { pool_id, athletes: [{name, country}] } lists for PL pool membership.
 */
function collectPremierLeaguePoolRosters(pools, athletesById, result, poolMatches) {
  const lists = [];
  const poolList = Array.isArray(pools) ? pools : [];
  const placements = Array.isArray(result?.placements) ? result.placements : [];

  if (poolList.length) {
    poolList.forEach((pool) => {
      const poolId = String(pool.pool_id || '');
      const athletes = [];
      const seen = new Set();
      const addPerson = (person) => {
        if (!person?.name || person.name === 'TBD' || person.name === 'BYE') return;
        const key = `${person.name}|${person.country || ''}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        athletes.push(person);
      };

      (pool.competitor_ids || []).forEach((cid) => {
        const a = cid != null ? athletesById[String(cid)] : null;
        if (a) {
          addPerson({
            name: String(a.name || '').trim() || 'TBD',
            country: formatTeamLabel(a.country_dirty || a.country || '')
          });
          return;
        }
        const fromPlacement = placements.find((r) => (
          r && String(r.pool_id) === poolId
          && (String(r.competitor_id) === String(cid) || String(r.id) === String(cid))
        ));
        if (fromPlacement) {
          addPerson({
            name: String(fromPlacement.name || '').trim() || 'TBD',
            country: formatTeamLabel(fromPlacement.country || '')
          });
        }
      });

      // Pool-rank rows for this pool (ordered).
      placements
        .filter((r) => r && String(r.pool_id) === poolId)
        .sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99))
        .forEach((r) => {
          addPerson({
            name: String(r.name || '').trim() || 'TBD',
            country: formatTeamLabel(r.country || '')
          });
        });

      lists.push({ pool_id: poolId || '?', athletes });
    });
    if (lists.some((l) => l.athletes.length)) return lists;
  }

  // Placements grouped by pool when pools[] is absent.
  const fromPlacements = new Map();
  placements.forEach((r) => {
    if (!r || r.pool_id == null || r.pool_id === '') return;
    const key = String(r.pool_id);
    if (!fromPlacements.has(key)) fromPlacements.set(key, []);
    fromPlacements.get(key).push({
      name: String(r.name || '').trim() || 'TBD',
      country: formatTeamLabel(r.country || ''),
      rank: Number(r.rank || 99)
    });
  });
  if (fromPlacements.size) {
    return [...fromPlacements.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([pool_id, athletes]) => ({
        pool_id,
        athletes: athletes
          .sort((a, b) => a.rank - b.rank)
          .map(({ name, country }) => ({ name, country }))
      }));
  }

  // Infer from pool match participants.
  const byPool = new Map();
  (poolMatches || []).forEach((m) => {
    if (!m || m.pool_id == null || m.pool_id === '') return;
    const key = String(m.pool_id);
    if (!byPool.has(key)) byPool.set(key, new Map());
    const seen = byPool.get(key);
    [m.red || m.aka, m.blue || m.ao].forEach((side) => {
      const person = personFromSide(side);
      if (!person.name || person.name === 'TBD' || person.name === 'BYE') return;
      const pk = personKey(side) || `${person.name}|${person.country}`.toLowerCase();
      if (seen.has(pk)) return;
      seen.set(pk, person);
    });
  });
  return [...byPool.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([pool_id, map]) => ({
      pool_id,
      athletes: [...map.values()]
    }));
}

/**
 * PL results: pool rosters, pool match boxes (with winners), then elimination.
 * Scales columns/box size to keep a full category on one page when possible.
 */
function drawPremierLeagueMatchResults(
  pdfDoc,
  page,
  bold,
  font,
  areaTop,
  poolMatches,
  elimMatches,
  headerMeta,
  poolRosters = []
) {
  let current = page;
  let y = areaTop;
  const usableW = PAGE_W - 2 * MARGIN;
  const rosterCount = (poolRosters || []).filter((r) => (r.athletes || []).length).length;
  const poolCount = (poolMatches || []).length;
  const elimCount = (elimMatches || []).length;
  const sectionCount = (poolCount ? 1 : 0) + (elimCount ? 1 : 0) + (rosterCount ? 1 : 0);
  // Compact roster + section titles leave the rest of the page for match boxes.
  const overhead = 14
    + (rosterCount ? 12 + rosterCount * 10 + 6 : 0)
    + (poolCount ? 16 : 0)
    + (elimCount ? 16 : 0)
    + 12;
  const usableH = Math.max(60, areaTop - MARGIN - overhead);

  const pickLayout = () => {
    const candidates = [];
    for (let cols = 6; cols >= 3; cols -= 1) {
      for (const boxH of [44, 38, 34, 30, 27, 24]) {
        const gap = boxH <= 30 ? 3 : (boxH <= 36 ? 4 : 6);
        const poolRows = poolCount ? Math.ceil(poolCount / cols) : 0;
        const elimRows = elimCount ? Math.ceil(elimCount / cols) : 0;
        const need = poolRows * (boxH + gap) + elimRows * (boxH + gap);
        if (need <= usableH) {
          candidates.push({
            cols,
            boxH,
            gap,
            compact: boxH < 40,
            need,
            score: boxH * 10 + cols // prefer taller boxes, then more cols
          });
        }
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0];
    }
    // Absolute minimum — still one page; may be very tight.
    return { cols: 6, boxH: 22, gap: 2, compact: true };
  };

  const layout = pickLayout();
  const { cols, boxH, gap, compact } = layout;
  const colGap = compact ? 6 : 10;
  const boxW = (usableW - Math.max(0, cols - 1) * colGap) / cols;
  const titleSize = compact ? 8 : 10;
  const titleGap = compact ? 4 : 5;
  const bodySize = compact ? 6.5 : 8;
  const bodyGap = compact ? 3 : 4;
  const sectionGap = compact ? 6 : 8;

  // Cursor `y` is the top of free space. Text is drawn below it (baseline = y - size)
  // so glyphs never rise into content above.
  const drawTextLine = (text, {
    x = MARGIN,
    size = bodySize,
    useBold = false,
    color = NAME_BLACK,
    after = bodyGap
  } = {}) => {
    const t = String(text || '');
    if (!t) return;
    y -= size;
    current.drawText(t, {
      x,
      y,
      size,
      font: useBold ? bold : font,
      color
    });
    y -= after;
  };

  const drawSectionTitle = (title) => {
    y -= sectionGap * 0.25;
    drawTextLine(title, {
      size: titleSize,
      useBold: true,
      color: NAME_BLACK,
      after: titleGap
    });
  };

  const drawMatchGrid = (list, labelFn) => {
    if (!list.length) return;
    list.forEach((match, idx) => {
      const col = idx % cols;
      const x = MARGIN + col * (boxW + colGap);
      const y1 = y - boxH;
      const sides = resolveMatchSides(match, match.result);
      drawMatchBox(current, bold, font, {
        x,
        y1,
        boxW,
        boxH,
        label: labelFn(match, sides, idx),
        redName: sides.redName,
        redTeam: sides.redTeam,
        blueName: sides.blueName,
        blueTeam: sides.blueTeam,
        winner: sides.winner,
        score: sides.score,
        compact
      });
      if (col === cols - 1 || idx === list.length - 1) {
        // Move cursor to just below this row (box bottom), plus row gap.
        y = y1 - gap;
      }
    });
    y -= sectionGap;
  };

  if (rosterCount) {
    drawSectionTitle('Pool competitors');
    poolRosters.forEach((roster) => {
      const names = (roster.athletes || []).map((a) => {
        const nm = String(a.name || '').trim() || 'TBD';
        const tm = formatTeamLabel(a.country);
        return tm ? `${nm} (${tm})` : nm;
      });
      if (!names.length) return;
      const label = `Pool ${roster.pool_id}: `;
      const labelW = bold.widthOfTextAtSize(label, bodySize);
      const line = fitText(font, names.join(', '), usableW - labelW - 4, bodySize);
      y -= bodySize;
      current.drawText(label, {
        x: MARGIN,
        y,
        size: bodySize,
        font: bold,
        color: NAME_BLACK
      });
      current.drawText(line, {
        x: MARGIN + labelW,
        y,
        size: bodySize,
        font,
        color: NAME_BLACK
      });
      y -= bodyGap;
    });
    y -= sectionGap * 0.5;
  }

  // One continuous pool-match grid (pool id in label) to save section overhead.
  if (poolCount) {
    const sortedPools = [...poolMatches].sort((a, b) => {
      const pa = String(a.pool_id || '');
      const pb = String(b.pool_id || '');
      if (pa !== pb) return pa.localeCompare(pb);
      return String(a.match_id || '').localeCompare(String(b.match_id || ''));
    });
    drawSectionTitle('Pool matches');
    drawMatchGrid(sortedPools, (match, sides) => {
      const base = sides.label || String(match.match_id || '');
      const pid = match.pool_id != null ? String(match.pool_id) : '';
      if (pid && !base.toLowerCase().includes(`pool ${pid.toLowerCase()}`) && !base.startsWith(pid)) {
        return `${pid}:${base}`;
      }
      return base;
    });
  }

  if (elimCount) {
    drawSectionTitle('Elimination matches');
    drawMatchGrid(elimMatches, (match, sides, idx) => (
      sides.label
      || `${String(match.match_id || `E${idx + 1}`)} ${String(match.stage || '').trim()}`.trim()
    ));
  }
}

/** Fallback when pool match results are missing: roster boxes + elim. */
function drawPremierLeaguePoolRosters(page, bold, font, areaTop, pools, athletesById, elimMatches) {
  const contentTop = areaTop;
  const poolSlotCount = 5;
  const elimCols = elimMatches.length > 1 ? 2 : 1;
  const elimBoxW = 102;
  const elimColGap = 10;
  const elimAreaW = elimMatches.length
    ? elimCols * elimBoxW + Math.max(0, elimCols - 1) * elimColGap
    : 0;
  const midGap = elimMatches.length ? 24 : 0;
  const poolAreaW = PAGE_W - 2 * MARGIN - elimAreaW - midGap;
  const elimAreaLeft = MARGIN + poolAreaW + midGap;

  page.drawText('Round Robin Pools', {
    x: MARGIN,
    y: contentTop,
    size: 10,
    font: bold
  });
  if (elimMatches.length) {
    page.drawText('Elimination', {
      x: elimAreaLeft,
      y: contentTop,
      size: 10,
      font: bold
    });
  }

  const poolCols = pools.length >= 8 ? 2 : 1;
  const poolRows = pools.length >= 8 ? 4 : Math.max(1, pools.length);
  const poolGapY = 8;
  const poolGapX = 12;
  const poolCellW = (poolAreaW - Math.max(0, poolCols - 1) * poolGapX) / Math.max(1, poolCols);
  const poolBoxW = poolCellW * 0.6;
  const poolAreaH = Math.max(60, contentTop - MARGIN - 18);
  const poolBoxH = (poolAreaH - Math.max(0, poolRows - 1) * poolGapY) / Math.max(1, poolRows);
  const headerH = Math.max(16, poolBoxH * 0.18);
  const athleteRowH = (poolBoxH - headerH) / poolSlotCount;
  const poolHeaderSize = Math.min(12, Math.max(9, headerH * 0.55));

  pools.forEach((pool, pi) => {
    const gridCol = Math.floor(pi / poolRows);
    const gridRow = pi % poolRows;
    const x1 = MARGIN + gridCol * (poolCellW + poolGapX);
    const y2 = contentTop - 16 - gridRow * (poolBoxH + poolGapY);
    const y1 = y2 - poolBoxH;
    page.drawRectangle({
      x: x1,
      y: y1,
      width: poolBoxW,
      height: poolBoxH,
      borderColor: BOX_BORDER,
      borderWidth: 1,
      color: rgb(1, 1, 1)
    });
    page.drawRectangle({
      x: x1,
      y: y2 - headerH,
      width: poolBoxW,
      height: headerH,
      color: rgb(0.93, 0.93, 0.93),
      borderColor: BOX_BORDER,
      borderWidth: 1
    });
    const poolId = String(pool.pool_id || `Pool ${pi + 1}`);
    page.drawText(fitText(bold, poolId, poolBoxW - 10, poolHeaderSize), {
      x: x1 + 6,
      y: y2 - headerH + Math.max(3, (headerH - poolHeaderSize) / 2),
      size: poolHeaderSize,
      font: bold
    });

    const competitorIds = pool.competitor_ids || [];
    for (let ai = 0; ai < poolSlotCount; ai += 1) {
      const rowTop = y2 - headerH - ai * athleteRowH;
      const rowBottom = rowTop - athleteRowH;
      page.drawLine({
        start: { x: x1, y: rowBottom },
        end: { x: x1 + poolBoxW, y: rowBottom },
        thickness: 0.5,
        color: LINE_GREY
      });
      const cid = competitorIds[ai];
      const a = cid != null ? athletesById[String(cid)] : null;
      if (!a) continue;
      const name = String(a.name || '').trim() || 'TBD';
      const team = formatTeamLabel(a.country_dirty || a.country || '');
      const nameSize = Math.min(8, Math.max(6, athleteRowH * 0.42));
      const text = team ? `${name} - ${team}` : name;
      page.drawText(fitText(font, text, poolBoxW - 10, nameSize), {
        x: x1 + 5,
        y: rowBottom + Math.max(2, (athleteRowH - nameSize) / 2),
        size: nameSize,
        font,
        color: NAME_BLACK
      });
    }
  });

  if (elimMatches.length) {
    const elimBoxH = 48;
    const elimRows = Math.ceil(elimMatches.length / elimCols);
    const elimBlockH = elimRows * elimBoxH + Math.max(0, elimRows - 1) * 8;
    const elimTop = contentTop - 16;
    const elimStartY = elimTop - Math.max(0, (poolAreaH - elimBlockH) / 2);

    elimMatches.forEach((match, mi) => {
      const col = mi % elimCols;
      const row = Math.floor(mi / elimCols);
      const x1 = elimAreaLeft + col * (elimBoxW + elimColGap);
      const y2 = elimStartY - row * (elimBoxH + 8);
      const y1 = y2 - elimBoxH;
      const sides = resolveMatchSides(match, match.result);
      const label = sides.label
        || `${String(match.match_id || `E${mi + 1}`)} ${String(match.stage || '').trim()}`.trim();
      drawMatchBox(page, bold, font, {
        x: x1,
        y1,
        boxW: elimBoxW,
        boxH: elimBoxH,
        label,
        redName: sides.redName,
        redTeam: sides.redTeam,
        blueName: sides.blueName,
        blueTeam: sides.blueTeam,
        winner: sides.winner,
        score: sides.score
      });
    });
  }
}

function collectListRankingRows(result) {
  const fromList = Array.isArray(result?.list_athletes) ? result.list_athletes : [];
  if (fromList.length) {
    return [...fromList].sort((a, b) => {
      const dt = Number(b.total || 0) - Number(a.total || 0);
      if (dt !== 0) return dt;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  const placements = Array.isArray(result?.placements) ? result.placements : [];
  return [...placements]
    .map((p, i) => ({
      name: p.name,
      country: p.country,
      total: p.total,
      techniques: p.techniques,
      order: p.order != null ? p.order : (p.rank != null ? p.rank : i + 1)
    }))
    .sort((a, b) => {
      const dt = Number(b.total || 0) - Number(a.total || 0);
      if (dt !== 0) return dt;
      return Number(a.order || 0) - Number(b.order || 0);
    });
}

/**
 * Single full ranking for list divisions: rank, name, each score, total.
 * Continues onto extra pages so nobody is truncated.
 */
function drawListResults(pdfDoc, page, bold, font, yStart, result, headerMeta) {
  const athletes = collectListRankingRows(result);
  let current = page;
  let y = yStart;
  const usableW = PAGE_W - 2 * MARGIN;
  const rankW = 36;
  const totalW = 52;
  const scoresW = Math.min(280, Math.max(140, usableW * 0.38));
  const nameW = Math.max(120, usableW - rankW - totalW - scoresW);
  const rowH = 12;

  const drawTableHeader = () => {
    current.drawText('Final Ranking', {
      x: MARGIN,
      y,
      size: 10,
      font: bold
    });
    y -= 14;
    let x = MARGIN;
    [
      { label: 'Rank', w: rankW },
      { label: 'Name', w: nameW },
      { label: 'Scores', w: scoresW },
      { label: 'Total', w: totalW }
    ].forEach((col) => {
      current.drawText(col.label, { x, y, size: 7, font: bold, color: TEAM_GREY });
      x += col.w;
    });
    y -= 3;
    current.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + usableW, y },
      thickness: 0.5,
      color: LINE_GREY
    });
    y -= 11;
  };

  const ensureSpace = () => {
    if (y >= MARGIN + rowH) return;
    current = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = drawPdfHeader(current, bold, font, headerMeta);
    drawTableHeader();
  };

  if (!athletes.length) {
    current.drawText('No list ranking recorded.', {
      x: MARGIN,
      y: y - 14,
      size: 10,
      font,
      color: TEAM_GREY
    });
    return;
  }

  drawTableHeader();

  athletes.forEach((a, i) => {
    ensureSpace();
    const techs = Array.isArray(a.techniques)
      ? a.techniques.map((t) => String(t)).join(' / ')
      : '';
    const cells = [
      { text: String(i + 1), w: rankW, useBold: false },
      { text: placementName(a), w: nameW, useBold: true },
      { text: techs, w: scoresW, useBold: false },
      { text: a.total != null ? String(a.total) : '', w: totalW, useBold: true }
    ];
    let x = MARGIN;
    cells.forEach((col) => {
      const drawn = fitText(col.useBold ? bold : font, col.text, col.w - 3, 8);
      current.drawText(drawn, {
        x,
        y,
        size: 8,
        font: col.useBold ? bold : font,
        color: NAME_BLACK
      });
      x += col.w;
    });
    y -= rowH;
  });
}

async function mergePdfBuffers(buffers) {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    if (!buf || !buf.length) continue;
    const src = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

/**
 * Spare/demo results may embed pools, rounds, or bracket matches in result_json
 * when there is no matching draws.state_json row.
 */
function mergeDrawLayout(drawJson, result) {
  const d = drawJson && typeof drawJson === 'object' ? { ...drawJson } : {};
  const r = result && typeof result === 'object' ? result : {};
  if (!(Array.isArray(d.pools) && d.pools.length) && Array.isArray(r.pools) && r.pools.length) {
    d.pools = r.pools;
  }
  if (!(Array.isArray(d.athletes) && d.athletes.length)
    && Array.isArray(r.athletes) && r.athletes.length) {
    d.athletes = r.athletes;
  }
  if (!d.elimination && r.elimination) d.elimination = r.elimination;
  if (!(Array.isArray(d.elimination_matches) && d.elimination_matches.length)
    && Array.isArray(r.elimination_matches) && r.elimination_matches.length) {
    d.elimination_matches = r.elimination_matches;
  }
  if (!(Array.isArray(d.rounds) && d.rounds.length) && Array.isArray(r.rounds) && r.rounds.length) {
    d.rounds = r.rounds;
  }
  if (!(Array.isArray(d.matches) && d.matches.length)
    && Array.isArray(r.bracket_matches) && r.bracket_matches.length) {
    d.matches = r.bracket_matches;
  }
  return Object.keys(d).length ? d : null;
}

async function buildDivisionResultsPdf(entry, options = {}) {
  const result = entry?.result || {};
  const drawJson = mergeDrawLayout(entry?.drawJson || null, result);
  const eventName = String(options.eventName || result.event_name || '').trim();
  const divisionName = String(
    entry.divisionName || result.division_name || entry.drawId || 'Division'
  ).trim();
  const divisionType = String(
    entry.divisionType || result.division_type || drawJson?.division_type || ''
  ).trim();
  const eventKey = String(entry.eventKey || result.event_key || drawJson?.event_key || '').trim();

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let y = drawPdfHeader(page, bold, font, {
    divisionName,
    eventName,
    divisionType,
    eventKey
  });

  const headerMeta = {
    divisionName,
    eventName,
    divisionType,
    eventKey
  };
  const type = divisionType.toLowerCase();
  const isList = type.includes('list')
    || (Array.isArray(result.list_athletes) && result.list_athletes.length > 0);

  if (isList) {
    drawListResults(pdfDoc, page, bold, font, y, result, headerMeta);
    return pdfDoc.save();
  }

  y = drawStandingsBlock(page, bold, font, y, result, divisionType);

  // Reserve ascent so this label does not sit inside the standings rows above.
  const bracketTitleSize = 10;
  y -= bracketTitleSize;
  page.drawText('Final bracket / matches', {
    x: MARGIN,
    y,
    size: bracketTitleSize,
    font: bold
  });
  y -= 10;

  const resultMap = indexResultMatches(result);
  const resultMatches = (result.matches || []).map(normalizeResultMatch).filter(Boolean);

  if (type.includes('single') || type.includes('elim')) {
    drawSingleElimTree(page, bold, font, y, drawJson, resultMatches, resultMap);
  } else if (type.includes('premier')) {
    drawPremierLeagueTree(
      pdfDoc,
      page,
      bold,
      font,
      y,
      drawJson,
      resultMatches,
      resultMap,
      headerMeta,
      result
    );
  } else if (type.includes('round')) {
    const matches = drawJson?.matches?.length ? drawJson.matches : resultMatches;
    drawRoundRobinTree(page, bold, font, y, matches, resultMap);
  } else if (resultMatches.length) {
    // Unknown type with matches — show as match boxes.
    drawRoundRobinTree(page, bold, font, y, resultMatches, resultMap);
  } else {
    page.drawText('No match bracket available for this division.', {
      x: MARGIN,
      y: y - 14,
      size: 10,
      font,
      color: TEAM_GREY
    });
  }

  return pdfDoc.save();
}

async function buildResultsPdfFiles(results, options = {}) {
  const pdfFiles = {};
  const buffers = [];

  for (const entry of results || []) {
    if (!entry || !entry.result) continue;
    const safeName = safeDivisionBasename(
      entry.divisionName || entry.result.division_name || entry.drawId || 'division'
    );
    const pdfName = `${safeName}_results.pdf`;
    try {
      const bytes = await buildDivisionResultsPdf(entry, options);
      const buf = Buffer.from(bytes);
      pdfFiles[pdfName] = buf;
      buffers.push(bytes);
    } catch (err) {
      console.error('results pdf build failed for', safeName, err);
    }
  }

  if (buffers.length) {
    const all = await mergePdfBuffers(buffers);
    pdfFiles[ALL_RESULTS_PDF_FILENAME] = Buffer.from(all);
  }

  return pdfFiles;
}

async function buildAllResultsPdf(results, options = {}) {
  const files = await buildResultsPdfFiles(results, options);
  return files[ALL_RESULTS_PDF_FILENAME] || null;
}

module.exports = {
  buildDivisionResultsPdf,
  buildResultsPdfFiles,
  buildAllResultsPdf,
  ALL_RESULTS_PDF_FILENAME,
  derivePremierLeagueOverallPlacements
};
