const { DEFAULT_DRAW_RING_NUMBER } = require('./constants');
const {
  stripDivisionTypeTag,
  formatCompetitorLine,
  normalizeDrawType
} = require('./utils');
const { applyCombineToTarget } = require('./merge-division');
const {
  placeAthletesDelayedConfrontation,
  singleElimBracketSize,
  poolCountForPremier,
  assignCompetitorsToPools
} = require('./draw-placement');

function rrCompetitorSide(competitor) {
  return {
    name: competitor.name,
    country: competitor.team,
    country_dirty: competitor.pdf_team || competitor.team || ''
  };
}

function buildRoundRobinJson(competitors, divisionName, tatamiNumber = DEFAULT_DRAW_RING_NUMBER) {
  const n = competitors.length;
  if (n === 1) {
    return {
      division_type: 'Round Robin',
      division_name: divisionName,
      tatami_number: tatamiNumber,
      matches: [{
        draw_label: 'Match 1',
        aka: rrCompetitorSide(competitors[0]),
        ao: { name: 'BYE', country: '', country_dirty: '' },
        winner: null, score: null, senchu: null, warnings: []
      }]
    };
  }

  const participants = [...Array(n).keys()];
  let byeIdx = null;
  if (n % 2 !== 0) {
    byeIdx = n;
    participants.push(byeIdx);
  }
  const N = participants.length;
  const fixed = participants[0];
  let circle = participants.slice(1);
  const matches = [];
  let matchId = 1;

  for (let round = 0; round < N - 1; round++) {
    const roundPairs = [[fixed, circle[0]]];
    const half = (N - 2) / 2;
    for (let k = 1; k <= half; k++) {
      roundPairs.push([circle[k], circle[N - 2 - k + 1]]);
    }
    roundPairs.forEach(([aIdx, bIdx]) => {
      if (aIdx === byeIdx || bIdx === byeIdx) return;
      const a = competitors[aIdx];
      const b = competitors[bIdx];
      matches.push({
        draw_label: `Match ${matchId}`,
        aka: rrCompetitorSide(a),
        ao: rrCompetitorSide(b),
        winner: null, score: null, senchu: null, warnings: []
      });
      matchId += 1;
    });
    circle = [circle[circle.length - 1], ...circle.slice(0, -1)];
  }

  return {
    division_type: 'Round Robin',
    division_name: divisionName,
    tatami_number: tatamiNumber,
    matches
  };
}

function formatMatchSideLine(side) {
  if (!side || typeof side !== 'object') return 'BYE';
  const name = String(side.name || '').trim();
  if (!name || name.toUpperCase() === 'BYE') return 'BYE';
  return formatCompetitorLine({
    name,
    team: String(side.country || '').trim(),
    pdf_team: String(side.country_dirty || '').trim()
  });
}

function buildRoundRobinText(jsonData, athleteCount, displayName) {
  const label = stripDivisionTypeTag(displayName || jsonData.division_name || '');
  const ringNumber = String(jsonData.tatami_number || DEFAULT_DRAW_RING_NUMBER).trim() || DEFAULT_DRAW_RING_NUMBER;
  let count = athleteCount;
  if (count == null) {
    const names = new Set();
    (jsonData.matches || []).forEach((match) => {
      ['aka', 'ao'].forEach((key) => {
        const side = match[key];
        const name = String(side?.name || '').trim();
        if (name && name.toUpperCase() !== 'BYE') names.add(name.toLowerCase());
      });
    });
    count = names.size;
  }
  const header = [
    `Divison Name: ${label}`,
    'Division Type: Round Robin'
  ];
  const eventKey = String(jsonData.event_key || '').trim();
  if (eventKey) header.push(`Event Type: ${eventKey}`);
  header.push(
    `Ring Number: ${ringNumber}`,
    `Division Size: ${count}`,
    ''
  );
  const body = [];
  (jsonData.matches || []).forEach((match, mi) => {
    body.push(formatMatchSideLine(match.aka));
    body.push(formatMatchSideLine(match.ao));
    if (mi + 1 < (jsonData.matches || []).length) body.push('', '');
  });
  return [...header, ...body].join('\n');
}

