const crypto = require('crypto');
const {
  RANK_ORDER,
  EVENT_DISPLAY_NAMES,
  LIST_DRAW_TYPE_EVENT_KEYS,
  PATTERN_WEIGHT_CLASSES,
  PATTERN_HEIGHT_CLASSES,
  DRAW_TYPE_OPTIONS
} = require('./constants');

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

function stripDivisionTypeTag(name) {
  return String(name || '')
    .replace(/\s*\[(SINGLE_ELIMINATION|ROUND_ROBIN|PREMIER_LEAGUE|LIST|DIVISION)\]\s*/gi, '')
    .trim();
}

function normalizeDrawType(value) {
  const t = String(value || '').trim().toLowerCase();
  if (t.includes('single')) return 'Single Elimination';
  if (t.includes('round')) return 'Round Robin';
  if (t.includes('premier')) return 'Premier League';
  if (t.includes('list')) return 'List';
  return 'Premier League';
}

function drawTypeForEvent(eventKey, selectedDrawType) {
  if (LIST_DRAW_TYPE_EVENT_KEYS.has(String(eventKey || '').trim())) {
    return 'List';
  }
  const drawType = normalizeDrawType(selectedDrawType || 'Premier League');
  return DRAW_TYPE_OPTIONS.includes(drawType) ? drawType : 'Premier League';
}

function leafEffectiveDrawType(leaf) {
  const eventKey = String(leaf.event_key || '').trim();
  let raw = String(leaf.draw_type || '').trim() || 'Premier League';
  if (leaf.draw_type_user_override && DRAW_TYPE_OPTIONS.includes(raw)) {
    return raw;
  }
  return drawTypeForEvent(eventKey, raw);
}

function effectiveDrawType(leafDrawType, athleteCount) {
  const normalized = normalizeDrawType(leafDrawType);
  if (normalized === 'Premier League' && athleteCount <= 5) {
    return 'Round Robin';
  }
  return normalized;
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

function rankIndex(rank) {
  const r = String(rank || '').trim().toLowerCase();
  const idx = RANK_ORDER.findIndex((x) => x.toLowerCase() === r);
  return idx >= 0 ? idx : null;
}

function rankInRange(rank, rankMin, rankMax) {
  const idx = rankIndex(rank);
  if (idx == null) return false;
  const lo = rankMin ? rankIndex(rankMin) : 0;
  const hi = rankMax ? rankIndex(rankMax) : RANK_ORDER.length - 1;
  if (lo == null || hi == null) return true;
  return idx >= lo && idx <= hi;
}

function genderMatches(value, allowed) {
  const v = String(value || '').trim().toUpperCase();
  if (allowed.has('MIXED')) return true;
  if (v === 'M' || v === 'MALE') return allowed.has('M');
  if (v === 'F' || v === 'FEMALE') return allowed.has('F');
  if (v === 'X' || v === 'MIXED') return allowed.has('MIXED');
  return allowed.has('MIXED');
}

function computeAgeYears(dob, refDate) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const ref = refDate ? new Date(refDate) : new Date();
  return (ref - d) / (365.25 * 24 * 60 * 60 * 1000);
}

function formatCompetitorLine(competitor) {
  const name = String(competitor.name || '').trim();
  const team = String(competitor.pdf_team || competitor.team || '').trim();
  return team ? `${name} | ${team}` : name;
}

function stateSignature(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function patternEventSkipsWeight(eventKey) {
  return [
    'individual_patterns', 'individual_special_technique', 'individual_power_test',
    'team_patterns', 'team_sparring', 'team_special_technique', 'team_power_test',
    'pre_arranged_sparring'
  ].includes(String(eventKey || '').trim());
}

function patternEventUsesHeight(eventKey) {
  return ['individual_special_technique', 'team_special_technique', 'individual_sparring']
    .includes(String(eventKey || '').trim());
}

module.exports = {
  safeDivisionBasename,
  stripDivisionTypeTag,
  normalizeDrawType,
  drawTypeForEvent,
  leafEffectiveDrawType,
  effectiveDrawType,
  normalizeWeightClass,
  normalizeHeightClass,
  eventDisplayPrefix,
  humanizeRankPhrase,
  divisionTitleFromSpec,
  rankIndex,
  rankInRange,
  genderMatches,
  computeAgeYears,
  formatCompetitorLine,
  stateSignature,
  patternEventSkipsWeight,
  patternEventUsesHeight
};
