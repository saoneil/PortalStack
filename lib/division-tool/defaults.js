const {
  EVENT_COLUMNS,
  RANK_ORDER,
  LIST_DRAW_TYPE_EVENT_KEYS,
  PATTERN_WEIGHT_CLASSES,
  PATTERN_HEIGHT_CLASSES
} = require('./constants');
const {
  drawTypeForEvent,
  divisionTitleFromSpec,
  patternEventSkipsWeight,
  patternEventUsesHeight,
  normalizeWeightClass,
  normalizeHeightClass,
  rankIndex
} = require('./utils');

/** Python create-all uses one open height band (0/0), not SMT. */
const OPEN_HEIGHT_VARIANT = { hMin: null, hMax: null, heightClass: '', heightIdOnly: false };

const EXPECTED_DEFAULT_DIVISION_COUNT = 466;

function defaultAgeBands(eventKey, belt) {
  const ek = String(eventKey || '').trim();
  const b = String(belt || '').trim().toLowerCase();
  if (ek === 'team_patterns') return [[0, 0]];
  if (ek === 'team_sparring') return [[15, 17.999], [18, null]];
  if (ek === 'pre_arranged_sparring') {
    return [[10, 11.999], [12, 14.999], [15, 17.999], [18, null]];
  }
  if (b === 'black') {
    return [[12, 14.999], [15, 17.999], [18, 35.999], [36, 45.999], [46, null]];
  }
  if (b === 'color') {
    return [[5, 6.999], [7, 9.999], [10, 11.999], [12, 14.999], [15, 17.999], [18, 34.999], [35, null]];
  }
  return [[null, null]];
}

function defaultRankBands(eventKey, belt) {
  const ek = String(eventKey || '').trim();
  const b = String(belt || '').trim().toLowerCase();
  const allGup = () => [['10th gup', '1st gup']];
  const allDan = () => [['1st dan', '6th dan']];

  if (['team_patterns', 'team_sparring', 'pre_arranged_sparring'].includes(ek)) {
    if (b === 'color') return allGup();
    if (b === 'black') return allDan();
    return [];
  }
  if (b === 'black') {
    if (['individual_sparring', 'individual_special_technique', 'individual_power_test',
      'team_special_technique', 'team_power_test'].includes(ek)) {
      return [['1st dan', '6th dan']];
    }
    return [['1st dan', '1st dan'], ['2nd dan', '2nd dan'], ['3rd dan', '3rd dan'], ['4th dan', '6th dan']];
  }
  if (b === 'color') {
    return [['10th gup', '8th gup'], ['7th gup', '5th gup'], ['4th gup', '1st gup']];
  }
  return [];
}

function defaultGenders(eventKey) {
  const ek = String(eventKey || '').trim();
  if (ek === 'pre_arranged_sparring') return { male: false, female: false };
  return { male: true, female: true };
}

function defaultDrawType(eventKey) {
  const ek = String(eventKey || '').trim();
  return LIST_DRAW_TYPE_EVENT_KEYS.has(ek) ? 'List' : 'Premier League';
}

function parseAgeSpec([min, max]) {
  const lo = min === '' || min === undefined ? null : Number(min);
  const hi = max === '' || max === undefined ? null : Number(max);
  if ((lo === null || lo === 0) && (hi === null || hi === 0)) return [null, null];
  if (lo !== null && !Number.isNaN(lo) && (hi === 0 || hi === null) && lo > 0) return [lo, null];
  return [Number.isNaN(lo) ? null : lo, Number.isNaN(hi) ? null : hi];
}

function parseWeightSpec([min, max]) {
  const lo = min === '' || min === undefined ? null : Number(min);
  const hi = max === '' || max === undefined ? null : Number(max);
  if ((lo === null || lo === 0) && (hi === null || hi === 0)) return [null, null];
  return [Number.isNaN(lo) ? null : lo, Number.isNaN(hi) ? null : hi];
}

