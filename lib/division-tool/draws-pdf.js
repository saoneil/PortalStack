const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { ALL_DRAWS_PDF_FILENAME, EVENT_DISPLAY_NAMES } = require('./constants');
const { safeDivisionBasename, stripDivisionTypeTag } = require('./utils');

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 36;
const TEAM_GREY = rgb(0.32, 0.32, 0.32);
const NAME_BLACK = rgb(0, 0, 0);

function fitText(font, text, maxWidth, size) {
  let t = String(text || '');
  if (!t) return '';
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  const ellipsis = '...';
  while (t.length && font.widthOfTextAtSize(t + ellipsis, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t ? `${t}${ellipsis}` : ellipsis;
}

function wrapText(font, text, maxWidth, size) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (font.widthOfTextAtSize(raw, size) <= maxWidth) return [raw];
  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial;
      return;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      return;
    }
    // Hard-break an oversized word
    let chunk = '';
    for (const ch of word) {
      const next = chunk + ch;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        chunk = next;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  });
  if (current) lines.push(current);
  return lines.length ? lines : [fitText(font, raw, maxWidth, size)];
}

function largestFittingSize(font, text, maxWidth, maxSize, minSize = 7) {
  const t = String(text || '').trim();
  if (!t) return minSize;
  let size = Math.floor(Number(maxSize) || minSize);
  const floor = Math.max(1, Number(minSize) || 7);
  while (size > floor && font.widthOfTextAtSize(t, size) > maxWidth) {
    size -= 0.5;
  }
  return Math.max(floor, size);
}

/** Shrink font so `prefix + text` fits in maxWidth (used for " - team"). */
function largestFittingSizeWithPrefix(font, prefix, text, maxWidth, maxSize, minSize = 5) {
  const t = String(text || '').trim();
  const p = String(prefix || '');
  if (!t) return Math.max(1, Number(minSize) || 5);
  let size = Number(maxSize) || minSize;
  const floor = Math.max(1, Number(minSize) || 5);
  while (
    size > floor
    && font.widthOfTextAtSize(p, size) + font.widthOfTextAtSize(t, size) > maxWidth
  ) {
    size -= 0.5;
  }
  return Math.max(floor, size);
}

/**
 * Single-line athlete name (bold black) + optional " - team" (regular grey).
 * Team text shrinks to stay fully visible; name may still ellipsize if needed.
 */
function drawAthleteNameTeam(page, {
  bold,
  font,
  name = '',
  team = '',
  x,
  y,
  maxWidth,
  nameSize = 10,
  teamSize = 9
} = {}) {
  const nm = String(name || '').trim();
  const tm = String(team || '').trim();
  if (!nm && !tm) return 0;

  if (!tm) {
    const drawn = fitText(bold, nm, maxWidth, nameSize);
    page.drawText(drawn, {
      x,
      y,
      size: nameSize,
      font: bold,
      color: NAME_BLACK
    });
    return bold.widthOfTextAtSize(drawn, nameSize);
  }

  const sep = ' - ';
  const minTeamSize = 5;
  let nameDrawn = nm;
  let nameW = bold.widthOfTextAtSize(nameDrawn, nameSize);

  // Reserve room for the team; ellipsize the name if it crowds the team out.
  const minTeamRoom = Math.min(72, Math.max(28, maxWidth * 0.28));
  if (nameW + minTeamRoom > maxWidth) {
    nameDrawn = fitText(bold, nm, Math.max(12, maxWidth - minTeamRoom), nameSize);
    nameW = bold.widthOfTextAtSize(nameDrawn, nameSize);
  }

  const teamBudget = Math.max(8, maxWidth - nameW);
  let drawnTeamSize = largestFittingSizeWithPrefix(
    font,
    sep,
    tm,
    teamBudget,
    Math.min(teamSize, nameSize),
    minTeamSize
  );
  let sepW = font.widthOfTextAtSize(sep, drawnTeamSize);
  let teamDrawn = tm;
  let teamW = font.widthOfTextAtSize(teamDrawn, drawnTeamSize);

  // Last resort only: if still too wide at the minimum size, ellipsize team.
  if (sepW + teamW > teamBudget) {
    teamDrawn = fitText(font, tm, Math.max(4, teamBudget - sepW), drawnTeamSize);
    teamW = font.widthOfTextAtSize(teamDrawn, drawnTeamSize);
  }

  page.drawText(nameDrawn, {
    x,
    y,
    size: nameSize,
    font: bold,
    color: NAME_BLACK
  });
  page.drawText(sep, {
    x: x + nameW,
    y,
    size: drawnTeamSize,
    font,
    color: TEAM_GREY
  });
  page.drawText(teamDrawn, {
    x: x + nameW + sepW,
    y,
    size: drawnTeamSize,
    font,
    color: TEAM_GREY
  });
  return nameW + sepW + teamW;
}

