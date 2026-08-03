const {
  PATTERN_WEIGHT_CLASSES,
  PATTERN_HEIGHT_CLASSES,
  LMH_TERTILE_SPLIT_MIN_ATHLETES,
  GROUPINGS_FORMAT_VERSION
} = require('./constants');
const {
  safeDivisionBasename,
  stripDivisionTypeTag,
  leafEffectiveDrawType,
  effectiveDrawType,
  normalizeWeightClass,
  normalizeHeightClass,
  stateSignature
} = require('./utils');
const {
  filterAthletesForLeaf,
  athleteSnapshot,
  athletesByIndices,
  isLmhUnresolvedPlaceholder,
  isSmtUnresolvedPlaceholder
} = require('./athletes');

function lmhCohortKey(leaf) {
  return [
    leaf.event_key,
    leaf.gender,
    leaf.age_min,
    leaf.age_max,
    leaf.rank_min,
    leaf.rank_max
  ].join('|');
}

function smtCohortKey(leaf) {
  return [
    leaf.event_key,
    leaf.gender,
    leaf.age_min,
    leaf.age_max,
    leaf.rank_min,
    leaf.rank_max,
    leaf.weight_min,
    leaf.weight_max,
    normalizeWeightClass(leaf.weight_class)
  ].join('|');
}

function splitPoolTertile(pool, field, classes, defaultClass) {
  const empty = {};
  classes.forEach((c) => { empty[c] = []; });
  const n = pool.length;
  if (n === 0) return empty;
  const sorted = [...pool].sort((a, b) => {
    const av = Number(a[field]);
    const bv = Number(b[field]);
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
    if (Number.isNaN(av)) return 1;
    if (Number.isNaN(bv)) return -1;
    return av - bv;
  });
  if (n < LMH_TERTILE_SPLIT_MIN_ATHLETES) {
    empty[defaultClass] = sorted;
    return empty;
  }
  const q = Math.floor(n / 3);
  const r = n % 3;
  const sizes = [q + (r > 0 ? 1 : 0), q + (r > 1 ? 1 : 0), q];
  let start = 0;
  const out = {};
  classes.forEach((cls, i) => {
    out[cls] = sorted.slice(start, start + sizes[i]);
    start += sizes[i];
  });
  return out;
}

function lmhSplitPool(pool) {
  return splitPoolTertile(pool, 'weight_kg', PATTERN_WEIGHT_CLASSES, 'middle');
}

function smtSplitPool(pool) {
  return splitPoolTertile(pool, 'height_cm', PATTERN_HEIGHT_CLASSES, 'medium');
}

function lmhPoolForCohort(template, athletes, refDate) {
  const pool = filterAthletesForLeaf(athletes, template, { refDate });
  return pool;
}

function assignDivisionId(leaf, seenIds, ordinal) {
  const rawName = String(leaf.division_name || '').trim();
  let divisionId = safeDivisionBasename(rawName);
  if (!divisionId) divisionId = `division_${ordinal + 1}`;
  let base = divisionId;
  let suffix = 2;
  while (seenIds.has(divisionId)) {
    divisionId = `${base}_${suffix}`;
    suffix += 1;
  }
  seenIds.add(divisionId);
  leaf._groupings_id = divisionId;
  return [divisionId, stripDivisionTypeTag(rawName || divisionId)];
}

function seedAssignmentsForLeaf(leaf, athletes, refDate) {
  if (isLmhUnresolvedPlaceholder(leaf) || isSmtUnresolvedPlaceholder(leaf)) {
    return new Set();
  }
  const existing = leaf.manual_include_indices || [];
  if (leaf.id_only_membership && existing.length) {
    return new Set(existing.map(Number));
  }
  const matched = filterAthletesForLeaf(athletes, leaf, { refDate });
  return new Set(matched.map((a) => a._index));
}

