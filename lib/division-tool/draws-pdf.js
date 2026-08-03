const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { ALL_DRAWS_PDF_FILENAME } = require('./constants');
const { safeDivisionBasename, stripDivisionTypeTag } = require('./utils');

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 36;

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

async function buildListPdf(competitors, divisionName) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const usableW = PAGE_W - 2 * MARGIN;
  const title = stripDivisionTypeTag(divisionName);
  page.drawText(fitText(bold, title, usableW, 14), {
    x: PAGE_W / 2 - bold.widthOfTextAtSize(fitText(bold, title, usableW, 14), 14) / 2,
    y: PAGE_H - MARGIN,
    size: 14,
    font: bold
  });

  const headers = ['Athlete', 'Team', 'Technique 1', 'Technique 2', 'Technique 3', 'Technique 4', 'Technique 5'];
  const colWidths = [220, 90];
  const techniqueW = (usableW - colWidths[0] - colWidths[1]) / 5;
  colWidths.push(techniqueW, techniqueW, techniqueW, techniqueW, techniqueW);

  const headerH = 26;
  const rowH = 24;
  let y = PAGE_H - MARGIN - 36;

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
      currentPage.drawText(fitText(bold, title, usableW, 14), {
        x: PAGE_W / 2 - bold.widthOfTextAtSize(fitText(bold, title, usableW, 14), 14) / 2,
        y: PAGE_H - MARGIN,
        size: 14,
        font: bold
      });
      y = drawHeader(currentPage, PAGE_H - MARGIN - 36);
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
        currentPage.drawText(fitText(font, cell, colWidths[i] - 8, 9), {
          x: x + 4,
          y: y - 16,
          size: 9,
          font
        });
      }
      x += colWidths[i];
    });
    y -= rowH;
  });

  return pdfDoc.save();
}

async function buildRoundRobinPdf(jsonData, divisionName) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const matches = (jsonData.matches || []).filter((m) => m && typeof m === 'object');
  const title = stripDivisionTypeTag(divisionName || jsonData.division_name || '');
  page.drawText(fitText(bold, title, PAGE_W - 2 * MARGIN, 14), {
    x: PAGE_W / 2 - bold.widthOfTextAtSize(fitText(bold, title, PAGE_W - 2 * MARGIN, 14), 14) / 2,
    y: PAGE_H - MARGIN,
    size: 14,
    font: bold
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
  const gridTop = PAGE_H - MARGIN - 40 - contentH;

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
      page.drawText(fitText(font, comp.name, boxW - 12, 10), {
        x: x1 + 6,
        y: top - 14,
        size: 10,
        font,
        color: rgb(0.1, 0.1, 0.1)
      });
      if (comp.team) {
        page.drawText(fitText(font, comp.team, boxW - 12, 8), {
          x: x1 + 6,
          y: top - 26,
          size: 8,
          font,
          color: rgb(0.25, 0.25, 0.25)
        });
      }
    };
    drawLane(aka, y2 - headerH);
    drawLane(ao, y2 - headerH - laneH);
  });

  return pdfDoc.save();
}