/**
 * PL pool row: largest bold name on the left (wrap only if needed);
 * " - team" stays on the right in grey (font shrinks to fit the full team).
 */
function drawPoolAthleteRow(page, {
  bold,
  font,
  name = '',
  team = '',
  x,
  rowTop,
  rowBottom,
  rowWidth,
  pad = 6
} = {}) {
  const nm = String(name || '').trim();
  const tm = String(team || '').trim();
  if (!nm && !tm) return;

  const innerW = Math.max(20, rowWidth - pad * 2);
  const rowH = Math.max(8, rowTop - rowBottom);
  let rightW = 0;
  if (tm) {
    rightW = Math.max(36, innerW * 0.38);
    const maxTeamSizeProbe = Math.min(14, Math.max(7, rowH * 0.4));
    const minTeamSizeProbe = 4.5;
    // Grow the team column (up to half the row) so the full club/country can fit at a readable size.
    while (
      rightW < innerW * 0.52
      && font.widthOfTextAtSize('- ', minTeamSizeProbe)
        + font.widthOfTextAtSize(tm, minTeamSizeProbe) > rightW
    ) {
      rightW += 4;
    }
    // Prefer a larger size if a bit more width gets us above the floor.
    const fitAtMax = largestFittingSizeWithPrefix(
      font, '- ', tm, rightW, maxTeamSizeProbe, minTeamSizeProbe
    );
    if (fitAtMax <= minTeamSizeProbe + 0.5 && rightW < innerW * 0.55) {
      rightW = Math.min(innerW * 0.55, rightW + 12);
    }
  }
  const leftW = innerW - rightW - (tm ? 4 : 0);
  const leftX = x + pad;
  const rightX = x + pad + leftW + 4;

  const maxNameSize = Math.min(14, Math.max(8, rowH * 0.55));
  const minNameSize = 7;
  let nameSize = largestFittingSize(bold, nm, leftW, maxNameSize, minNameSize);
  let lines = wrapText(bold, nm, leftW, nameSize);

  // If wrapping at floor still produces too many lines for the row, shrink further.
  const lineGap = 1.15;
  const maxLines = Math.max(1, Math.floor(rowH / (minNameSize * lineGap)));
  while (lines.length > maxLines && nameSize > minNameSize) {
    nameSize -= 0.5;
    lines = wrapText(bold, nm, leftW, nameSize);
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1] || '';
    lines[maxLines - 1] = fitText(bold, last, leftW, nameSize);
  }

  const blockH = lines.length * nameSize * lineGap;
  let nameY = rowTop - (rowH - blockH) / 2 - nameSize * 0.85;
  lines.forEach((line) => {
    page.drawText(line, {
      x: leftX,
      y: nameY,
      size: nameSize,
      font: bold,
      color: NAME_BLACK
    });
    nameY -= nameSize * lineGap;
  });

  if (tm) {
    const sep = '- ';
    const maxTeamSize = Math.min(nameSize, Math.max(7, rowH * 0.4));
    const minTeamSize = 4.5;
    let drawnTeamSize = largestFittingSizeWithPrefix(
      font,
      sep,
      tm,
      rightW,
      maxTeamSize,
      minTeamSize
    );
    let sepW = font.widthOfTextAtSize(sep, drawnTeamSize);
    let teamDrawn = tm;
    if (sepW + font.widthOfTextAtSize(teamDrawn, drawnTeamSize) > rightW) {
      teamDrawn = fitText(font, tm, Math.max(4, rightW - sepW), drawnTeamSize);
    }
    const teamY = rowBottom + (rowH - drawnTeamSize) / 2;
    page.drawText(sep, {
      x: rightX,
      y: teamY,
      size: drawnTeamSize,
      font,
      color: TEAM_GREY
    });
    page.drawText(teamDrawn, {
      x: rightX + sepW,
      y: teamY,
      size: drawnTeamSize,
      font,
      color: TEAM_GREY
    });
  }
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
  return toTitleCaseWords(raw);
}