function applyLmhAssignments(leaves, athletes, assignments, refDate) {
  const byCohort = {};
  const templates = {};
  leaves.forEach((leaf) => {
    if (!leaf.enabled) return;
    if (!isLmhUnresolvedPlaceholder(leaf)) return;
    const divisionId = leaf._groupings_id || safeDivisionBasename(leaf.division_name);
    const wc = normalizeWeightClass(leaf.weight_class);
    const key = lmhCohortKey(leaf);
    if (!byCohort[key]) byCohort[key] = {};
    byCohort[key][wc] = divisionId;
    templates[key] = leaf;
  });

  Object.keys(byCohort).forEach((key) => {
    const classToDivId = byCohort[key];
    if (Object.keys(classToDivId).length !== PATTERN_WEIGHT_CLASSES.length) return;
    const template = templates[key];
    const pool = lmhPoolForCohort(template, athletes, refDate);
    const buckets = lmhSplitPool(pool);
    PATTERN_WEIGHT_CLASSES.forEach((wc) => {
      const divisionId = classToDivId[wc];
      if (!divisionId) return;
      const bucket = buckets[wc] || [];
      assignments[divisionId] = new Set(bucket.map((a) => a._index));
      const leaf = leaves.find((l) => (l._groupings_id || safeDivisionBasename(l.division_name)) === divisionId);
      if (!leaf) return;
      leaf.manual_include_indices = bucket.map((a) => a._index).sort((a, b) => a - b);
      leaf.id_only_membership = true;
      const weights = bucket.map((a) => Number(a.weight_kg)).filter((w) => !Number.isNaN(w));
      if (!weights.length) {
        leaf.weight_min = null;
        leaf.weight_max = null;
      } else {
        leaf.weight_min = Math.min(...weights);
        leaf.weight_max = Math.max(...weights);
      }
    });
  });
}

function applySmtAssignments(leaves, athletes, assignments, refDate) {
  const byCohort2d = {};
  const templates2d = {};
  const byCohortH = {};
  const templatesH = {};

  leaves.forEach((leaf) => {
    if (!leaf.enabled) return;
    if (!normalizeHeightClass(leaf.height_class)) return;
    if (leaf.height_min != null || leaf.height_max != null) {
      if (!isLmhUnresolvedPlaceholder(leaf)) return;
    }
    const divisionId = leaf._groupings_id || safeDivisionBasename(leaf.division_name);
    const hc = normalizeHeightClass(leaf.height_class);
    if (!hc) return;
    if (String(leaf.event_key) === 'individual_sparring' && isLmhUnresolvedPlaceholder(leaf)) {
      const key = lmhCohortKey(leaf);
      const wc = normalizeWeightClass(leaf.weight_class);
      if (!byCohort2d[key]) byCohort2d[key] = {};
      byCohort2d[key][`${wc}|${hc}`] = divisionId;
      templates2d[key] = leaf;
    } else if (isSmtUnresolvedPlaceholder(leaf)) {
      const key = smtCohortKey(leaf);
      if (!byCohortH[key]) byCohortH[key] = {};
      byCohortH[key][hc] = divisionId;
      templatesH[key] = leaf;
    }
  });

  Object.keys(byCohort2d).forEach((key) => {
    const classToDivId = byCohort2d[key];
    const expected = PATTERN_WEIGHT_CLASSES.length * PATTERN_HEIGHT_CLASSES.length;
    if (Object.keys(classToDivId).length !== expected) return;
    const template = templates2d[key];
    const pool = lmhPoolForCohort(template, athletes, refDate);
    const weightBuckets = lmhSplitPool(pool);
    PATTERN_WEIGHT_CLASSES.forEach((wc) => {
      const heightBuckets = smtSplitPool(weightBuckets[wc] || []);
      PATTERN_HEIGHT_CLASSES.forEach((hc) => {
        const divisionId = classToDivId[`${wc}|${hc}`];
        if (!divisionId) return;
        const bucket = heightBuckets[hc] || [];
        assignments[divisionId] = new Set(bucket.map((a) => a._index));
        const leaf = leaves.find((l) => (l._groupings_id || safeDivisionBasename(l.division_name)) === divisionId);
        if (!leaf) return;
        leaf.manual_include_indices = bucket.map((a) => a._index).sort((a, b) => a - b);
        leaf.id_only_membership = true;
        const heights = bucket.map((a) => Number(a.height_cm)).filter((h) => !Number.isNaN(h));
        leaf.height_min = heights.length ? Math.min(...heights) : null;
        leaf.height_max = heights.length ? Math.max(...heights) : null;
      });
    });
  });

  Object.keys(byCohortH).forEach((key) => {
    const classToDivId = byCohortH[key];
    if (Object.keys(classToDivId).length !== PATTERN_HEIGHT_CLASSES.length) return;
    const template = templatesH[key];
    const pool = filterAthletesForLeaf(athletes, template, { refDate });
    const buckets = smtSplitPool(pool);
    PATTERN_HEIGHT_CLASSES.forEach((hc) => {
      const divisionId = classToDivId[hc];
      if (!divisionId) return;
      const bucket = buckets[hc] || [];
      assignments[divisionId] = new Set(bucket.map((a) => a._index));
      const leaf = leaves.find((l) => (l._groupings_id || safeDivisionBasename(l.division_name)) === divisionId);
      if (!leaf) return;
      leaf.manual_include_indices = bucket.map((a) => a._index).sort((a, b) => a - b);
      leaf.id_only_membership = true;
      const heights = bucket.map((a) => Number(a.height_cm)).filter((h) => !Number.isNaN(h));
      leaf.height_min = heights.length ? Math.min(...heights) : null;
      leaf.height_max = heights.length ? Math.max(...heights) : null;
    });
  });
}