function buildSingleEliminationJson(competitors, divisionName, tatamiNumber = DEFAULT_DRAW_RING_NUMBER, placement = null) {
  const n = competitors.length;
  if (n < 1) throw new Error('Need at least 1 competitor');
  if (n === 1) {
    const competitor = competitors[0];
    return {
      division_type: 'Single Elimination',
      division_name: divisionName,
      tatami_number: tatamiNumber,
      rounds: [{ round_id: 'R1', name: 'Final', order: 1 }],
      matches: [{
        match_id: 'M1',
        round_id: 'R1',
        aka: { competitor: { name: competitor.name, country: competitor.team, country_dirty: competitor.pdf_team || '' } },
        ao: { bye: true },
        winner: null, score: null, senchu: null, warnings: []
      }],
      layout: { orientation: 'left-to-right', match_positions: [{ match_id: 'M1', x: 0.5, y: 0.5 }] }
    };
  }

  let slots = 1;
  while (slots < n) slots *= 2;
  const numRounds = Math.log2(slots);
  const roundNames = [];
  for (let r = 1; r <= numRounds; r++) {
    const entrants = 2 ** (numRounds - r + 1);
    if (entrants === 2) roundNames.push('Final');
    else if (entrants === 4) roundNames.push('Semifinals');
    else if (entrants === 8) roundNames.push('Quarterfinals');
    else roundNames.push(`Round of ${entrants}`);
  }
  const rounds = roundNames.map((name, i) => ({ round_id: `R${i + 1}`, name, order: i + 1 }));

  let rawPlacement = placement;
  if (!rawPlacement) {
    rawPlacement = placeAthletesDelayedConfrontation(competitors, slots);
  }
  while (rawPlacement.length < slots) rawPlacement.push(null);
  rawPlacement = rawPlacement.slice(0, slots);

  const slotParticipants = rawPlacement.map((entry) => {
    if (!entry) return null;
    return { competitor: { name: entry.name, country: entry.team, country_dirty: entry.pdf_team || '' } };
  });

  const matchesPerRound = Array.from({ length: numRounds }, (_, r) => slots / (2 ** (r + 1)));
  const firstRoundPairs = [];
  for (let m = 0; m < matchesPerRound[0]; m++) {
    const s0 = slotParticipants[m * 2];
    const s1 = slotParticipants[m * 2 + 1];
    firstRoundPairs.push({
      aka: s0 && s0.competitor ? { competitor: s0.competitor } : { bye: true },
      ao: s1 && s1.competitor ? { competitor: s1.competitor } : { bye: true }
    });
  }

  const matches = [];
  const matchPositions = [];
  const xStep = 1 / (numRounds + 1);
  let matchId = 1;
  let prevRoundIds = [];
  for (let r = 0; r < numRounds; r++) {
    const roundId = `R${r + 1}`;
    let pairsForRound = [];
    if (r === 0) {
      pairsForRound = firstRoundPairs.map((pair) => ({ ...pair }));
      pairsForRound.sort((a, b) => {
        const aBye = Boolean(a.aka?.bye || a.ao?.bye);
        const bBye = Boolean(b.aka?.bye || b.ao?.bye);
        return Number(aBye ? 0 : 1) - Number(bBye ? 0 : 1);
      });
    }
    const numMatchesR = matchesPerRound[r];
    const yStep = numMatchesR ? 1 / (numMatchesR + 1) : 1;
    const currentRoundIds = [];
    for (let m = 0; m < numMatchesR; m++) {
      const mid = `M${matchId}`;
      let aka; let ao;
      if (r === 0) {
        aka = pairsForRound[m].aka;
        ao = pairsForRound[m].ao;
      } else {
        aka = { source_match_id: prevRoundIds[m * 2], source: 'winner' };
        ao = { source_match_id: prevRoundIds[m * 2 + 1], source: 'winner' };
      }
      matches.push({
        match_id: mid, round_id: roundId, aka, ao,
        winner: null, score: null, senchu: null, warnings: []
      });
      matchPositions.push({ match_id: mid, x: Math.round(xStep * (r + 1) * 100) / 100, y: Math.round(yStep * (m + 1) * 100) / 100 });
      currentRoundIds.push(mid);
      matchId += 1;
    }
    prevRoundIds = currentRoundIds;
  }

  return {
    division_type: 'Single Elimination',
    division_name: divisionName,
    tatami_number: tatamiNumber,
    rounds,
    matches,
    layout: { orientation: 'left-to-right', match_positions: matchPositions }
  };
}