/**
 * Draw centered division title + event / type / event-key metadata.
 * @returns {number} y coordinate just below the header (start of content)
 */
function drawPdfHeader(page, bold, font, {
  divisionName = '',
  eventName = '',
  divisionType = '',
  eventKey = ''
} = {}) {
  const usableW = PAGE_W - 2 * MARGIN;
  let y = PAGE_H - MARGIN;
  const title = stripDivisionTypeTag(divisionName);
  const titleText = fitText(bold, title, usableW, 14);
  page.drawText(titleText, {
    x: (PAGE_W - bold.widthOfTextAtSize(titleText, 14)) / 2,
    y,
    size: 14,
    font: bold
  });
  y -= 16;

  const bits = [];
  const en = String(eventName || '').trim();
  if (en) bits.push(en);
  const dt = formatDivisionTypeLabel(divisionType);
  if (dt) bits.push(dt);
  const ek = formatEventKeyLabel(eventKey);
  if (ek) bits.push(ek);
  if (bits.length) {
    const meta = fitText(font, bits.join('  ·  '), usableW, 10);
    page.drawText(meta, {
      x: (PAGE_W - font.widthOfTextAtSize(meta, 10)) / 2,
      y,
      size: 10,
      font,
      color: rgb(0.28, 0.28, 0.28)
    });
    y -= 14;
  }
  return y - 6;
}

function resolvePdfMeta(entry, json, options = {}) {
  return {
    eventName: String(options.eventName || '').trim(),
    divisionType: String(
      options.divisionType
      || entry?.division_type
      || json?.division_type
      || ''
    ).trim(),
    eventKey: String(
      options.eventKey
      || entry?.event_key
      || json?.event_key
      || ''
    ).trim()
  };
}

function competitorFromSide(side) {
  if (!side || typeof side !== 'object') return { name: 'BYE', team: '' };
  if (side.bye) return { name: 'BYE', team: '' };
  if (side.competitor) {
    return {
      name: String(side.competitor.name || '').trim() || 'BYE',
      team: String(side.competitor.country_dirty || side.competitor.country || '').trim()
    };
  }
  const name = String(side.name || '').trim();
  if (!name || name.toUpperCase() === 'BYE') return { name: 'BYE', team: '' };
  return {
    name,
    team: String(side.country_dirty || side.country || '').trim()
  };
}

function premierSlotLabel(entry, athletesById) {
  if (!entry || typeof entry !== 'object') return { name: '', team: '' };
  const competitorId = String(entry.competitor_id || '').trim();
  if (competitorId) {
    const a = athletesById[competitorId];
    if (a) {
      return {
        name: String(a.name || '').trim(),
        team: String(a.country_dirty || a.country || '').trim()
      };
    }
  }
  const poolId = String(entry.pool_id || '').trim();
  if (poolId) {
    return { name: `${poolId} #${entry.pool_rank != null ? entry.pool_rank : 1}`, team: '' };
  }
  const matchId = String(entry.match_id || entry.source_match_id || '').trim();
  if (matchId) {
    const result = String(entry.result || entry.source || 'winner').trim().toLowerCase() || 'winner';
    return {
      name: result === 'winner' ? `Winner of ${matchId}` : `${result} of ${matchId}`,
      team: ''
    };
  }
  return competitorFromSide(entry);
}