function heightVariantsFromForm(eventKey, heightForm = {}) {
  const ek = String(eventKey || '').trim();
  const mode = String(heightForm.mode || 'none').trim();
  const enabled = heightForm.enabled !== false;

  if (!patternEventUsesHeight(ek)) {
    return [OPEN_HEIGHT_VARIANT];
  }
  if (ek === 'individual_sparring' && !enabled) {
    return [OPEN_HEIGHT_VARIANT];
  }
  if (mode === 'short_medium_tall') {
    const classes = (heightForm.classes || []).filter((c) => PATTERN_HEIGHT_CLASSES.includes(c));
    if (!classes.length) return null;
    return classes.map((hc) => ({ hMin: null, hMax: null, heightClass: hc, heightIdOnly: true }));
  }
  if (mode === 'fixed_cm' || patternEventUsesHeight(ek)) {
    const specs = (heightForm.specs || [[0, 0]]).map(parseWeightSpec);
    if (!specs.length) return [OPEN_HEIGHT_VARIANT];
    return specs.map(([hMin, hMax]) => ({ hMin, hMax, heightClass: '', heightIdOnly: false }));
  }
  return [OPEN_HEIGHT_VARIANT];
}

function patternConfigForEventBelt(eventKey, belt) {
  const ek = String(eventKey || '').trim();
  const drawType = drawTypeForEvent(ek, defaultDrawType(ek));
  const useLmh = ek === 'individual_sparring';
  const genders = defaultGenders(ek);
  const genderList = [];
  if (genders.male) genderList.push('M');
  if (genders.female) genderList.push('F');

  return {
    eventKey: ek,
    belt,
    drawType,
    ageSpecs: defaultAgeBands(ek, belt),
    rankSpecs: defaultRankBands(ek, belt),
    genders: genderList,
    useLmh,
    weightClasses: useLmh ? [...PATTERN_WEIGHT_CLASSES] : [],
    maleWeightSpecs: [[null, null]],
    femaleWeightSpecs: [[null, null]],
    heightVariants: [OPEN_HEIGHT_VARIANT]
  };
}

function getPatternFormDefaults(eventKey, belt) {
  const ek = String(eventKey || '').trim();
  const b = String(belt || 'color').trim().toLowerCase();
  const genders = defaultGenders(ek);
  const usesHeight = patternEventUsesHeight(ek);
  const skipsWeight = patternEventSkipsWeight(ek);
  const isSparring = ek === 'individual_sparring';

  return {
    eventKey: ek,
    belt: b,
    drawType: defaultDrawType(ek),
    genders,
    ageSpecs: defaultAgeBands(ek, b),
    rankSpecs: defaultRankBands(ek, b),
    weight: {
      mode: isSparring && !skipsWeight ? 'light_middle_heavy' : 'none',
      classes: isSparring ? [...PATTERN_WEIGHT_CLASSES] : [],
      maleSpecs: [[0, 0]],
      femaleSpecs: [[0, 0]]
    },
    height: {
      enabled: usesHeight && !isSparring,
      mode: usesHeight ? 'fixed_cm' : 'none',
      specs: [[0, 0]],
      classes: [...PATTERN_HEIGHT_CLASSES]
    },
    usesWeight: !skipsWeight,
    usesHeight,
    isSparring
  };
}

function validateRankSpecs(rankSpecs, belt) {
  const b = String(belt || '').trim().toLowerCase();
  if (!rankSpecs.length) {
    return 'Add at least one rank band.';
  }
  for (const [rankMin, rankMax] of rankSpecs) {
    const rLo = String(rankMin || '').trim();
    const rHi = String(rankMax || '').trim();
    const iLo = rankIndex(rLo);
    const iHi = rankIndex(rHi);
    if (iLo < 0 || iHi < 0) {
      return `Invalid rank selection: ${rLo} / ${rHi}`;
    }
    if (iLo > iHi) {
      return `Rank min must be ≤ max (${rLo} vs ${rHi}).`;
    }
    if (b === 'color' && (rLo.toLowerCase().includes('dan') || rHi.toLowerCase().includes('dan'))) {
      return 'Color belt pattern cannot include dan ranks.';
    }
    if (b === 'black' && (rLo.toLowerCase().includes('gup') || rHi.toLowerCase().includes('gup'))) {
      return 'Black belt pattern cannot include gup ranks.';
    }
  }
  return null;
}