async function buildSingleElimPdf(jsonData, divisionName) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const title = stripDivisionTypeTag(divisionName || jsonData.division_name || '');
  page.drawText(fitText(bold, title, PAGE_W - 2 * MARGIN, 14), {
    x: PAGE_W / 2 - bold.widthOfTextAtSize(fitText(bold, title, PAGE_W - 2 * MARGIN, 14), 14) / 2,
    y: PAGE_H - MARGIN,
    size: 14,
    font: bold
  });

  const rounds = (jsonData.rounds || []).filter((r) => r && typeof r === 'object');
  const matches = (jsonData.matches || []).filter((m) => m && typeof m === 'object');
  const byRound = {};
  matches.forEach((m) => {
    const rid = String(m.round_id || '');
    if (!byRound[rid]) byRound[rid] = [];
    byRound[rid].push(m);
  });

  const roundCount = Math.max(1, rounds.length);
  const boxW = Math.min(180, (PAGE_W - 2 * MARGIN) / (roundCount + 0.5) - 20);
  const boxH = 70;
  const usableH = PAGE_H - MARGIN - 70;
  const colGap = (PAGE_W - 2 * MARGIN - roundCount * boxW) / Math.max(1, roundCount + 1);

  rounds.forEach((round, ri) => {
    const roundMatches = byRound[round.round_id] || [];
    const x = MARGIN + colGap + ri * (boxW + colGap);
    const label = String(round.name || `Round ${ri + 1}`);
    page.drawText(fitText(bold, label, boxW, 11), {
      x: x + (boxW - bold.widthOfTextAtSize(fitText(bold, label, boxW, 11), 11)) / 2,
      y: PAGE_H - MARGIN - 28,
      size: 11,
      font: bold
    });

    const n = Math.max(1, roundMatches.length);
    const gap = Math.max(8, (usableH - n * boxH) / Math.max(1, n + 1));
    roundMatches.forEach((match, mi) => {
      const y2 = PAGE_H - MARGIN - 48 - gap - mi * (boxH + gap);
      const y1 = y2 - boxH;
      const headerH = 16;
      page.drawRectangle({
        x,
        y: y1,
        width: boxW,
        height: boxH,
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 1
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
      const mid = String(match.match_id || `M${mi + 1}`);
      page.drawText(mid, { x: x + 6, y: y2 - 12, size: 9, font: bold });

      const aka = competitorFromSide(match.aka);
      const ao = competitorFromSide(match.ao);
      const laneH = (boxH - headerH) / 2;
      const drawLane = (comp, top) => {
        const name = String(comp.name || '').trim();
        if (!name) return;
        page.drawText(fitText(font, name, boxW - 12, 9), {
          x: x + 6,
          y: top - 13,
          size: 9,
          font
        });
        if (comp.team) {
          page.drawText(fitText(font, comp.team, boxW - 12, 8), {
            x: x + 6,
            y: top - 24,
            size: 8,
            font,
            color: rgb(0.3, 0.3, 0.3)
          });
        }
      };
      drawLane(aka, y2 - headerH);
      drawLane(ao, y2 - headerH - laneH);
    });
  });

  return pdfDoc.save();
}

async function buildPremierLeaguePdf(jsonData, divisionName) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const title = stripDivisionTypeTag(divisionName || jsonData.division_name || '');
  page.drawText(fitText(bold, title, PAGE_W - 2 * MARGIN, 14), {
    x: PAGE_W / 2 - bold.widthOfTextAtSize(fitText(bold, title, PAGE_W - 2 * MARGIN, 14), 14) / 2,
    y: PAGE_H - MARGIN,
    size: 14,
    font: bold
  });

  const pools = (jsonData.pools || []).filter((p) => p && typeof p === 'object');
  const elimMatches = (
    (jsonData.elimination && jsonData.elimination.matches) ||
    jsonData.elimination_matches ||
    []
  ).filter((m) => m && typeof m === 'object');
  const athletesById = {};
  (jsonData.athletes || []).forEach((a) => {
    if (a?.id) athletesById[a.id] = a;
  });

  const contentTop = PAGE_H - MARGIN - 40;
  const poolAreaW = 470;
  const elimAreaLeft = MARGIN + poolAreaW + 30;

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
  const poolBoxW = (poolAreaW - Math.max(0, poolCols - 1) * poolGapX) / poolCols;
  const poolAreaH = contentTop - MARGIN - 20;
  const poolBoxH = (poolAreaH - Math.max(0, poolRows - 1) * poolGapY) / poolRows;
  const headerH = Math.max(18, poolBoxH * 0.16);
  const athleteRowH = Math.max(16, (poolBoxH - headerH) / 5);

  pools.forEach((pool, pi) => {
    const gridCol = Math.floor(pi / poolRows);
    const gridRow = pi % poolRows;
    const x1 = MARGIN + gridCol * (poolBoxW + poolGapX);
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
    page.drawText(fitText(bold, poolId, poolBoxW - 10, 10), {
      x: x1 + 6,
      y: y2 - headerH + 5,
      size: 10,
      font: bold
    });

    (pool.competitor_ids || []).forEach((cid, ai) => {
      if (ai >= 5) return;
      const a = athletesById[cid];
      if (!a) return;
      const rowTop = y2 - headerH - ai * athleteRowH;
      const rowBottom = rowTop - athleteRowH;
      page.drawLine({
        start: { x: x1, y: rowBottom },
        end: { x: x1 + poolBoxW, y: rowBottom },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7)
      });
      page.drawText(fitText(font, String(a.name || ''), poolBoxW - 12, 9), {
        x: x1 + 6,
        y: rowTop - 12,
        size: 9,
        font
      });
      const team = String(a.country_dirty || a.country || '');
      if (team) {
        page.drawText(fitText(font, team, poolBoxW - 12, 8), {
          x: x1 + 6,
          y: rowTop - 23,
          size: 8,
          font,
          color: rgb(0.3, 0.3, 0.3)
        });
      }
    });
  });

  const elimBoxW = Math.min(180, PAGE_W - elimAreaLeft - MARGIN);
  const elimBoxH = 64;
  const elimGap = Math.max(10, (poolAreaH - elimMatches.length * elimBoxH) / Math.max(1, elimMatches.length + 1));
  elimMatches.forEach((match, mi) => {
    const y2 = contentTop - 18 - elimGap - mi * (elimBoxH + elimGap);
    const y1 = y2 - elimBoxH;
    const eh = 16;
    page.drawRectangle({
      x: elimAreaLeft,
      y: y1,
      width: elimBoxW,
      height: elimBoxH,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1
    });
    page.drawLine({
      start: { x: elimAreaLeft, y: y2 - eh },
      end: { x: elimAreaLeft + elimBoxW, y: y2 - eh },
      thickness: 1,
      color: rgb(0.2, 0.2, 0.2)
    });
    page.drawLine({
      start: { x: elimAreaLeft, y: y1 + (elimBoxH - eh) / 2 },
      end: { x: elimAreaLeft + elimBoxW, y: y1 + (elimBoxH - eh) / 2 },
      thickness: 0.6,
      color: rgb(0.55, 0.55, 0.55)
    });
    const header = `${String(match.match_id || `E${mi + 1}`)} ${String(match.stage || '').trim()}`.trim();
    page.drawText(fitText(bold, header, elimBoxW - 10, 9), {
      x: elimAreaLeft + 5,
      y: y2 - 12,
      size: 9,
      font: bold
    });
    const aka = premierSlotLabel(match.aka, athletesById);
    const ao = premierSlotLabel(match.ao, athletesById);
    page.drawText(fitText(font, aka.name, elimBoxW - 10, 9), {
      x: elimAreaLeft + 5,
      y: y2 - eh - 14,
      size: 9,
      font
    });
    page.drawText(fitText(font, ao.name, elimBoxW - 10, 9), {
      x: elimAreaLeft + 5,
      y: y1 + 10,
      size: 9,
      font
    });
  });

  return pdfDoc.save();
}