async function buildListPdf(competitors, divisionName, meta = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const usableW = PAGE_W - 2 * MARGIN;
  let y = drawPdfHeader(page, bold, font, {
    divisionName,
    eventName: meta.eventName,
    divisionType: meta.divisionType || 'List',
    eventKey: meta.eventKey
  });

  const headers = ['Athlete', 'Team', 'Technique 1', 'Technique 2', 'Technique 3', 'Technique 4', 'Technique 5'];
  const colWidths = [220, 90];
  const techniqueW = (usableW - colWidths[0] - colWidths[1]) / 5;
  colWidths.push(techniqueW, techniqueW, techniqueW, techniqueW, techniqueW);

  const headerH = 26;
  const rowH = 24;

  const drawHeader = (targetPage, topY) => {
    let x = MARGIN;
    targetPage.drawRectangle({
      x: MARGIN,
      y: topY - headerH,
      width: usableW,
      height: headerH,
      color: rgb(0.94, 0.94, 0.94),
      borderColor: rgb(0, 0, 0),
      borderWidth: 1
    });
    headers.forEach((h, i) => {
      targetPage.drawRectangle({
        x,
        y: topY - headerH,
        width: colWidths[i],
        height: headerH,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1
      });
      targetPage.drawText(fitText(bold, h, colWidths[i] - 8, 9), {
        x: x + 4,
        y: topY - 17,
        size: 9,
        font: bold
      });
      x += colWidths[i];
    });
    return topY - headerH;
  };

  let currentPage = page;
  y = drawHeader(currentPage, y);
  competitors.forEach((comp) => {
    if (y - rowH < MARGIN) {
      currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = drawPdfHeader(currentPage, bold, font, {
        divisionName,
        eventName: meta.eventName,
        divisionType: meta.divisionType || 'List',
        eventKey: meta.eventKey
      });
      y = drawHeader(currentPage, y);
    }
    let x = MARGIN;
    const cells = [
      String(comp.name || ''),
      String(comp.pdf_team || comp.team || ''),
      '', '', '', '', ''
    ];
    cells.forEach((cell, i) => {
      currentPage.drawRectangle({
        x,
        y: y - rowH,
        width: colWidths[i],
        height: rowH,
        borderColor: rgb(0.18, 0.18, 0.18),
        borderWidth: 1
      });
      if (cell) {
        if (i === 0) {
          currentPage.drawText(fitText(bold, cell, colWidths[i] - 8, 9), {
            x: x + 4,
            y: y - 16,
            size: 9,
            font: bold,
            color: NAME_BLACK
          });
        } else if (i === 1) {
          const teamColW = colWidths[i] - 8;
          const teamFontSize = largestFittingSize(font, cell, teamColW, 9, 5);
          const teamDrawn = font.widthOfTextAtSize(cell, teamFontSize) <= teamColW
            ? cell
            : fitText(font, cell, teamColW, teamFontSize);
          currentPage.drawText(teamDrawn, {
            x: x + 4,
            y: y - 16,
            size: teamFontSize,
            font,
            color: TEAM_GREY
          });
        } else {
          currentPage.drawText(fitText(font, cell, colWidths[i] - 8, 9), {
            x: x + 4,
            y: y - 16,
            size: 9,
            font
          });
        }
      }
      x += colWidths[i];
    });
    y -= rowH;
  });

  return pdfDoc.save();
}

async function buildRoundRobinPdf(jsonData, divisionName, meta = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const matches = (jsonData.matches || []).filter((m) => m && typeof m === 'object');
  const contentTop = drawPdfHeader(page, bold, font, {
    divisionName: divisionName || jsonData.division_name || '',
    eventName: meta.eventName,
    divisionType: meta.divisionType || jsonData.division_type || 'Round Robin',
    eventKey: meta.eventKey || jsonData.event_key
  });

  const maxRows = 5;
  const rows = Math.min(maxRows, Math.max(1, matches.length));
  const cols = Math.max(1, Math.ceil(matches.length / maxRows));
  const boxW = 210;
  const boxH = 78;
  const rowGap = 12;
  const colGap = 24;
  const contentW = cols * boxW + Math.max(0, cols - 1) * colGap;
  const contentH = rows * boxH + Math.max(0, rows - 1) * rowGap;
  const gridLeft = (PAGE_W - contentW) / 2;
  const gridTop = contentTop - 8 - contentH;

  matches.forEach((match, idx) => {
    const col = Math.floor(idx / rows);
    const row = idx % rows;
    const x1 = gridLeft + col * (boxW + colGap);
    const y2 = gridTop + contentH - row * (boxH + rowGap);
    const y1 = y2 - boxH;
    const headerH = 18;
    page.drawRectangle({
      x: x1,
      y: y1,
      width: boxW,
      height: boxH,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1
    });
    page.drawLine({
      start: { x: x1, y: y2 - headerH },
      end: { x: x1 + boxW, y: y2 - headerH },
      thickness: 1,
      color: rgb(0.2, 0.2, 0.2)
    });
    page.drawLine({
      start: { x: x1, y: y1 + (boxH - headerH) / 2 },
      end: { x: x1 + boxW, y: y1 + (boxH - headerH) / 2 },
      thickness: 0.6,
      color: rgb(0.55, 0.55, 0.55)
    });
    const label = String(match.draw_label || `Match ${idx + 1}`);
    page.drawText(fitText(bold, label, boxW - 12, 10), {
      x: x1 + 6,
      y: y2 - 13,
      size: 10,
      font: bold
    });
    const aka = competitorFromSide(match.aka);
    const ao = competitorFromSide(match.ao);
    const laneH = (boxH - headerH) / 2;
    const drawLane = (comp, top) => {
      drawAthleteNameTeam(page, {
        bold,
        font,
        name: comp.name,
        team: comp.team,
        x: x1 + 6,
        y: top - 16,
        maxWidth: boxW - 12,
        nameSize: 10,
        teamSize: 9
      });
    };
    drawLane(aka, y2 - headerH);
    drawLane(ao, y2 - headerH - laneH);
  });

  return pdfDoc.save();
}