function formatElimSide(side) {
  if (!side || typeof side !== 'object') return 'BYE';
  if (side.bye) return 'BYE';
  if (side.competitor) {
    return formatCompetitorLine({
      name: side.competitor.name,
      team: side.competitor.country,
      pdf_team: side.competitor.country_dirty
    });
  }
  return 'TBD';
}

function buildSingleElimText(jsonData, displayName) {
  const label = stripDivisionTypeTag(displayName || jsonData.division_name || '');
  const ringNumber = String(jsonData.tatami_number || DEFAULT_DRAW_RING_NUMBER).trim() || DEFAULT_DRAW_RING_NUMBER;
  const round1 = (jsonData.matches || []).filter((m) => m.round_id === 'R1');
  const bracketSize = Math.max(2, round1.length * 2);
  const header = [
    `Divison Name: ${label}`,
    'Division Type: Single Elimination'
  ];
  const eventKey = String(jsonData.event_key || '').trim();
  if (eventKey) header.push(`Event Type: ${eventKey}`);
  header.push(
    `Ring Number: ${ringNumber}`,
    `Division Size: ${bracketSize}`,
    ''
  );

  const pairBlocks = round1.map((match) => {
    const aka = formatElimSide(match.aka);
    const ao = formatElimSide(match.ao);
    const hasBye = aka === 'BYE' || ao === 'BYE';
    return { hasBye, lines: [aka, ao] };
  });
  pairBlocks.sort((a, b) => Number(a.hasBye ? 0 : 1) - Number(b.hasBye ? 0 : 1));

  const body = [];
  pairBlocks.forEach((block, mi) => {
    body.push(...block.lines);
    if (mi + 1 < pairBlocks.length) body.push('', '');
  });
  return [...header, ...body].join('\n');
}

function buildListText(competitors, displayName, ringNumber = DEFAULT_DRAW_RING_NUMBER, eventKey = '') {
  const label = stripDivisionTypeTag(displayName || '');
  const header = [
    `Divison Name: ${label}`,
    'Division Type: List'
  ];
  if (eventKey) header.push(`Event Type: ${eventKey}`);
  header.push(`Ring Number: ${ringNumber}`, `Division Size: ${competitors.length}`, '');
  return [...header, ...competitors.map(formatCompetitorLine)].join('\n');
}

function buildListJson(competitors, divisionName, displayName) {
  const label = stripDivisionTypeTag(displayName || divisionName);
  return {
    division_type: 'List',
    division_name: label,
    rows: competitors.map((c) => ({
      name: String(c.name || '').trim(),
      team: String(c.pdf_team || c.team || '').trim()
    }))
  };
}

function poolRoundRobinMatches(ids, poolName) {
  const pN = ids.length;
  let participants = [...Array(pN).keys()];
  let pBye = null;
  if (pN % 2 !== 0) {
    pBye = pN;
    participants.push(pBye);
  }
  const pN2 = participants.length;
  const pFixed = participants[0];
  let pCircle = participants.slice(1);
  const poolMatches = [];
  let matchId = 1;
  for (let pr = 0; pr < pN2 - 1; pr++) {
    const pairs = [[pFixed, pCircle[0]]];
    for (let k = 1; k <= (pN2 - 2) / 2; k++) {
      pairs.push([pCircle[k], pCircle[pN2 - 2 - k + 1]]);
    }
    pairs.forEach(([aIdx, bIdx]) => {
      if (aIdx === pBye || bIdx === pBye) return;
      poolMatches.push({
        match_id: `${poolName}-M${matchId}`,
        aka: { competitor_id: ids[aIdx] },
        ao: { competitor_id: ids[bIdx] },
        winner: null, score: null, senchu: null, warnings: []
      });
      matchId += 1;
    });
    pCircle = [pCircle[pCircle.length - 1], ...pCircle.slice(0, -1)];
  }
  return poolMatches;
}