async function buildTextPdfFromBody(divisionName, bodyText) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const title = stripDivisionTypeTag(divisionName);
  let y = PAGE_H - MARGIN;
  page.drawText(fitText(bold, title, PAGE_W - 2 * MARGIN, 14), {
    x: MARGIN,
    y,
    size: 14,
    font: bold
  });
  y -= 24;
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

async function buildPdfForCatalogEntry(entry) {
  const divisionName = entry.division_name || entry.id;
  const json = entry.json_data;
  const type = String(json?.division_type || entry.division_type || '').trim();

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
    if (competitors.length) return buildListPdf(competitors, divisionName);
  }

  if (type === 'Round Robin' && json?.matches) {
    return buildRoundRobinPdf(json, divisionName);
  }
  if (type === 'Single Elimination' && json?.matches) {
    return buildSingleElimPdf(json, divisionName);
  }
  if (type === 'Premier League' && json?.pools) {
    return buildPremierLeaguePdf(json, divisionName);
  }

  return buildTextPdfFromBody(divisionName, entry.body_text || '');
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

async function buildDrawFilesFromState(drawsState) {
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
      const pdfBytes = await buildPdfForCatalogEntry(entry);
      pdfFiles[pdfName] = Buffer.from(pdfBytes);
      pdfBuffers.push(pdfBytes);
    } catch (err) {
      pdfFiles[pdfName] = Buffer.from(
        await buildTextPdfFromBody(
          entry.division_name,
          `PDF error: ${err.message}\n\n${entry.body_text || ''}`
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

module.exports = {
  buildListPdf,
  buildRoundRobinPdf,
  buildSingleElimPdf,
  buildPremierLeaguePdf,
  buildTextPdfFromBody,
  buildPdfForCatalogEntry,
  mergePdfBuffers,
  buildDrawFilesFromState
};
