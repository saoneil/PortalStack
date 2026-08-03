/**
 * Move-target suggestions — port of Python DivisionToolApp
 * `_groupings_leaf_similarity_score` / `_groupings_build_move_target_combo_values`.
 */

export const MOVE_SIMILAR_SUGGEST_COUNT = 5;
export const MOVE_SIMILAR_PREFIX = '★ ';
export const MOVE_ALL_OTHERS_SEPARATOR = '— all other divisions —';

const RANK_ORDER = [
  '10th gup', '9th gup', '8th gup', '7th gup', '6th gup',
  '5th gup', '4th gup', '3rd gup', '2nd gup', '1st gup',
  '1st dan', '2nd dan', '3rd dan', '4th dan', '5th dan', '6th dan'
];

const PATTERN_WEIGHT_CLASSES = ['light', 'middle', 'heavy'];

function normalizeLabel(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripDivisionTypeTag(name) {
  return String(name || '')
    .replace(/\s*\[(SINGLE_ELIMINATION|ROUND_ROBIN|PREMIER_LEAGUE|LIST|DIVISION)\]\s*/gi, '')
    .trim();
}

function displayDivisionName(fullName) {
  return stripDivisionTypeTag(fullName);
}

function safeDivisionBasename(name) {
  const invalid = '<>:"/\\|?*';
  let safe = String(name || '')
    .split('')
    .filter((c) => !invalid.includes(c) && c.charCodeAt(0) >= 32)
    .join('')
    .trim()
    .replace(/\.+$/, '');
  return safe || 'division';
}

function normalizeDrawType(value) {
  const t = String(value || '').trim().toLowerCase();
  if (t.includes('single')) return 'Single Elimination';
  if (t.includes('round')) return 'Round Robin';
  if (t.includes('premier')) return 'Premier League';
  if (t.includes('list')) return 'List';
  return 'Premier League';
}

function normalizeWeightClass(value) {
  const s = String(value || '').trim().toLowerCase();
  if (PATTERN_WEIGHT_CLASSES.includes(s)) return s;
  if (s === 'l' || s === 'lite') return 'light';
  if (s === 'm' || s === 'mid') return 'middle';
  if (s === 'h') return 'heavy';
  return '';
}

function rankIndex(rank) {
  const key = String(rank || '').trim().toLowerCase();
  if (!key) return null;
  const idx = RANK_ORDER.findIndex((r) => r.toLowerCase() === key);
  return idx >= 0 ? idx : null;
}

/** rapidfuzz-style indel ratio on token-sorted strings (0–100). */
function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n];
}

function fuzzRatio(s1, s2) {
  const a = String(s1 || '');
  const b = String(s2 || '');
  if (!a && !b) return 100;
  const denom = a.length + b.length;
  if (!denom) return 100;
  const dist = denom - 2 * lcsLength(a, b);
  return 100 * (1 - dist / denom);
}

function tokenSortRatio(s1, s2) {
  const sorted1 = normalizeLabel(s1).split(' ').filter(Boolean).sort().join(' ');
  const sorted2 = normalizeLabel(s2).split(' ').filter(Boolean).sort().join(' ');
  return fuzzRatio(sorted1, sorted2);
}

function intervalOverlapRatio(lo1, hi1, lo2, hi2) {
  const openLo = -1e9;
  const openHi = 1e9;
  let aLo = lo1 != null && lo1 !== '' ? Number(lo1) : openLo;
  let aHi = hi1 != null && hi1 !== '' ? Number(hi1) : openHi;
  let bLo = lo2 != null && lo2 !== '' ? Number(lo2) : openLo;
  let bHi = hi2 != null && hi2 !== '' ? Number(hi2) : openHi;
  if (Number.isNaN(aLo)) aLo = openLo;
  if (Number.isNaN(aHi)) aHi = openHi;
  if (Number.isNaN(bLo)) bLo = openLo;
  if (Number.isNaN(bHi)) bHi = openHi;
  if (aLo > aHi) [aLo, aHi] = [aHi, aLo];
  if (bLo > bHi) [bLo, bHi] = [bHi, bLo];
  const overlapLo = Math.max(aLo, bLo);
  const overlapHi = Math.min(aHi, bHi);
  if (overlapHi < overlapLo) return 0;
  const overlap = overlapHi - overlapLo;
  const union = Math.max(aHi, bHi) - Math.min(aLo, bLo);
  if (union <= 0) return 1;
  return overlap / union;
}