async function buildSingleElimPdf(jsonData, divisionName, meta = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const contentTop = drawPdfHeader(page, bold, font, {
    divisionName: divisionName || jsonData.division_name || '',
    eventName: meta.eventName,
    divisionType: meta.divisionType || jsonData.division_type || 'Single Elimination',
    eventKey: meta.eventKey || jsonData.event_key
  });

  const matches = (jsonData.matches || []).filter((m) => m && typeof m === 'object');
  const rounds = [...(jsonData.rounds || [])]
    .filter((r) => r && typeof r === 'object')
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  const byRound = new Map();
  rounds.forEach((r) => byRound.set(String(r.round_id), []));
  matches.forEach((m) => {
    const key = String(m.round_id || 'R1');
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(m);
  });

  const roundIds = rounds.length
    ? rounds.map((r) => String(r.round_id))
    : [...byRound.keys()].sort((a, b) => {
      const na = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
      return na - nb;
    });

  if (!roundIds.length) {
    page.drawText('No matches in this draw.', {
      x: MARGIN,
      y: contentTop - 24,
      size: 11,
      font,
      color: rgb(0.35, 0.35, 0.35)
    });
    return pdfDoc.save();
  }

  const sortMatches = (list) => [...list].sort((a, b) => {
    const na = parseInt(String(a.match_id || '').replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(String(b.match_id || '').replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });

  const firstList = sortMatches(byRound.get(roundIds[0]) || matches);
  const nFirst = Math.max(1, firstList.length);
  const colCount = roundIds.length;

  const labelBand = 18;
  const usableH = Math.max(80, contentTop - MARGIN - labelBand - 6);
  const usableW = PAGE_W - 2 * MARGIN;
  const hGapIdeal = 28;
  const boxW = Math.min(168, Math.max(96, (usableW - Math.max(0, colCount - 1) * hGapIdeal) / colCount));
  const hGap = colCount > 1
    ? Math.max(18, (usableW - colCount * boxW) / (colCount - 1))
    : 0;
  const vGapIdeal = 8;
  const boxH = Math.min(58, Math.max(36, (usableH - Math.max(0, nFirst - 1) * vGapIdeal) / nFirst));
  const vGap = nFirst > 1
    ? Math.max(4, (usableH - nFirst * boxH) / (nFirst - 1))
    : 0;

  const gridLeft = MARGIN + Math.max(0, (usableW - (colCount * boxW + Math.max(0, colCount - 1) * hGap)) / 2);
  const gridTop = contentTop - labelBand;

  /** @type {Record<string, { x: number, y2: number, y1: number, match: object }>} */
  const positions = {};

  roundIds.forEach((rid, col) => {
    const list = sortMatches(byRound.get(rid) || []);
    list.forEach((m, i) => {
      const id = String(m.match_id || `M${col}-${i}`);
      let y2;
      if (col === 0) {
        y2 = gridTop - i * (boxH + vGap);
      } else {
        const srcA = m.aka?.source_match_id;
        const srcB = m.ao?.source_match_id;
        const ya = srcA != null ? positions[String(srcA)]?.y2 : null;
        const yb = srcB != null ? positions[String(srcB)]?.y2 : null;
        if (ya != null && yb != null) y2 = (ya + yb) / 2;
        else if (ya != null) y2 = ya;
        else if (yb != null) y2 = yb;
        else y2 = gridTop - i * (boxH + vGap);
      }
      positions[id] = {
        x: gridLeft + col * (boxW + hGap),
        y2,
        y1: y2 - boxH,
        match: m
      };
    });
  });

  // Round headers
  roundIds.forEach((rid, col) => {
    const round = rounds.find((r) => String(r.round_id) === rid);
    const label = String(round?.name || rid);
    const x = gridLeft + col * (boxW + hGap);
    const drawn = fitText(bold, label, boxW, 10);
    page.drawText(drawn, {
      x: x + (boxW - bold.widthOfTextAtSize(drawn, 10)) / 2,
      y: contentTop - 2,
      size: 10,
      font: bold
    });
  });

  const lineColor = rgb(0.35, 0.35, 0.35);
  const drawConnector = (x1, y1, x2, y2) => {
    const midX = (x1 + x2) / 2;
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: midX, y: y1 },
      thickness: 1.1,
      color: lineColor
    });
    page.drawLine({
      start: { x: midX, y: y1 },
      end: { x: midX, y: y2 },
      thickness: 1.1,
      color: lineColor
    });
    page.drawLine({
      start: { x: midX, y: y2 },
      end: { x: x2, y: y2 },
      thickness: 1.1,
      color: lineColor
    });
  };

  // Connectors behind match boxes (source → destination).
  Object.values(positions).forEach((pos) => {
    const m = pos.match;
    ['aka', 'ao'].forEach((side) => {
      const srcId = m[side]?.source_match_id;
      if (srcId == null) return;
      const src = positions[String(srcId)];
      if (!src) return;
      drawConnector(
        src.x + boxW,
        src.y1 + boxH / 2,
        pos.x,
        pos.y1 + boxH / 2
      );
    });
  });

  const headerH = Math.min(14, Math.max(11, boxH * 0.28));
  Object.values(positions).forEach((pos) => {
    const { x, y1, y2, match } = pos;
    page.drawRectangle({
      x,
      y: y1,
      width: boxW,
      height: boxH,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1,
      color: rgb(1, 1, 1)
    });
    page.drawLine({
      start: { x, y: y2 - headerH },
      end: { x: x + boxW, y: y2 - headerH },
      thickness: 1,
      color: rgb(0.2, 0.2, 0.2)
    });
    page.drawLine({
      start: { x, y: y1 + (boxH - headerH) / 2 },
      end: { x: x + boxW, y: y1 + (boxH - headerH) / 2 },
      thickness: 0.6,
      color: rgb(0.55, 0.55, 0.55)
    });

    const mid = String(match.match_id || '');
    if (mid) {
      page.drawText(fitText(bold, mid, boxW - 10, 8), {
        x: x + 5,
        y: y2 - headerH + Math.max(1, (headerH - 8) / 2),
        size: 8,
        font: bold
      });
    }

    const aka = competitorFromSide(match.aka);
    const ao = competitorFromSide(match.ao);
    const laneH = (boxH - headerH) / 2;
    const nameSize = Math.min(9, Math.max(6.5, laneH * 0.45));
    const drawLane = (comp, laneTop) => {
      const name = String(comp.name || '').trim();
      if (!name) return;
      drawAthleteNameTeam(page, {
        bold,
        font,
        name: comp.name,
        team: comp.team,
        x: x + 5,
        y: laneTop - Math.min(13, laneH * 0.62),
        maxWidth: boxW - 10,
        nameSize,
        teamSize: Math.max(5, nameSize - 1)
      });
    };
    drawLane(aka, y2 - headerH);
    drawLane(ao, y2 - headerH - laneH);
  });

  return pdfDoc.save();
}