function formatPremierSlotLine(entry, athletesById) {
  if (!entry || typeof entry !== 'object') return '';
  const competitorId = String(entry.competitor_id || '').trim();
  if (competitorId) {
    const athlete = athletesById[competitorId];
    if (athlete) {
      return formatCompetitorLine({
        name: athlete.name,
        team: athlete.country,
        pdf_team: athlete.country_dirty
      });
    }
    return competitorId;
  }
  const poolId = String(entry.pool_id || '').trim();
  if (poolId) {
    const rank = entry.pool_rank != null ? entry.pool_rank : 1;
    return `${poolId} #${rank}`;
  }
  const matchId = String(entry.match_id || entry.source_match_id || '').trim();
  if (matchId) {
    const result = String(entry.result || entry.source || 'winner').trim().toLowerCase() || 'winner';
    if (result === 'winner') return `Winner of ${matchId}`;
    return `${result.charAt(0).toUpperCase()}${result.slice(1)} of ${matchId}`;
  }
  return '';
}

function premierEliminationSortKey(match) {
  const stage = String(match?.stage || '').trim();
  const lower = stage.toLowerCase();
  let level = 4;
  if (lower.includes('quarter')) level = 1;
  else if (lower.includes('semi')) level = 2;
  else if (lower.includes('final')) level = 3;
  return [level, stage, String(match?.match_id || '')];
}

