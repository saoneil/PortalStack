/**
 * Browser mirror of lib/division-tool/merge-division.js — keep logic in sync.
 */

const RANK_ORDER = [
  '10th gup', '9th gup', '8th gup', '7th gup', '6th gup',
  '5th gup', '4th gup', '3rd gup', '2nd gup', '1st gup',
  '1st dan', '2nd dan', '3rd dan', '4th dan', '5th dan', '6th dan'
];

const LIST_DRAW_TYPE_EVENT_KEYS = new Set([
  'individual_special_technique',
  'individual_power_test',
  'team_special_technique',
  'team_power_test'
]);

const EVENT_DISPLAY_NAMES = {
  individual_patterns: 'INDIVIDUAL PATTERNS',
  individual_sparring: 'INDIVIDUAL SPARRING',
  individual_special_technique: 'INDIVIDUAL SPECIAL TECHNIQUE',
  individual_power_test: 'INDIVIDUAL POWER TEST',
  team_patterns: 'TEAM PATTERNS',
  team_sparring: 'TEAM SPARRING',
  team_special_technique: 'TEAM SPECIAL TECHNIQUE',
  team_power_test: 'TEAM POWER TEST',
  pre_arranged_sparring: 'PRE ARRANGED SPARRING'
};

const PATTERN_WEIGHT_CLASSES = ['light', 'middle', 'heavy'];
const PATTERN_HEIGHT_CLASSES = ['short', 'medium', 'tall'];

function rankIndex(rank) {
  const r = String(rank || '').trim().toLowerCase();
  const idx = RANK_ORDER.findIndex((x) => x.toLowerCase() === r);
  return idx >= 0 ? idx : null;
}

function normalizeWeightClass(value) {
  const s = String(value || '').trim().toLowerCase();
  if (PATTERN_WEIGHT_CLASSES.includes(s)) return s;
  if (s === 'l' || s === 'lite') return 'light';
  if (s === 'm' || s === 'mid') return 'middle';
  if (s === 'h') return 'heavy';
  return '';
}

function normalizeHeightClass(value) {
  const s = String(value || '').trim().toLowerCase();
  if (PATTERN_HEIGHT_CLASSES.includes(s)) return s;
  if (s === 's') return 'short';
  if (s === 'm' || s === 'med' || s === 'mid') return 'medium';
  if (s === 't') return 'tall';
  return '';
}

function normalizeDrawType(value) {
  const t = String(value || '').trim().toLowerCase();
  if (t.includes('single')) return 'Single Elimination';
  if (t.includes('round')) return 'Round Robin';
  if (t.includes('premier')) return 'Premier League';
  if (t.includes('list')) return 'List';
  return 'Premier League';
}

function effectiveDrawType(leafDrawType, athleteCount) {
  const normalized = normalizeDrawType(leafDrawType);
  if (normalized === 'Premier League' && athleteCount <= 5) {
    return 'Round Robin';
  }
  return normalized;
}

function eventDisplayPrefix(eventKey) {
  const label = EVENT_DISPLAY_NAMES[eventKey] || String(eventKey).replace(/_/g, ' ').trim();
  return label.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function humanizeRankPhrase(rankUpper) {
  let s = String(rankUpper || '').trim();
  if (!s) return '';
  if (s === 'BLACK BELT') return 'Black Belt';
  s = s.replace(/\b(\d+)(ST|ND|RD|TH)\b/gi, (_, n, suf) => `${n}${suf.toLowerCase()}`);
  s = s.replace(/\s*-\s*/g, '-');
  s = s.replace(/\bTO\b/gi, 'to');
  s = s.replace(/\bGUP\b/gi, 'Gup');
  s = s.replace(/\bDAN\b/gi, 'Dan');
  return s.trim();
}

function divisionTitleFromSpec(leaf) {
  const eventKey = String(leaf.event_key || '').trim();
  const prefix = eventDisplayPrefix(eventKey);
  const gender = String(leaf.gender || 'MIXED').trim().toUpperCase();
  const genderH = gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Mixed';

  const ageMin = leaf.age_min;
  const ageMax = leaf.age_max;
  let ageStr;
  if (ageMin == null && ageMax == null) ageStr = 'All Ages';
  else if (ageMin != null && ageMax == null) ageStr = `${Math.floor(Number(ageMin))}+`;
  else if (ageMin == null && ageMax != null) ageStr = `Up To ${Math.floor(Number(ageMax))}`;
  else if (Number(ageMin) === Number(ageMax)) ageStr = `${Math.floor(Number(ageMin))}+`;
  else ageStr = `${Math.floor(Number(ageMin))} To ${Math.floor(Number(ageMax))}`;

  const rankMin = String(leaf.rank_min || '').trim();
  const rankMax = String(leaf.rank_max || '').trim();
  let rankU = '';
  if (rankMin || rankMax) {
    const rmin = (rankMin || RANK_ORDER[0]).toUpperCase();
    const rmax = (rankMax || RANK_ORDER[RANK_ORDER.length - 1]).toUpperCase();
    if (eventKey === 'individual_sparring' && rmin.includes('DAN') && rmax.includes('DAN')) {
      rankU = 'BLACK BELT';
    } else if (rmin === rmax) {
      rankU = rmin;
    } else {
      rankU = `${rmin}-${rmax}`;
    }
  }

  const parts = [prefix, ageStr, genderH];
  if (rankU) parts.push(humanizeRankPhrase(rankU));

  const wc = normalizeWeightClass(leaf.weight_class);
  if (wc) {
    parts.push(wc.charAt(0).toUpperCase() + wc.slice(1));
  }
  const hc = normalizeHeightClass(leaf.height_class);
  if (hc) {
    parts.push(hc.charAt(0).toUpperCase() + hc.slice(1));
  }

  const wMin = leaf.weight_min;
  const wMax = leaf.weight_max;
  if ((wMin != null || wMax != null) && !wc) {
    if (wMin != null && wMax != null) parts.push(`${wMin}-${wMax} Kg`);
    else if (wMin != null) parts.push(`${wMin}+ Kg`);
    else parts.push(`Up To ${wMax} Kg`);
  }

  const hMin = leaf.height_min;
  const hMax = leaf.height_max;
  if ((hMin != null || hMax != null) && !hc) {
    if (hMin != null && hMax != null) parts.push(`${hMin}-${hMax} Cm`);
    else if (hMin != null) parts.push(`${hMin}+ Cm`);
    else parts.push(`Up To ${hMax} Cm`);
  }

  return parts.join(' - ');
}

export function preferredDrawTypeAfterMerge(eventKey, athleteCount) {
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

export function unionLeafSpecs(sourceLeaf, targetLeaf) {
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

export function leafSpecFromAthletes(athletes, eventKey) {
  const list = Array.isArray(athletes) ? athletes : [];
  const genders = new Set();
  list.forEach((ath) => {
    genders.add(normalizeGenderToken(ath?.gender));
  });
  let gender = 'MIXED';
  if (genders.size === 1) {
    gender = [...genders][0];
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

export function applyCombineToTarget({
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

export { divisionTitleFromSpec };