async function buildPremierLeaguePdf(jsonData, divisionName, meta = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const contentTop = drawPdfHeader(page, bold, font, {
    divisionName: divisionName || jsonData.division_name || '',
    eventName: meta.eventName,
    divisionType: meta.divisionType || jsonData.division_type || 'Premier League',
    eventKey: meta.eventKey || jsonData.event_key
  });

  const pools = (jsonData.pools || []).filter((p) => p && typeof p === 'object');
  const elimMatches = (
    (jsonData.elimination && jsonData.elimination.matches) ||
    jsonData.elimination_matches ||
    []
  ).filter((m) => m && typeof m === 'object');
  const athletesById = {};
  (jsonData.athletes || []).forEach((a) => {
    if (a?.id != null) athletesById[String(a.id)] = a;
  });

  const poolSlotCount = 5;
  // Narrow elim boxes (Pool A #1 style labels) in two columns.
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
    size: 11,
    font: bold
  });
  if (elimMatches.length) {
    page.drawText('Elimination', {
      x: elimAreaLeft,
      y: contentTop,
      size: 11,
      font: bold
    });
  }

  const poolCols = pools.length >= 8 ? 2 : 1;
  const poolRows = pools.length >= 8 ? 4 : Math.max(1, pools.length);
  const poolGapY = 10;
  const poolGapX = 12;
  const poolCellW = (poolAreaW - Math.max(0, poolCols - 1) * poolGapX) / Math.max(1, poolCols);
  // 40% narrower than the full grid cell; left-aligned in the cell.
  const poolBoxW = poolCellW * 0.6;
  const poolAreaH = contentTop - MARGIN - 20;
  const poolBoxH = (poolAreaH - Math.max(0, poolRows - 1) * poolGapY) / Math.max(1, poolRows);
  const headerH = Math.max(20, poolBoxH * 0.18);
  const athleteRowH = (poolBoxH - headerH) / poolSlotCount;
  const poolHeaderSize = Math.min(13, Math.max(10, headerH * 0.55));

  pools.forEach((pool, pi) => {
    const gridCol = Math.floor(pi / poolRows);
    const gridRow = pi % poolRows;
    const x1 = MARGIN + gridCol * (poolCellW + poolGapX);
    const y2 = contentTop - 18 - gridRow * (poolBoxH + poolGapY);
    const y1 = y2 - poolBoxH;
    page.drawRectangle({
      x: x1,
      y: y1,
      width: poolBoxW,
      height: poolBoxH,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1
    });
    page.drawRectangle({
      x: x1,
      y: y2 - headerH,
      width: poolBoxW,
      height: headerH,
      color: rgb(0.93, 0.93, 0.93),
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1
    });
    const poolId = String(pool.pool_id || `Pool ${pi + 1}`);
    page.drawText(fitText(bold, poolId, poolBoxW - 10, poolHeaderSize), {
      x: x1 + 6,
      y: y2 - headerH + Math.max(4, (headerH - poolHeaderSize) / 2),
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
        color: rgb(0.7, 0.7, 0.7)
      });
      const cid = competitorIds[ai];
      const a = cid != null ? athletesById[String(cid)] : null;
      if (!a) continue;
      drawPoolAthleteRow(page, {
        bold,
        font,
        name: String(a.name || '').trim(),
        team: String(a.country_dirty || a.country || '').trim(),
        x: x1,
        rowTop,
        rowBottom,
        rowWidth: poolBoxW,
        pad: 5
      });
    }
  });

  if (elimMatches.length) {
    const elimBoxH = 48;
    const elimHeaderH = 14;
    const elimRows = Math.ceil(elimMatches.length / elimCols);
    const elimBlockH = elimRows * elimBoxH + Math.max(0, elimRows - 1) * 8;
    const elimTop = contentTop - 18;
    const elimStartY = elimTop - Math.max(0, (poolAreaH - elimBlockH) / 2);

    elimMatches.forEach((match, mi) => {
      const col = mi % elimCols;
      const row = Math.floor(mi / elimCols);
      const x1 = elimAreaLeft + col * (elimBoxW + elimColGap);
      const y2 = elimStartY - row * (elimBoxH + 8);
      const y1 = y2 - elimBoxH;
      page.drawRectangle({
        x: x1,
        y: y1,
        width: elimBoxW,
        height: elimBoxH,
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 1
      });
      page.drawLine({
        start: { x: x1, y: y2 - elimHeaderH },
        end: { x: x1 + elimBoxW, y: y2 - elimHeaderH },
        thickness: 1,
        color: rgb(0.2, 0.2, 0.2)
      });
      page.drawLine({
        start: { x: x1, y: y1 + (elimBoxH - elimHeaderH) / 2 },
        end: { x: x1 + elimBoxW, y: y1 + (elimBoxH - elimHeaderH) / 2 },
        thickness: 0.6,
        color: rgb(0.55, 0.55, 0.55)
      });
      const header = `${String(match.match_id || `E${mi + 1}`)} ${String(match.stage || '').trim()}`.trim();
      page.drawText(fitText(bold, header, elimBoxW - 8, 8), {
        x: x1 + 4,
        y: y2 - 11,
        size: 8,
        font: bold
      });
      const aka = premierSlotLabel(match.aka, athletesById);
      const ao = premierSlotLabel(match.ao, athletesById);
      const laneH = (elimBoxH - elimHeaderH) / 2;
      const drawElimLane = (slot, laneTop) => {
        drawAthleteNameTeam(page, {
          bold,
          font,
          name: slot.name,
          team: slot.team,
          x: x1 + 4,
          y: laneTop - laneH / 2 - 3,
          maxWidth: elimBoxW - 8,
          nameSize: 8,
          teamSize: 7
        });
      };
      drawElimLane(aka, y2 - elimHeaderH);
      drawElimLane(ao, y1 + laneH);
    });
  }

  return pdfDoc.save();
}

