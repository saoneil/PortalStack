const { RANK_ORDER, LIST_DRAW_TYPE_EVENT_KEYS } = require('./constants');
const {
  rankIndex,
  normalizeWeightClass,
  normalizeHeightClass,
  divisionTitleFromSpec,
  effectiveDrawType
} = require('./utils');

function preferredDrawTypeAfterMerge(eventKey, athleteCount) {
  const ek = String(eventKey || '').trim();
  if (LIST_DRAW_TYPE_EVENT_KEYS.has(ek)) return 'List';
  return effectiveDrawType('Premier League', Number(athleteCount) || 0);
}

function normalizeGenderToken(value) {
  const g = String(value || '').trim().toUpperCase();
  if (g === 'M' || g === 'MALE') return 'M';
  if (g === 'F' || g === 'FEMALE') return 'F';
  return 'MIXED';
}

function unionGender(a, b) {
  const ga = normalizeGenderToken(a);
  const gb = normalizeGenderToken(b);
  if (ga === gb) return ga;
  return 'MIXED';
}

/** Either side open (null) → result open. */
function unionBoundMin(a, b) {
  if (a == null || b == null) return null;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  return Math.min(na, nb);
}

function unionBoundMax(a, b) {
  if (a == null || b == null) return null;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  return Math.max(na, nb);
}