function genderSimilarityScore(g1, g2) {
  let a = String(g1 || '').trim().toUpperCase() || 'MIXED';
  let b = String(g2 || '').trim().toUpperCase() || 'MIXED';
  if (!['M', 'F', 'MIXED'].includes(a)) a = 'MIXED';
  if (!['M', 'F', 'MIXED'].includes(b)) b = 'MIXED';
  if (a === b) return 1;
  if (a === 'MIXED' || b === 'MIXED') return 0.5;
  return 0;
}

function rankSpanIndices(leaf) {
  const rmin = String(leaf?.rank_min || '').trim();
  const rmax = String(leaf?.rank_max || '').trim();
  if (!rmin && !rmax) return [0, RANK_ORDER.length - 1];
  let lo = rmin ? rankIndex(rmin) : 0;
  let hi = rmax ? rankIndex(rmax) : RANK_ORDER.length - 1;
  if (lo == null) lo = 0;
  if (hi == null) hi = RANK_ORDER.length - 1;
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

function entryAthleteCount(entry) {
  const n = Number(entry?.athlete_count || 0);
  return Number.isFinite(n) ? n : 0;
}

export function findLeafByDivisionId(leaves, divisionId) {
  const id = String(divisionId || '').trim();
  if (!id) return null;
  const list = leaves || [];
  for (const leaf of list) {
    if (String(leaf._groupings_id || '').trim() === id) return leaf;
  }
  for (const leaf of list) {
    const name = String(leaf.division_name || '').trim();
    if (safeDivisionBasename(name) === id) return leaf;
  }
  return null;
}

function catalogEntry(catalog, divisionId) {
  const id = String(divisionId || '').trim();
  if (!id) return null;
  return (catalog || []).find((e) => String(e.id) === id) || null;
}

function effectiveDrawTypeForDivision(catalog, divisionId, leaf) {
  const entry = catalogEntry(catalog, divisionId);
  if (entry) {
    const raw = String(entry.division_type || '').trim();
    if (raw) return normalizeDrawType(raw);
  }
  if (!leaf) return '';
  const preferred = normalizeDrawType(leaf.draw_type || 'Premier League');
  const count = entryAthleteCount(entry) || 0;
  if (preferred === 'Premier League' && count <= 5) return 'Round Robin';
  return preferred;
}

function drawTypesCompatible(catalog, sourceLeaf, targetLeaf, sourceId, targetId) {
  const srcId = String(sourceId || '').trim();
  const tgtId = String(targetId || '').trim();
  if (srcId || tgtId) {
    const src = effectiveDrawTypeForDivision(catalog, srcId, sourceLeaf);
    const tgt = effectiveDrawTypeForDivision(catalog, tgtId, targetLeaf);
    if (src && tgt) return src === tgt;
  }
  if (!sourceLeaf || !targetLeaf) return true;
  return (
    effectiveDrawTypeForDivision(catalog, '', sourceLeaf)
    === effectiveDrawTypeForDivision(catalog, '', targetLeaf)
  );
}

function leafSimilarityScore(
  catalog,
  sourceLeaf,
  targetLeaf,
  sourceLabel,
  targetLabel,
  sourceId,
  targetId
) {
  if (!drawTypesCompatible(catalog, sourceLeaf, targetLeaf, sourceId, targetId)) {
    return 0;
  }

  const gender = genderSimilarityScore(sourceLeaf.gender, targetLeaf.gender);
  const age = intervalOverlapRatio(
    sourceLeaf.age_min,
    sourceLeaf.age_max,
    targetLeaf.age_min,
    targetLeaf.age_max
  );
  const [sLo, sHi] = rankSpanIndices(sourceLeaf);
  const [tLo, tHi] = rankSpanIndices(targetLeaf);
  const rank = intervalOverlapRatio(sLo, sHi, tLo, tHi);
  let weight = intervalOverlapRatio(
    sourceLeaf.weight_min,
    sourceLeaf.weight_max,
    targetLeaf.weight_min,
    targetLeaf.weight_max
  );
  const wcSrc = normalizeWeightClass(sourceLeaf.weight_class);
  const wcTgt = normalizeWeightClass(targetLeaf.weight_class);
  if (
    wcSrc && wcTgt
    && PATTERN_WEIGHT_CLASSES.includes(wcSrc)
    && PATTERN_WEIGHT_CLASSES.includes(wcTgt)
  ) {
    if (wcSrc === wcTgt) weight = Math.min(1, weight + 0.25);
    else weight *= 0.5;
  }

  const name = tokenSortRatio(sourceLabel, targetLabel) / 100;

  return (
    0.25 * name
    + 0.20 * gender
    + 0.25 * age
    + 0.15 * rank
    + 0.15 * weight
  );
}

function moveComboDisplayLabel(entry, suggested) {
  const base = displayDivisionName(String(entry.division_name || ''));
  return suggested ? `${MOVE_SIMILAR_PREFIX}${base}` : base;
}

/**
 * @returns {{ options: Array<{ id: string, label: string, suggested: boolean }>, separator: string }}
 */
export function buildMoveTargetOptions(sourceEntry, catalog, leaves) {
  const sourceId = String(sourceEntry?.id || '');
  const sourceEvent = String(sourceEntry?.event_key || '').trim();
  const candidates = (catalog || []).filter((entry) => {
    const divId = String(entry.id || '');
    if (!divId || divId === sourceId) return false;
    return String(entry.event_key || '').trim() === sourceEvent;
  });

  if (!candidates.length) {
    return { options: [], separator: MOVE_ALL_OTHERS_SEPARATOR, suggestedCount: 0 };
  }

  const sourceLeaf = findLeafByDivisionId(leaves, sourceId);
  const sourceLabel = displayDivisionName(String(sourceEntry.division_name || ''));

  const sortKey = (entry) => displayDivisionName(String(entry.division_name || '')).toLowerCase();

  if (!sourceLeaf) {
    const flat = [...candidates].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return {
      options: flat.map((entry) => ({
        id: String(entry.id),
        label: moveComboDisplayLabel(entry, false),
        suggested: false
      })),
      separator: MOVE_ALL_OTHERS_SEPARATOR,
      suggestedCount: 0
    };
  }

  const scored = candidates.map((entry) => {
    const divId = String(entry.id);
    const targetLeaf = findLeafByDivisionId(leaves, divId);
    const targetLabel = displayDivisionName(String(entry.division_name || ''));
    let score;
    if (targetLeaf) {
      score = leafSimilarityScore(
        catalog,
        sourceLeaf,
        targetLeaf,
        sourceLabel,
        targetLabel,
        sourceId,
        divId
      );
    } else {
      score = tokenSortRatio(sourceLabel, targetLabel) / 100;
    }
    return { score, key: sortKey(entry), entry };
  });

  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const similarScored = scored.filter((item) => entryAthleteCount(item.entry) > 0);
  const topEntries = similarScored
    .slice(0, MOVE_SIMILAR_SUGGEST_COUNT)
    .map((item) => item.entry);
  const topIds = new Set(topEntries.map((e) => String(e.id)));
  const restEntries = scored
    .filter((item) => !topIds.has(String(item.entry.id)))
    .map((item) => item.entry)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const options = [
    ...topEntries.map((entry) => ({
      id: String(entry.id),
      label: moveComboDisplayLabel(entry, true),
      suggested: true
    })),
    ...restEntries.map((entry) => ({
      id: String(entry.id),
      label: moveComboDisplayLabel(entry, false),
      suggested: false
    }))
  ];

  return {
    options,
    separator: MOVE_ALL_OTHERS_SEPARATOR,
    suggestedCount: topEntries.length
  };
}
