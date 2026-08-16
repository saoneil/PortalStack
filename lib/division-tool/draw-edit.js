const { DEFAULT_DRAW_RING_NUMBER } = require('./constants');
const { stripDivisionTypeTag, formatCompetitorLine } = require('./utils');
const {
  buildSingleEliminationJson,
  buildPremierLeagueJson,
  buildRoundRobinText,
  buildSingleElimText,
  buildPremierLeagueText,
  buildListText
} = require('./draws-types');
const { singleElimBracketSize, assignCompetitorsToPools } = require('./draw-placement');

const PREMIER_LEAGUE_MAX_POOL_ATHLETES = 5;

function matchSortKey(match) {
  const mid = String(match.match_id || 'M0');
  const digits = mid.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

function competitorFromSide(side) {
  if (!side || typeof side !== 'object') return null;
  const name = String(side.name || '').trim();
  if (!name || name.toUpperCase() === 'BYE') return null;
  return {
    name,
    team: String(side.country || '').trim(),
    pdf_team: String(side.country_dirty || '').trim()
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

function sePlacementFromJson(jsonData) {
  const matches = (jsonData.matches || [])
    .filter((m) => m && String(m.round_id || '').toUpperCase() === 'R1')
    .sort((a, b) => matchSortKey(a) - matchSortKey(b));
  const placement = [];
  matches.forEach((match) => {
    ['aka', 'ao'].forEach((sideKey) => {
      const side = match[sideKey] || {};
      if (side.bye) {
        placement.push(null);
      } else if (side.competitor) {
        const c = side.competitor;
        placement.push({
          name: String(c.name || '').trim(),
          team: String(c.country || '').trim(),
          pdf_team: String(c.country_dirty || '').trim()
        });
      } else {
        placement.push(competitorFromSide(side));
      }
    });
  });
  return placement;
}

function seSlotsFromJson(jsonData) {
  let placement = sePlacementFromJson(jsonData);
  const nReal = placement.filter(Boolean).length;
  const bracketSize = singleElimBracketSize(Math.max(1, nReal));
  while (placement.length < bracketSize) placement.push(null);
  placement = placement.slice(0, bracketSize);

  const pairBlocks = [];
  for (let pairStart = 0; pairStart < bracketSize; pairStart += 2) {
    const block = [];
    let hasBye = false;
    for (let offset = 0; offset < 2; offset++) {
      const idx = pairStart + offset;
      const entry = placement[idx] || null;
      const line = entry ? formatCompetitorLine(entry) : 'BYE';
      if (!entry) hasBye = true;
      block.push({ idx, entry, line });
    }
    pairBlocks.push({ hasBye, block });
  }
  pairBlocks.sort((a, b) => (a.hasBye === b.hasBye ? 0 : a.hasBye ? -1 : 1));

  const slots = [];
  pairBlocks.forEach((pair, pairIdx) => {
    const matchTitle = `Match ${pairIdx + 1}`;
    pair.block.forEach((item, bi) => {
      slots.push({
        slot_id: `se_${item.idx}`,
        kind: 'se_placement',
        editable: true,
        match_group: `se_pair_${pairIdx}`,
        match_title: matchTitle,
        side_label: bi === 0 ? 'Red' : 'Blue',
        display: item.line,
        empty: !item.entry,
        ref: { placement_index: item.idx }
      });
    });
  });
  return slots;
}

function seSwapPlacement(jsonData, src, tgt) {
  let placement = sePlacementFromJson(jsonData);
  const nReal = placement.filter(Boolean).length;
  const bracketSize = singleElimBracketSize(Math.max(1, nReal));
  while (placement.length < bracketSize) placement.push(null);
  const i = Number(src.ref.placement_index);
  const j = Number(tgt.ref.placement_index);
  if (i < 0 || j < 0 || i >= placement.length || j >= placement.length) {
    return 'Invalid slot index.';
  }
  const tmp = placement[i];
  placement[i] = placement[j];
  placement[j] = tmp;
  const competitors = placement.filter(Boolean);
  const divisionName = stripDivisionTypeTag(String(jsonData.division_name || ''));
  const ring = String(jsonData.tatami_number || DEFAULT_DRAW_RING_NUMBER).trim();
  const newJson = buildSingleEliminationJson(competitors, divisionName, ring, placement);
  Object.keys(jsonData).forEach((k) => delete jsonData[k]);
  Object.assign(jsonData, newJson);
  return null;
}

function rrSlotsFromJson(jsonData) {
  return (jsonData.matches || []).map((match, mi) => {
    const title = String(match.draw_label || '').trim() || `Match ${mi + 1}`;
    const akaLine = formatMatchSideLine(match.aka);
    const aoLine = formatMatchSideLine(match.ao);
    return {
      slot_id: `rr_m_${mi}`,
      kind: 'rr_match_order',
      editable: true,
      match_group: `rr_m_${mi}`,
      match_title: title,
      aka_display: akaLine,
      ao_display: aoLine,
      display: akaLine,
      ref: { match_index: mi }
    };
  });
}

function rrSwapMatchOrder(jsonData, src, tgt) {
  const matches = jsonData.matches;
  if (!Array.isArray(matches)) return 'Invalid draw data.';
  const miS = Number(src.ref.match_index);
  const miT = Number(tgt.ref.match_index);
  if (miS >= matches.length || miT >= matches.length) return 'Invalid match index.';
  const tmp = matches[miS];
  matches[miS] = matches[miT];
  matches[miT] = tmp;
  return null;
}

function premierLeagueAthletesById(jsonData) {
  const map = {};
  (jsonData.athletes || []).forEach((a) => {
    if (a && a.id) map[String(a.id)] = a;
  });
  return map;
}

function plAthleteMemberDict(athlete) {
  return {
    name: String(athlete.name || '').trim(),
    team: String(athlete.country || '').trim(),
    pdf_team: String(athlete.country_dirty || '').trim()
  };
}

function plExtractSlotGroups(jsonData) {
  const athletesById = premierLeagueAthletesById(jsonData);
  return (jsonData.pools || []).filter((p) => p && typeof p === 'object').map((pool) => {
    const slots = new Array(PREMIER_LEAGUE_MAX_POOL_ATHLETES).fill(null);
    (pool.competitor_ids || []).forEach((cid, mi) => {
      if (mi >= PREMIER_LEAGUE_MAX_POOL_ATHLETES) return;
      const athlete = athletesById[String(cid)];
      if (athlete) slots[mi] = plAthleteMemberDict(athlete);
    });
    return slots;
  });
}

function plCompactSlotGroups(slotGroups) {
  return slotGroups.map((group) => group.filter(Boolean));
}

function plSlotsFromJson(jsonData) {
  const pools = (jsonData.pools || []).filter((p) => p && typeof p === 'object');
  const slotGroups = plExtractSlotGroups(jsonData);
  const slots = [];
  pools.forEach((pool, pi) => {
    const poolId = String(pool.pool_id || 'Pool').trim() || 'Pool';
    slots.push({ section: poolId, kind: 'section' });
    const poolSlots = slotGroups[pi] || new Array(PREMIER_LEAGUE_MAX_POOL_ATHLETES).fill(null);
    for (let mi = 0; mi < PREMIER_LEAGUE_MAX_POOL_ATHLETES; mi++) {
      const member = poolSlots[mi] || null;
      if (member) {
        slots.push({
          slot_id: `pl_roster_${pi}_${mi}`,
          kind: 'pl_roster',
          editable: true,
          empty: false,
          display: formatCompetitorLine(member),
          stacked_name: member.name,
          stacked_club: member.team,
          ref: { pool_index: pi, member_index: mi }
        });
      } else {
        slots.push({
          slot_id: `pl_roster_${pi}_${mi}`,
          kind: 'pl_roster',
          editable: true,
          empty: true,
          display: '(empty slot)',
          stacked_name: '(empty slot)',
          stacked_club: '',
          ref: { pool_index: pi, member_index: mi }
        });
      }
    }
  });
  return slots;
}

function plApplyGroups(entry, groups) {
  const jsonData = entry.json_data;
  if (!jsonData || typeof jsonData !== 'object') return 'No draw data.';
  const poolCount = groups.length;
  if (![2, 4, 8].includes(poolCount)) return 'Premier League requires 2, 4, or 8 pools.';
  for (let idx = 0; idx < groups.length; idx++) {
    const members = groups[idx];
    if (members.length < 2 || members.length > 5) {
      return `Pool ${String.fromCharCode(65 + idx)} must have 2 to 5 athletes (has ${members.length}).`;
    }
  }
  try {
    const divisionName = stripDivisionTypeTag(String(jsonData.division_name || ''));
    const ring = String(jsonData.tatami_number || DEFAULT_DRAW_RING_NUMBER).trim();
    const newJson = buildPremierLeagueJson(groups, divisionName, ring);
    Object.keys(jsonData).forEach((k) => delete jsonData[k]);
    Object.assign(jsonData, newJson);
    return null;
  } catch (err) {
    return err.message || String(err);
  }
}

function plSwapRoster(entry, src, tgt) {
  const jsonData = entry.json_data;
  if (!jsonData || typeof jsonData !== 'object') return 'No draw data.';
  const slotGroups = plExtractSlotGroups(jsonData);
  const piS = Number(src.ref.pool_index);
  const piT = Number(tgt.ref.pool_index);
  const miS = Number(src.ref.member_index);
  const miT = Number(tgt.ref.member_index);
  if (piS >= slotGroups.length || piT >= slotGroups.length) return 'Invalid pool.';
  if (miS < 0 || miS >= PREMIER_LEAGUE_MAX_POOL_ATHLETES) return 'Invalid roster position.';
  if (miT < 0 || miT >= PREMIER_LEAGUE_MAX_POOL_ATHLETES) return 'Invalid roster position.';
  if (slotGroups[piS][miS] == null) return 'Drag an athlete from a filled slot.';
  const tmp = slotGroups[piS][miS];
  slotGroups[piS][miS] = slotGroups[piT][miT];
  slotGroups[piT][miT] = tmp;
  const groups = plCompactSlotGroups(slotGroups);
  for (let idx = 0; idx < groups.length; idx++) {
    if (groups[idx].length < 2 || groups[idx].length > 5) {
      return `Pool ${String.fromCharCode(65 + idx)} must have 2 to 5 athletes after this move (would have ${groups[idx].length}).`;
    }
  }
  return plApplyGroups(entry, groups);
}

function plSetPoolCount(entry, poolCount) {
  if (![2, 4, 8].includes(poolCount)) return 'Pool count must be 2, 4, or 8.';
  const jsonData = entry.json_data;
  if (!jsonData || typeof jsonData !== 'object') return 'No draw data.';
  const athletes = [];
  plCompactSlotGroups(plExtractSlotGroups(jsonData)).forEach((g) => athletes.push(...g));
  const n = athletes.length;
  if (n < poolCount * 2) {
    return `Need at least ${poolCount * 2} athletes for ${poolCount} pools (this division has ${n}).`;
  }
  if (n > poolCount * 5) {
    return `Too many athletes (${n}) for ${poolCount} pools (maximum ${poolCount * 5}).`;
  }
  try {
    const groups = assignCompetitorsToPools(athletes, poolCount);
    return plApplyGroups(entry, groups);
  } catch (err) {
    return err.message || String(err);
  }
}

function slotsFromJson(jsonData) {
  if (!jsonData || typeof jsonData !== 'object') return [];
  const type = String(jsonData.division_type || '').trim();
  if (type === 'Single Elimination') return seSlotsFromJson(jsonData);
  if (type === 'Round Robin') return rrSlotsFromJson(jsonData);
  if (type === 'Premier League') return plSlotsFromJson(jsonData);
  return [];
}

function swapSlots(entry, sourceSlotId, targetSlotId) {
  const slots = entry._draw_slot_list || slotsFromJson(entry.json_data);
  entry._draw_slot_list = slots;
  const byId = {};
  slots.forEach((s) => {
    if (s.slot_id) byId[s.slot_id] = s;
  });
  const src = byId[sourceSlotId];
  const tgt = byId[targetSlotId];
  if (!src || !tgt) return 'Could not find slot.';
  if (!src.editable || !tgt.editable) return 'That position cannot be swapped.';
  if (src.kind !== tgt.kind) return 'These slot types cannot be swapped with each other.';
  if (!entry.json_data || typeof entry.json_data !== 'object') return 'No draw data.';
  if (src.kind === 'se_placement') return seSwapPlacement(entry.json_data, src, tgt);
  if (src.kind === 'rr_match_order') return rrSwapMatchOrder(entry.json_data, src, tgt);
  if (src.kind === 'pl_roster') return plSwapRoster(entry, src, tgt);
  return 'Unsupported slot type.';
}

function bodyTextFromJson(jsonData, entry) {
  if (!jsonData || typeof jsonData !== 'object') return '';
  const type = String(jsonData.division_type || '').trim();
  const displayName = stripDivisionTypeTag(String(jsonData.division_name || ''));
  const athleteCount = entry ? Number(entry.athlete_count || 0) : null;
  if (type === 'Round Robin') {
    return buildRoundRobinText(jsonData, athleteCount, displayName);
  }
  if (type === 'Premier League') {
    return buildPremierLeagueText(jsonData, displayName);
  }
  if (type === 'Single Elimination') {
    return buildSingleElimText(jsonData, displayName);
  }
  if (type === 'List') {
    const rows = (jsonData.rows || []).filter((r) => r && typeof r === 'object');
    const competitors = rows.map((r) => ({
      name: String(r.name || '').trim(),
      team: String(r.team || '').trim(),
      pdf_team: String(r.team || '').trim()
    }));
    if (competitors.length) {
      return buildListText(
        competitors,
        displayName,
        String(jsonData.tatami_number || DEFAULT_DRAW_RING_NUMBER),
        ''
      );
    }
  }
  return '';
}

function refreshEntryFromJson(entry) {
  const jsonData = entry.json_data;
  if (!jsonData || typeof jsonData !== 'object') {
    return { entry, slots: [] };
  }
  const type = String(jsonData.division_type || entry.division_type || '').trim();
  entry.division_type = type;
  entry.body_text = bodyTextFromJson(jsonData, entry);
  entry._draw_slot_list = slotsFromJson(jsonData);
  return { entry, slots: entry._draw_slot_list };
}

/**
 * Rebuild a draw entry for an explicitly chosen draw type (Modify Draws → edit).
 * Uses the entry's athlete snapshots so other divisions are untouched.
 */
function setEntryDrawType(entry, drawType) {
  const { buildDrawForEntry } = require('./draws-types');
  const { normalizeDrawType } = require('./utils');
  const { DRAW_TYPE_OPTIONS } = require('./constants');

  const type = normalizeDrawType(drawType);
  if (!DRAW_TYPE_OPTIONS.includes(type)) {
    return 'Invalid draw type.';
  }

  const competitors = (entry.athletes || [])
    .map((a) => ({
      name: a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      team: a.club || a.team || '',
      pdf_team: a.club || a.team || ''
    }))
    .filter((c) => c.name);

  if (!competitors.length) {
    return 'No athletes in this draw.';
  }

  entry.division_type = type;
  entry.preserve_structure = false;
  delete entry._draw_slot_list;

  const built = buildDrawForEntry(entry, competitors);
  entry.division_type = built.draw_type;
  entry.body_text = built.body_text;
  entry.json_data = built.json_data;
  entry.preserve_structure = true;
  return null;
}

module.exports = {
  slotsFromJson,
  swapSlots,
  plSetPoolCount,
  setEntryDrawType,
  refreshEntryFromJson,
  bodyTextFromJson,
  PREMIER_LEAGUE_MAX_POOL_ATHLETES
};