function rankSpan(leaf) {
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

function unionRank(a, b) {
  const [aLo, aHi] = rankSpan(a);
  const [bLo, bHi] = rankSpan(b);
  const lo = Math.min(aLo, bLo);
  const hi = Math.max(aHi, bHi);
  return {
    rank_min: RANK_ORDER[lo] || '',
    rank_max: RANK_ORDER[hi] || ''
  };
}

function unionClassField(aClass, bClass, normalizeFn) {
  const ca = normalizeFn(aClass);
  const cb = normalizeFn(bClass);
  if (ca && cb && ca === cb) return ca;
  return '';
}

/**
 * Union two leaf-like specs (source + target). Keeps target event_key when present.
 */
function unionLeafSpecs(sourceLeaf, targetLeaf) {
  const a = sourceLeaf && typeof sourceLeaf === 'object' ? sourceLeaf : {};
  const b = targetLeaf && typeof targetLeaf === 'object' ? targetLeaf : {};
  const eventKey = String(b.event_key || a.event_key || '').trim();
  const ranks = unionRank(a, b);
  const weightClass = unionClassField(a.weight_class, b.weight_class, normalizeWeightClass);
  const heightClass = unionClassField(a.height_class, b.height_class, normalizeHeightClass);

  return {
    event_key: eventKey,
    gender: unionGender(a.gender, b.gender),
    age_min: unionBoundMin(a.age_min, b.age_min),
    age_max: unionBoundMax(a.age_max, b.age_max),
    rank_min: ranks.rank_min,
    rank_max: ranks.rank_max,
    weight_class: weightClass,
    weight_min: unionBoundMin(a.weight_min, b.weight_min),
    weight_max: unionBoundMax(a.weight_max, b.weight_max),
    height_class: heightClass,
    height_min: unionBoundMin(a.height_min, b.height_min),
    height_max: unionBoundMax(a.height_max, b.height_max)
  };
}

/**
 * Build a synthetic leaf spec from athlete snapshots when no leaf is available.
 */
function leafSpecFromAthletes(athletes, eventKey) {
  const list = Array.isArray(athletes) ? athletes : [];
  const genders = new Set();
  list.forEach((ath) => {
    genders.add(normalizeGenderToken(ath?.gender));
  });
  let gender = 'MIXED';
  if (genders.size === 1) {
    gender = [...genders][0];
  } else if (genders.size === 0) {
    gender = 'MIXED';
  } else if (genders.size === 2 && genders.has('M') && genders.has('F') && !genders.has('MIXED')) {
    gender = 'MIXED';
  } else {
    gender = 'MIXED';
  }

  const ages = list
    .map((ath) => (ath?.age != null ? Number(ath.age) : null))
    .filter((n) => n != null && Number.isFinite(n));
  const age_min = ages.length ? Math.min(...ages) : null;
  const age_max = ages.length ? Math.max(...ages) : null;

  const rankIdxs = list
    .map((ath) => rankIndex(ath?.rank))
    .filter((i) => i != null);
  let rank_min = '';
  let rank_max = '';
  if (rankIdxs.length) {
    rank_min = RANK_ORDER[Math.min(...rankIdxs)] || '';
    rank_max = RANK_ORDER[Math.max(...rankIdxs)] || '';
  }

  const weights = list
    .map((ath) => (ath?.weight_kg != null ? Number(ath.weight_kg) : null))
    .filter((n) => n != null && Number.isFinite(n));
  const heights = list
    .map((ath) => (ath?.height_cm != null ? Number(ath.height_cm) : null))
    .filter((n) => n != null && Number.isFinite(n));

  return {
    event_key: String(eventKey || '').trim(),
    gender,
    age_min,
    age_max,
    rank_min,
    rank_max,
    weight_class: '',
    weight_min: weights.length ? Math.min(...weights) : null,
    weight_max: weights.length ? Math.max(...weights) : null,
    height_class: '',
    height_min: heights.length ? Math.min(...heights) : null,
    height_max: heights.length ? Math.max(...heights) : null
  };
}

function applyMergedSpecToLeaf(leaf, merged) {
  if (!leaf || !merged) return leaf;
  leaf.event_key = merged.event_key || leaf.event_key;
  leaf.gender = merged.gender;
  leaf.age_min = merged.age_min;
  leaf.age_max = merged.age_max;
  leaf.rank_min = merged.rank_min;
  leaf.rank_max = merged.rank_max;
  leaf.weight_class = merged.weight_class || '';
  leaf.weight_min = merged.weight_min;
  leaf.weight_max = merged.weight_max;
  leaf.height_class = merged.height_class || '';
  leaf.height_min = merged.height_min;
  leaf.height_max = merged.height_max;
  leaf.division_name = divisionTitleFromSpec(merged);
  const preferred = LIST_DRAW_TYPE_EVENT_KEYS.has(String(merged.event_key || '').trim())
    ? 'List'
    : 'Premier League';
  leaf.draw_type = preferred;
  leaf.draw_type_user_override = false;
  return leaf;
}

/**
 * Union source into target catalog entry (and optional target leaf). Mutates target.
 * Call with pre-move athlete lists when deriving specs from athletes.
 */
function applyCombineToTarget({
  sourceEntry,
  targetEntry,
  sourceLeaf = null,
  targetLeaf = null,
  sourceAthletes = null,
  targetAthletes = null
} = {}) {
  if (!targetEntry) return null;
  const eventKey = String(targetEntry.event_key || sourceEntry?.event_key || '').trim();
  const fromSpec = sourceLeaf
    || leafSpecFromAthletes(sourceAthletes || sourceEntry?.athletes, eventKey);
  const toSpec = targetLeaf
    || leafSpecFromAthletes(targetAthletes || targetEntry?.athletes, eventKey);
  const merged = unionLeafSpecs(fromSpec, toSpec);
  merged.event_key = eventKey;

  const name = divisionTitleFromSpec(merged);
  targetEntry.division_name = name;
  targetEntry.division_type = preferredDrawTypeAfterMerge(
    eventKey,
    Number(targetEntry.athlete_count != null
      ? targetEntry.athlete_count
      : (targetEntry.athlete_indices || []).length) || 0
  );

  if (targetLeaf) {
    applyMergedSpecToLeaf(targetLeaf, merged);
    if (targetEntry.id != null && targetEntry.id !== '') {
      targetLeaf._groupings_id = String(targetEntry.id);
    }
  }

  return { merged, divisionName: name, divisionType: targetEntry.division_type };
}

module.exports = {
  preferredDrawTypeAfterMerge,
  unionLeafSpecs,
  leafSpecFromAthletes,
  applyMergedSpecToLeaf,
  applyCombineToTarget,
  normalizeGenderToken
};