function buildPatternConfigFromForm(payload = {}) {
  const eventKey = String(payload.eventKey || '').trim();
  const belt = String(payload.belt || 'color').trim().toLowerCase();
  if (!EVENT_COLUMNS.includes(eventKey)) {
    throw new Error('Choose a valid event for generated leaves.');
  }

  const ageSpecs = (payload.ageSpecs || []).map(parseAgeSpec);
  if (!ageSpecs.length) {
    throw new Error('Add at least one age band.');
  }

  const rankSpecs = (payload.rankSpecs || []).map(([a, b]) => [String(a || '').trim(), String(b || '').trim()]);
  const rankErr = validateRankSpecs(rankSpecs, belt);
  if (rankErr) throw new Error(rankErr);

  const genders = (payload.genders || []).map((g) => String(g).toUpperCase()).filter((g) => g === 'M' || g === 'F');

  const drawType = drawTypeForEvent(eventKey, payload.drawType || defaultDrawType(eventKey));
  const weightForm = payload.weight || {};
  const isSparring = eventKey === 'individual_sparring';
  const useLmh = isSparring && String(weightForm.mode || '').trim() === 'light_middle_heavy';
  const weightClasses = useLmh
    ? (weightForm.classes || []).filter((c) => PATTERN_WEIGHT_CLASSES.includes(String(c).toLowerCase()))
    : [];

  if (useLmh && !weightClasses.length) {
    throw new Error('Select at least one weight class (Light, Middle, or Heavy).');
  }

  const heightVariants = heightVariantsFromForm(eventKey, payload.height || {});
  if (!heightVariants) {
    throw new Error('Select at least one height class (Short, Medium, or Tall).');
  }

  const maleWeightSpecs = (weightForm.maleSpecs || [[0, 0]]).map(parseWeightSpec);
  const femaleWeightSpecs = (weightForm.femaleSpecs || [[0, 0]]).map(parseWeightSpec);

  return {
    eventKey,
    belt,
    drawType,
    ageSpecs,
    rankSpecs,
    genders,
    useLmh,
    weightClasses,
    maleWeightSpecs,
    femaleWeightSpecs,
    heightVariants
  };
}