function computeCatalog(leaves, assignments, athletes, refDate) {
  const catalog = [];
  const catalogLeaves = [];
  const seenIds = new Set();
  const enabledLeaves = leaves.filter((l) => l.enabled !== false);

  enabledLeaves.forEach((leaf, idx) => {
    const rawName = String(leaf.division_name || '').trim();
    const oldId = safeDivisionBasename(rawName);
    const [divisionId, divisionName] = assignDivisionId(leaf, seenIds, idx);

    if (oldId && oldId !== divisionId && assignments[oldId]) {
      const merged = assignments[oldId];
      delete assignments[oldId];
      if (!assignments[divisionId]) assignments[divisionId] = new Set();
      merged.forEach((i) => assignments[divisionId].add(i));
    }

    if (!assignments[divisionId] || !leaf.id_only_membership) {
      assignments[divisionId] = seedAssignmentsForLeaf(leaf, athletes, refDate);
    }

    const indices = assignments[divisionId] || new Set();
    const preferred = leafEffectiveDrawType(leaf);
    const divisionType = effectiveDrawType(preferred, indices.size);
    leaf.draw_type_auto_rr = preferred === 'Premier League' && divisionType === 'Round Robin' && !leaf.draw_type_user_override;

    catalog.push({
      id: divisionId,
      division_name: divisionName,
      division_type: divisionType,
      event_key: String(leaf.event_key || '').trim(),
      athlete_count: indices.size,
      athlete_indices: [...indices].sort((a, b) => a - b)
    });
    catalogLeaves.push(leaf);
  });

  applyLmhAssignments(leaves, athletes, assignments, refDate);
  applySmtAssignments(leaves, athletes, assignments, refDate);

  catalog.forEach((entry, i) => {
    const leaf = catalogLeaves[i];
    const divisionId = entry.id;
    const indices = assignments[divisionId] || new Set();
    entry.athlete_count = indices.size;
    entry.athlete_indices = [...indices].sort((a, b) => a - b);
    const preferred = leafEffectiveDrawType(leaf);
    entry.division_type = effectiveDrawType(preferred, indices.size);
    leaf.draw_type_auto_rr = preferred === 'Premier League' && entry.division_type === 'Round Robin' && !leaf.draw_type_user_override;
  });

  return catalog;
}