function buildPremierLeagueJson(groups, divisionName, tatamiNumber = DEFAULT_DRAW_RING_NUMBER) {
  const poolNames = groups.map((_, i) => `Pool ${String.fromCharCode(65 + i)}`);
  const poolCount = groups.length;
  if (![2, 4, 8].includes(poolCount)) {
    throw new Error('Premier League requires 2, 4, or 8 pools.');
  }
  const athletes = [];
  let athleteId = 1;
  const poolIdMap = {};
  poolNames.forEach((poolName, pi) => {
    const members = groups[pi];
    if (members.length < 2 || members.length > 5) {
      throw new Error(`${poolName} must have 2 to 5 athletes.`);
    }
    const ids = [];
    members.forEach((m) => {
      const cid = `ATH${athleteId}`;
      athleteId += 1;
      athletes.push({
        id: cid,
        name: m.name,
        country: m.team,
        country_dirty: m.pdf_team || ''
      });
      ids.push(cid);
    });
    poolIdMap[poolName] = ids;
  });

  const pools = poolNames.map((poolName) => {
    const ids = poolIdMap[poolName];
    return {
      pool_id: poolName,
      competitor_ids: ids,
      round_robin_matches: poolRoundRobinMatches(ids, poolName),
      ranking: ids.map((cid, idx) => ({ competitor_id: cid, rank: idx + 1 }))
    };
  });

  const eliminationMatches = [];
  const connectors = [];
  const addConnector = (poolName, toMatchId, yPos) => {
    connectors.push({
      from_pool: poolName,
      from_rank: 1,
      to_match_id: toMatchId,
      x1: 0.1,
      y1: yPos,
      x2: 0.6,
      y2: yPos
    });
  };

  if (poolCount === 2) {
    eliminationMatches.push({
      match_id: 'E1',
      stage: 'Final',
      aka: { pool_id: poolNames[0], pool_rank: 1 },
      ao: { pool_id: poolNames[1], pool_rank: 1 },
      winner: null
    });
    addConnector(poolNames[0], 'E1', 0.4);
    addConnector(poolNames[1], 'E1', 0.6);
  } else if (poolCount === 4) {
    eliminationMatches.push(
      {
        match_id: 'E1',
        stage: 'Semifinal 1',
        aka: { pool_id: poolNames[0], pool_rank: 1 },
        ao: { pool_id: poolNames[1], pool_rank: 1 },
        winner: null
      },
      {
        match_id: 'E2',
        stage: 'Semifinal 2',
        aka: { pool_id: poolNames[2], pool_rank: 1 },
        ao: { pool_id: poolNames[3], pool_rank: 1 },
        winner: null
      },
      {
        match_id: 'E3',
        stage: 'Final',
        aka: { match_id: 'E1', result: 'winner' },
        ao: { match_id: 'E2', result: 'winner' },
        winner: null
      }
    );
    addConnector(poolNames[0], 'E1', 0.2);
    addConnector(poolNames[1], 'E1', 0.35);
    addConnector(poolNames[2], 'E2', 0.65);
    addConnector(poolNames[3], 'E2', 0.8);
  } else {
    for (let i = 0; i < 4; i++) {
      eliminationMatches.push({
        match_id: `E${i + 1}`,
        stage: `Quarterfinal ${i + 1}`,
        aka: { pool_id: poolNames[i * 2], pool_rank: 1 },
        ao: { pool_id: poolNames[i * 2 + 1], pool_rank: 1 },
        winner: null
      });
    }
    eliminationMatches.push(
      {
        match_id: 'E5',
        stage: 'Semifinal 1',
        aka: { match_id: 'E1', result: 'winner' },
        ao: { match_id: 'E2', result: 'winner' },
        winner: null
      },
      {
        match_id: 'E6',
        stage: 'Semifinal 2',
        aka: { match_id: 'E3', result: 'winner' },
        ao: { match_id: 'E4', result: 'winner' },
        winner: null
      },
      {
        match_id: 'E7',
        stage: 'Final',
        aka: { match_id: 'E5', result: 'winner' },
        ao: { match_id: 'E6', result: 'winner' },
        winner: null
      }
    );
    poolNames.forEach((poolName, idx) => {
      addConnector(poolName, `E${Math.floor(idx / 2) + 1}`, 0.1 + idx * 0.1);
    });
  }

  return {
    division_type: 'Premier League',
    division_name: divisionName,
    tatami_number: tatamiNumber,
    athletes,
    pools,
    elimination: { matches: eliminationMatches },
    layout: {
      round_robin_area: { x: 0.05, y: 0.1, width: 0.5, height: 0.8 },
      elimination_area: { x: 0.6, y: 0.1, width: 0.35, height: 0.8 },
      connectors,
      elimination_visibility: 'show-placeholders'
    }
  };
}

