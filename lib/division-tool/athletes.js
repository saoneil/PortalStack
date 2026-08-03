const { EVENT_COLUMNS } = require('./constants');
const {
  rankInRange,
  genderMatches,
  computeAgeYears,
  normalizeWeightClass,
  normalizeHeightClass,
  patternEventSkipsWeight
} = require('./utils');

function normalizeAthletesFromRows(rows) {
  return (rows || []).map((row, index) => {
    const athlete = {
      _index: index,
      first_name: String(row.first_name || '').trim(),
      last_name: String(row.last_name || '').trim(),
      dob: row.dob || null,
      rank: String(row.rank || '').trim(),
      gender: String(row.gender || '').trim(),
      weight_kg: row.weight_kg != null ? Number(row.weight_kg) : null,
      height_cm: row.height_kg != null ? Number(row.height_kg) : (row.height_cm != null ? Number(row.height_cm) : null),
      team_name_or_country: String(row.team_name_or_country || '').trim(),
      team_name_or_country_dirty: String(row.team_name_or_country || '').trim()
    };
    EVENT_COLUMNS.forEach((col) => {
      athlete[col] = Number(row[col] || 0) === 1 ? 1 : 0;
      athlete[`${col}_assigned`] = 0;
    });
    return athlete;
  });
}

function extractCompetitors(athletes) {
  return (athletes || []).map((row) => {
    const first = String(row.first_name || '').trim();
    const last = String(row.last_name || '').trim();
    const team = String(row.team_name_or_country || '').trim();
    const pdfTeam = String(row.team_name_or_country_dirty || row.team_name_or_country || '').trim();
    return {
      name: `${first} ${last}`.trim(),
      team,
      pdf_team: pdfTeam
    };
  });
}

function athleteSnapshot(athlete, refDate) {
  const age = computeAgeYears(athlete.dob, refDate);
  return {
    index: athlete._index,
    name: `${athlete.first_name} ${athlete.last_name}`.trim(),
    first_name: athlete.first_name,
    last_name: athlete.last_name,
    dob: athlete.dob,
    age: age != null ? Math.floor(age * 10) / 10 : null,
    weight_kg: athlete.weight_kg,
    height_cm: athlete.height_cm,
    rank: athlete.rank,
    gender: athlete.gender,
    club: athlete.team_name_or_country,
    team: athlete.team_name_or_country
  };
}

function isLmhUnresolvedPlaceholder(leaf) {
  return (
    String(leaf.event_key || '') === 'individual_sparring' &&
    normalizeWeightClass(leaf.weight_class) &&
    leaf.weight_min == null &&
    leaf.weight_max == null
  );
}

function isSmtUnresolvedPlaceholder(leaf) {
  return (
    normalizeHeightClass(leaf.height_class) &&
    leaf.height_min == null &&
    leaf.height_max == null
  );
}

function filterAthletesForLeaf(athletes, leaf, options = {}) {
  const { skipAssigned = false, refDate = null } = options;
  const eventKey = String(leaf.event_key || '').trim();
  let manualIndices = new Set((leaf.manual_include_indices || []).map((x) => Number(x)));

  let idOnly = Boolean(leaf.id_only_membership);
  if (idOnly && manualIndices.size > 0) {
    // resolved manual IDs
  } else if (idOnly && isLmhUnresolvedPlaceholder(leaf)) {
    idOnly = false;
  } else if (idOnly && isSmtUnresolvedPlaceholder(leaf)) {
    idOnly = false;
  }

  if (idOnly) {
    let filtered = athletes.filter((a) => manualIndices.has(a._index));
    if (eventKey) {
      filtered = filtered.filter((a) => Number(a[eventKey]) === 1);
    }
    return filtered;
  }

  let filtered = athletes.slice();
  if (eventKey) {
    filtered = filtered.filter((a) => Number(a[eventKey]) === 1);
    if (skipAssigned) {
      filtered = filtered.filter((a) => Number(a[`${eventKey}_assigned`] || 0) !== 1);
    }
  }

  const gender = String(leaf.gender || 'MIXED').trim().toUpperCase();
  if (gender === 'M' || gender === 'F') {
    filtered = filtered.filter((a) => genderMatches(a.gender, new Set([gender])));
  }

  const ageMin = leaf.age_min;
  const ageMax = leaf.age_max;
  if (ageMin != null || ageMax != null) {
    filtered = filtered.filter((a) => {
      const age = computeAgeYears(a.dob, refDate);
      if (age == null) return false;
      if (ageMin != null && age < Number(ageMin)) return false;
      if (ageMax != null && age > Number(ageMax)) return false;
      return true;
    });
  }

  const rankMin = String(leaf.rank_min || '').trim();
  const rankMax = String(leaf.rank_max || '').trim();
  if (rankMin || rankMax) {
    filtered = filtered.filter((a) => rankInRange(a.rank, rankMin, rankMax));
  }

  if (eventKey === 'individual_sparring' && !patternEventSkipsWeight(eventKey)) {
    const wMin = leaf.weight_min;
    const wMax = leaf.weight_max;
    const weightClass = normalizeWeightClass(leaf.weight_class);
    const applyKg = (wMin != null || wMax != null) && !(weightClass && wMin == null && wMax == null);
    if (applyKg) {
      filtered = filtered.filter((a) => {
        const w = Number(a.weight_kg);
        if (Number.isNaN(w)) return false;
        if (wMin != null && w < Number(wMin)) return false;
        if (wMax != null && w > Number(wMax)) return false;
        return true;
      });
    }
  }

  const hMin = leaf.height_min;
  const hMax = leaf.height_max;
  const heightClass = normalizeHeightClass(leaf.height_class);
  const applyCm = (hMin != null || hMax != null) && !(heightClass && hMin == null && hMax == null);
  if (applyCm) {
    filtered = filtered.filter((a) => {
      const h = Number(a.height_cm);
      if (Number.isNaN(h)) return false;
      if (hMin != null && h < Number(hMin)) return false;
      if (hMax != null && h > Number(hMax)) return false;
      return true;
    });
  }

  if (manualIndices.size > 0) {
    const forced = athletes.filter((a) => {
      if (!manualIndices.has(a._index)) return false;
      if (eventKey && Number(a[eventKey]) !== 1) return false;
      return true;
    });
    const seen = new Set(filtered.map((a) => a._index));
    forced.forEach((a) => {
      if (!seen.has(a._index)) {
        filtered.push(a);
        seen.add(a._index);
      }
    });
  }

  return filtered;
}

function athletesByIndices(athletes, indices) {
  const map = new Map(athletes.map((a) => [a._index, a]));
  return (indices || [])
    .map((idx) => map.get(Number(idx)))
    .filter(Boolean);
}

module.exports = {
  normalizeAthletesFromRows,
  extractCompetitors,
  athleteSnapshot,
  filterAthletesForLeaf,
  athletesByIndices,
  isLmhUnresolvedPlaceholder,
  isSmtUnresolvedPlaceholder
};