function buildGroupingsState(leaves, athletes, assignments, refDate) {
  const leavesCopy = JSON.parse(JSON.stringify(leaves));
  const assignmentsCopy = {};
  Object.keys(assignments || {}).forEach((k) => {
    assignmentsCopy[k] = new Set(assignments[k]);
  });

  const catalog = computeCatalog(leavesCopy, assignmentsCopy, athletes, refDate);

  const catalogWithAthletes = catalog.map((entry) => {
    const matched = athletesByIndices(athletes, entry.athlete_indices);
    return {
      ...entry,
      athletes: matched.map((a) => athleteSnapshot(a, refDate))
    };
  });

  return {
    format_version: GROUPINGS_FORMAT_VERSION,
    catalog: catalogWithAthletes,
    leaves: leavesCopy,
    assignments: Object.fromEntries(
      Object.entries(assignmentsCopy).map(([k, v]) => [k, [...v]])
    ),
    signature: stateSignature({ catalog: catalogWithAthletes })
  };
}

function generateGroupings(leaves, athletes, refDate) {
  const assignments = {};
  const cleanLeaves = JSON.parse(JSON.stringify(leaves));
  cleanLeaves.forEach((leaf) => {
    delete leaf.manual_include_indices;
    delete leaf.id_only_membership;
    delete leaf._groupings_id;
  });
  return buildGroupingsState(cleanLeaves, athletes, assignments, refDate);
}

function moveAthlete(state, fromDivisionId, toDivisionId, athleteIndex) {
  const assignments = {};
  Object.entries(state.assignments || {}).forEach(([k, v]) => {
    assignments[k] = new Set(v);
  });
  if (assignments[fromDivisionId]) {
    assignments[fromDivisionId].delete(athleteIndex);
  }
  if (!assignments[toDivisionId]) assignments[toDivisionId] = new Set();
  assignments[toDivisionId].add(athleteIndex);

  const athletes = (state.catalog || []).flatMap((e) => e.athletes || []);
  const athleteMap = new Map();
  athletes.forEach((a) => athleteMap.set(a.index, a));

  const allAthletes = [...athleteMap.values()].map((snap) => ({
    _index: snap.index,
    first_name: snap.first_name || snap.name?.split(' ')[0] || '',
    last_name: snap.last_name || snap.name?.split(' ').slice(1).join(' ') || '',
    dob: snap.dob,
    rank: snap.rank,
    gender: snap.gender,
    weight_kg: snap.weight_kg,
    height_cm: snap.height_cm,
    team_name_or_country: snap.club || snap.team || '',
    [state.leaves?.[0]?.event_key || 'individual_patterns']: 1
  }));

  return buildGroupingsState(state.leaves || [], allAthletes, assignments, null);
}

function hydrateAthletesFromGroupingsState(state) {
  const seen = new Map();
  (state.catalog || []).forEach((entry) => {
    (entry.athletes || []).forEach((snap) => {
      if (!seen.has(snap.index)) {
        seen.set(snap.index, {
          _index: snap.index,
          first_name: snap.first_name || String(snap.name || '').split(' ')[0] || '',
          last_name: snap.last_name || String(snap.name || '').split(' ').slice(1).join(' ') || '',
          dob: snap.dob,
          rank: snap.rank,
          gender: snap.gender,
          weight_kg: snap.weight_kg,
          height_cm: snap.height_cm,
          team_name_or_country: snap.club || snap.team || '',
          team_name_or_country_dirty: snap.club || snap.team || ''
        });
      }
    });
  });
  return [...seen.values()].sort((a, b) => a._index - b._index);
}

module.exports = {
  computeCatalog,
  buildGroupingsState,
  generateGroupings,
  moveAthlete,
  hydrateAthletesFromGroupingsState
};