function buildPremierLeagueText(jsonData, displayName) {
  const label = stripDivisionTypeTag(displayName || jsonData.division_name || '');
  const ringNumber = String(jsonData.tatami_number || DEFAULT_DRAW_RING_NUMBER).trim() || DEFAULT_DRAW_RING_NUMBER;
  const athletesById = {};
  (jsonData.athletes || []).forEach((a) => {
    if (a?.id) athletesById[a.id] = a;
  });
  const pools = (jsonData.pools || []).filter((p) => p && typeof p === 'object');
  const athleteCount = (jsonData.athletes || []).length;
  const header = [
    `Divison Name: ${label}`,
    'Division Type: Premier League'
  ];
  const eventKey = String(jsonData.event_key || '').trim();
  if (eventKey) header.push(`Event Type: ${eventKey}`);
  header.push(
    `Ring Number: ${ringNumber}`,
    `Division Size: ${athleteCount}`,
    `Pool Count: ${pools.length}`,
    ''
  );

  const body = [];
  pools.forEach((pool) => {
    const poolId = String(pool.pool_id || 'Pool').trim() || 'Pool';
    if (body.length) body.push('');
    body.push(poolId);
    const poolMatches = (pool.round_robin_matches || []).filter((m) => m && typeof m === 'object');
    poolMatches.forEach((match, mi) => {
      body.push(formatPremierSlotLine(match.aka, athletesById) || '—');
      body.push(formatPremierSlotLine(match.ao, athletesById) || '—');
      if (mi + 1 < poolMatches.length) body.push('', '');
    });
  });

  let elimMatches = (
    (jsonData.elimination && jsonData.elimination.matches) ||
    jsonData.elimination_matches ||
    []
  ).filter((m) => m && typeof m === 'object');
  if (elimMatches.length) {
    body.push('', 'Elimination');
    elimMatches = [...elimMatches].sort((a, b) => {
      const ka = premierEliminationSortKey(a);
      const kb = premierEliminationSortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
    elimMatches.forEach((match) => {
      const stage = String(match.stage || '').trim();
      if (stage) body.push(stage);
      body.push(formatPremierSlotLine(match.aka, athletesById) || '—');
      body.push(formatPremierSlotLine(match.ao, athletesById) || '—');
      body.push('', '');
    });
  }

  while (body.length && body[body.length - 1] === '') body.pop();
  return [...header, ...body].join('\n');
}

function tryBuildDraw(drawType, competitors, divisionName, options = {}) {
  const label = stripDivisionTypeTag(options.displayName || divisionName);
  const ring = options.ringNumber || DEFAULT_DRAW_RING_NUMBER;
  const type = normalizeDrawType(drawType);

  if (!competitors.length) {
    return { body_text: '', json_data: null, draw_type: type };
  }

  if (type === 'List') {
    const body_text = buildListText(competitors, label, ring, options.eventKey || '');
    const json_data = buildListJson(competitors, divisionName, label);
    return { body_text, json_data, draw_type: 'List' };
  }
  if (type === 'Round Robin') {
    const json_data = buildRoundRobinJson(competitors, label, ring);
    const body_text = buildRoundRobinText(json_data, competitors.length, label);
    return { body_text, json_data, draw_type: 'Round Robin' };
  }
  if (type === 'Single Elimination') {
    const json_data = buildSingleEliminationJson(competitors, label, ring);
    const body_text = buildSingleElimText(json_data, label);
    return { body_text, json_data, draw_type: 'Single Elimination' };
  }
  if (type === 'Premier League') {
    const poolCount = poolCountForPremier(competitors.length);
    const groups = assignCompetitorsToPools(competitors, poolCount);
    const json_data = buildPremierLeagueJson(groups, label, ring);
    const body_text = buildPremierLeagueText(json_data, label);
    return { body_text, json_data, draw_type: 'Premier League' };
  }
  throw new Error(`Unknown draw type: ${drawType}`);
}

function buildDrawForEntry(entry, competitors, options = {}) {
  const divisionName = entry.division_name || entry.id;
  let drawType = entry.division_type || 'List';
  const attempts = [drawType, 'Round Robin', 'List'].filter((v, i, a) => a.indexOf(v) === i);

  for (const attempt of attempts) {
    try {
      return tryBuildDraw(attempt, competitors, divisionName, {
        ...options,
        displayName: divisionName,
        eventKey: entry.event_key
      });
    } catch (err) {
      if (attempt === 'List') {
        const body_text = buildListText(competitors, divisionName);
        const json_data = buildListJson(competitors, divisionName, divisionName);
        return { body_text, json_data, draw_type: 'List', error: String(err.message) };
      }
    }
  }
  const body_text = buildListText(competitors, divisionName);
  const json_data = buildListJson(competitors, divisionName, divisionName);
  return { body_text, json_data, draw_type: 'List' };
}

function createDrawsFromGroupings(groupingsState, options = {}) {
  const { DRAWS_FORMAT_VERSION } = require('./constants');
  const catalog = [];

  (groupingsState.catalog || []).forEach((entry) => {
    const competitors = (entry.athletes || []).map((a) => ({
      name: a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      team: a.club || a.team || '',
      pdf_team: a.club || a.team || ''
    }));

    if (!competitors.length) return;

    const built = buildDrawForEntry(entry, competitors, options);
    catalog.push({
      id: entry.id,
      division_name: entry.division_name,
      division_type: built.draw_type,
      event_key: entry.event_key || '',
      athlete_count: competitors.length,
      athlete_indices: entry.athlete_indices || [],
      body_text: built.body_text,
      json_data: built.json_data,
      draw_dirty: false
    });
  });

  return {
    format_version: DRAWS_FORMAT_VERSION,
    catalog
  };
}

function rebuildDrawCatalogEntry(entry, athletes) {
  const { extractCompetitors, athleteSnapshot, athletesByIndices } = require('./athletes');
  const matched = athletesByIndices(athletes, entry.athlete_indices || []);
  entry.athlete_count = matched.length;
  entry.athletes = matched.map((a) => athleteSnapshot(a));
  const competitors = extractCompetitors(matched);
  if (!competitors.length) {
    entry.body_text = '';
    entry.json_data = null;
    return entry;
  }
  const built = buildDrawForEntry(entry, competitors);
  entry.division_type = built.draw_type;
  entry.body_text = built.body_text;
  entry.json_data = built.json_data;
  return entry;
}

function hydrateDrawCatalogAthletes(drawsState, athletes) {
  const { athleteSnapshot, athletesByIndices } = require('./athletes');
  (drawsState?.catalog || []).forEach((entry) => {
    if (Array.isArray(entry.athletes) && entry.athletes.length) return;
    const matched = athletesByIndices(athletes, entry.athlete_indices || []);
    entry.athletes = matched.map((a) => athleteSnapshot(a));
  });
  return drawsState;
}

function attachAthletesFromGroupings(drawsState, groupingsState) {
  const byId = new Map((groupingsState?.catalog || []).map((e) => [String(e.id), e]));
  (drawsState?.catalog || []).forEach((entry) => {
    const src = byId.get(String(entry.id));
    if (src?.athletes) entry.athletes = src.athletes;
  });
  return drawsState;
}

function moveAthleteBetweenDraws(drawsState, athletes, fromDivisionId, toDivisionId, athleteIndex) {
  const catalog = drawsState?.catalog || [];
  const from = catalog.find((e) => String(e.id) === String(fromDivisionId));
  const to = catalog.find((e) => String(e.id) === String(toDivisionId));
  if (!from || !to) throw new Error('Draw not found.');
  if (String(fromDivisionId) === String(toDivisionId)) {
    return drawsState;
  }
  const idx = Number(athleteIndex);
  const fromIndices = (from.athlete_indices || []).map(Number);
  if (!fromIndices.includes(idx)) {
    throw new Error('Athlete is not in the source draw.');
  }

  const sourceAthletesBefore = [...(from.athletes || [])];
  const targetAthletesBefore = [...(to.athletes || [])];

  from.athlete_indices = fromIndices.filter((i) => i !== idx);
  const toIndices = (to.athlete_indices || []).map(Number);
  if (!toIndices.includes(idx)) toIndices.push(idx);
  to.athlete_indices = toIndices;
  to.athlete_count = toIndices.length;
  from.athlete_count = from.athlete_indices.length;

  applyCombineToTarget({
    sourceEntry: from,
    targetEntry: to,
    sourceAthletes: sourceAthletesBefore,
    targetAthletes: targetAthletesBefore
  });

  rebuildDrawCatalogEntry(from, athletes);
  rebuildDrawCatalogEntry(to, athletes);
  return drawsState;
}

module.exports = {
  buildRoundRobinJson,
  buildSingleEliminationJson,
  buildListText,
  buildListJson,
  buildPremierLeagueJson,
  tryBuildDraw,
  buildDrawForEntry,
  createDrawsFromGroupings,
  rebuildDrawCatalogEntry,
  hydrateDrawCatalogAthletes,
  attachAthletesFromGroupings,
  moveAthleteBetweenDraws,
  buildRoundRobinText,
  buildSingleElimText,
  buildPremierLeagueText
};