async function buildTextPdfFromBody(divisionName, bodyText, meta = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let y = drawPdfHeader(page, bold, font, {
    divisionName,
    eventName: meta.eventName,
    divisionType: meta.divisionType,
    eventKey: meta.eventKey
  });
  y -= 8;
  for (const line of String(bodyText || '').split('\n')) {
    if (y < MARGIN) break;
    const text = String(line || '').slice(0, 120);
    if (text) {
      page.drawText(text, { x: MARGIN, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    }
    y -= 14;
  }
  return pdfDoc.save();
}

async function buildPdfForCatalogEntry(entry, options = {}) {
  const divisionName = entry.division_name || entry.id;
  const json = entry.json_data;
  const type = String(json?.division_type || entry.division_type || '').trim();
  const meta = resolvePdfMeta(entry, json, options);

  if (type === 'List') {
    let competitors = (json?.rows || []).map((r) => ({
      name: r.name,
      team: r.team,
      pdf_team: r.team
    }));
    if (!competitors.length && entry.body_text) {
      const parsed = [];
      let pastHeader = false;
      String(entry.body_text).split('\n').forEach((line) => {
        const t = line.trim();
        if (!t) {
          pastHeader = true;
          return;
        }
        if (!pastHeader) return;
        if (t.includes(' | ')) {
          const [name, team] = t.split(' | ', 2);
          parsed.push({ name: name.trim(), team: team.trim(), pdf_team: team.trim() });
        }
      });
      competitors = parsed;
    }
    if (competitors.length) return buildListPdf(competitors, divisionName, meta);
  }

  if (type === 'Round Robin' && json?.matches) {
    return buildRoundRobinPdf(json, divisionName, meta);
  }
  if (type === 'Single Elimination' && json?.matches) {
    return buildSingleElimPdf(json, divisionName, meta);
  }
  if (type === 'Premier League' && json?.pools) {
    return buildPremierLeaguePdf(json, divisionName, meta);
  }

  return buildTextPdfFromBody(divisionName, entry.body_text || '', meta);
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

async function buildDrawFilesFromState(drawsState, options = {}) {
  const plainFiles = {};
  const pdfFiles = {};
  const pdfBuffers = [];

  for (const entry of drawsState.catalog || []) {
    if (!entry.athlete_count) continue;
    const safeName = safeDivisionBasename(entry.id || entry.division_name);
    const txtName = `${safeName}.txt`;
    const pdfName = `${safeName}.pdf`;
    plainFiles[txtName] = entry.body_text || '';
    try {
      const pdfBytes = await buildPdfForCatalogEntry(entry, options);
      pdfFiles[pdfName] = Buffer.from(pdfBytes);
      pdfBuffers.push(pdfBytes);
    } catch (err) {
      pdfFiles[pdfName] = Buffer.from(
        await buildTextPdfFromBody(
          entry.division_name,
          `PDF error: ${err.message}\n\n${entry.body_text || ''}`,
          resolvePdfMeta(entry, entry.json_data, options)
        )
      );
      pdfBuffers.push(pdfFiles[pdfName]);
    }
  }

  if (pdfBuffers.length) {
    const allDraws = await mergePdfBuffers(pdfBuffers);
    pdfFiles[ALL_DRAWS_PDF_FILENAME] = Buffer.from(allDraws);
  }

  return { plainFiles, pdfFiles };
}

async function buildPdfFilesFromState(drawsState, options = {}) {
  const { pdfFiles } = await buildDrawFilesFromState(drawsState, options);
  return pdfFiles;
}

module.exports = {
  buildListPdf,
  buildRoundRobinPdf,
  buildSingleElimPdf,
  buildPremierLeaguePdf,
  buildTextPdfFromBody,
  buildPdfForCatalogEntry,
  mergePdfBuffers,
  buildDrawFilesFromState,
  buildPdfFilesFromState
};