function weightSpecsForGender(config, gender) {
  if (config.useLmh) {
    return config.weightClasses.map((wc) => ({ wMin: null, wMax: null, weightClass: wc, weightIdOnly: true }));
  }
  if (patternEventSkipsWeight(config.eventKey)) {
    return [{ wMin: null, wMax: null, weightClass: '', weightIdOnly: false }];
  }
  if (gender === 'M') {
    return config.maleWeightSpecs.map(([wMin, wMax]) => ({ wMin, wMax, weightClass: '', weightIdOnly: false }));
  }
  if (gender === 'F') {
    return config.femaleWeightSpecs.map(([wMin, wMax]) => ({ wMin, wMax, weightClass: '', weightIdOnly: false }));
  }
  const seen = new Set();
  const merged = [];
  [...config.maleWeightSpecs, ...config.femaleWeightSpecs].forEach(([wMin, wMax]) => {
    const key = `${wMin}|${wMax}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ wMin, wMax, weightClass: '', weightIdOnly: false });
    }
  });
  return merged;
}

function generateLeavesFromPattern(config) {
  const leaves = [];
  const genders = config.genders.length ? config.genders : ['MIXED'];

  for (const [ageMin, ageMax] of config.ageSpecs) {
    for (const gender of genders) {
      const weightVariants = weightSpecsForGender(config, gender);
      for (const [rankMin, rankMax] of config.rankSpecs) {
        for (const hv of config.heightVariants) {
          for (const wv of weightVariants) {
            const leaf = {
              enabled: true,
              event_key: config.eventKey,
              draw_type: config.drawType,
              gender,
              age_min: ageMin,
              age_max: ageMax,
              rank_min: rankMin,
              rank_max: rankMax,
              weight_min: wv.wMin,
              weight_max: wv.wMax,
              weight_class: wv.weightClass,
              height_min: hv.hMin,
              height_max: hv.hMax,
              height_class: hv.heightClass,
              division_name: '',
              manual_include_indices: [],
              id_only_membership: Boolean(wv.weightIdOnly || hv.heightIdOnly)
            };
            leaf.division_name = divisionTitleFromSpec(leaf);
            leaves.push(leaf);
          }
        }
      }
    }
  }
  return leaves;
}

function createAllDefaultDivisions() {
  const leaves = [];
  const failures = [];
  for (const eventKey of EVENT_COLUMNS) {
    for (const belt of ['color', 'black']) {
      const config = patternConfigForEventBelt(eventKey, belt);
      if (!config.rankSpecs.length) {
        failures.push(`${eventKey} (${belt})`);
        continue;
      }
      try {
        const generated = generateLeavesFromPattern(config);
        leaves.push(...generated);
      } catch (err) {
        failures.push(`${eventKey} (${belt})`);
      }
    }
  }
  return { leaves, failures, count: leaves.length };
}

function assertDefaultDivisionCount() {
  const { count, failures } = createAllDefaultDivisions();
  if (count !== EXPECTED_DEFAULT_DIVISION_COUNT || failures.length) {
    throw new Error(`Expected ${EXPECTED_DEFAULT_DIVISION_COUNT} default divisions, got ${count}; failures: ${failures.join(', ')}`);
  }
  return count;
}

function leavesForDbJson(leaves) {
  return (leaves || []).map((leaf) => ({
    enabled: Boolean(leaf.enabled !== false),
    draw_type: String(leaf.draw_type || 'Premier League'),
    event_key: String(leaf.event_key || ''),
    gender: String(leaf.gender || 'MIXED').toUpperCase(),
    age_min: leaf.age_min ?? null,
    age_max: leaf.age_max ?? null,
    rank_min: String(leaf.rank_min || ''),
    rank_max: String(leaf.rank_max || ''),
    weight_min: leaf.weight_min ?? null,
    weight_max: leaf.weight_max ?? null,
    weight_class: normalizeWeightClass(leaf.weight_class),
    height_min: leaf.height_min ?? null,
    height_max: leaf.height_max ?? null,
    height_class: normalizeHeightClass(leaf.height_class),
    division_name: String(leaf.division_name || ''),
    id_only_membership: Boolean(leaf.id_only_membership),
    manual_include_indices: (leaf.manual_include_indices || []).map(Number)
  }));
}

function leavesFromDbJson(payload) {
  const raw = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!Array.isArray(raw)) throw new Error('Template leaves_json must be a JSON array.');
  return raw.map((leaf) => ({
    enabled: leaf.enabled !== false,
    draw_type: leaf.draw_type || 'Premier League',
    event_key: leaf.event_key || '',
    gender: leaf.gender || 'MIXED',
    age_min: leaf.age_min ?? null,
    age_max: leaf.age_max ?? null,
    rank_min: leaf.rank_min || '',
    rank_max: leaf.rank_max || '',
    weight_min: leaf.weight_min ?? null,
    weight_max: leaf.weight_max ?? null,
    weight_class: leaf.weight_class || '',
    height_min: leaf.height_min ?? null,
    height_max: leaf.height_max ?? null,
    height_class: leaf.height_class || '',
    division_name: leaf.division_name || '',
    manual_include_indices: leaf.manual_include_indices || [],
    id_only_membership: Boolean(leaf.id_only_membership)
  }));
}

module.exports = {
  EXPECTED_DEFAULT_DIVISION_COUNT,
  patternConfigForEventBelt,
  buildPatternConfigFromForm,
  getPatternFormDefaults,
  generateLeavesFromPattern,
  createAllDefaultDivisions,
  assertDefaultDivisionCount,
  leavesForDbJson,
  leavesFromDbJson,
  defaultAgeBands,
  defaultRankBands,
  defaultGenders,
  defaultDrawType
};
