import { apiFetch } from './api.js';

let patternMeta = null;

function ranksForBelt(belt) {
  const b = String(belt || 'color').toLowerCase();
  if (!patternMeta?.rankOrder) return [];
  if (b === 'color') return patternMeta.rankOrder.filter((r) => r.includes('gup'));
  return patternMeta.rankOrder.filter((r) => r.includes('dan'));
}

function formatAgeValue(val) {
  if (val === null || val === undefined) return '';
  return String(val);
}

function ageRowHtml(min = '', max = '') {
  return `
    <div class="da-pattern-band-row">
      <input type="number" step="0.001" class="da-input da-input-sm pattern-age-min" value="${formatAgeValue(min)}" title="Age min" aria-label="Age min" placeholder="min">
      <span class="da-band-sep">–</span>
      <input type="number" step="0.001" class="da-input da-input-sm pattern-age-max" value="${formatAgeValue(max)}" title="Age max" aria-label="Age max" placeholder="max">
    </div>
  `;
}

function rankRowHtml(rankMin = '', rankMax = '', belt = 'color') {
  const options = ranksForBelt(belt).map((r) => `<option value="${r}">${r}</option>`).join('');
  return `
    <div class="da-pattern-band-row">
      <select class="da-select da-select-sm pattern-rank-min" title="Rank min" aria-label="Rank min">${options}</select>
      <span class="da-band-sep">–</span>
      <select class="da-select da-select-sm pattern-rank-max" title="Rank max" aria-label="Rank max">${options}</select>
    </div>
  `;
}

function weightRowHtml(min = 0, max = 0) {
  return `
    <div class="da-pattern-band-row">
      <input type="number" step="0.1" class="da-input da-input-sm pattern-weight-min" value="${formatAgeValue(min)}" title="Weight min" aria-label="Weight min" placeholder="min">
      <span class="da-band-sep">–</span>
      <input type="number" step="0.1" class="da-input da-input-sm pattern-weight-max" value="${formatAgeValue(max)}" title="Weight max" aria-label="Weight max" placeholder="max">
    </div>
  `;
}

function heightRowHtml(min = 0, max = 0) {
  return `
    <div class="da-pattern-band-row">
      <input type="number" step="0.1" class="da-input da-input-sm pattern-height-min" value="${formatAgeValue(min)}" title="Height min" aria-label="Height min" placeholder="min">
      <span class="da-band-sep">–</span>
      <input type="number" step="0.1" class="da-input da-input-sm pattern-height-max" value="${formatAgeValue(max)}" title="Height max cm" aria-label="Height max" placeholder="max">
    </div>
  `;
}

function getSelectedBelt() {
  const checked = document.querySelector('input[name="patternBelt"]:checked');
  return checked ? checked.value : 'color';
}

function getSelectedEvent() {
  return document.getElementById('patternEvent')?.value || patternMeta?.eventColumns?.[0] || '';
}

function setSelectValue(select, value) {
  if (!select) return;
  const v = String(value || '');
  if ([...select.options].some((o) => o.value === v)) {
    select.value = v;
  }
}

function renderAgeRows(specs = [[0, 0]]) {
  const host = document.getElementById('patternAgeRows');
  if (!host) return;
  host.innerHTML = specs.map(([min, max]) => ageRowHtml(min, max)).join('');
}

function renderRankRows(specs = [['10th gup', '1st gup']], belt = 'color') {
  const host = document.getElementById('patternRankRows');
  if (!host) return;
  host.innerHTML = specs.map(([min, max]) => rankRowHtml(min, max, belt)).join('');
  host.querySelectorAll('.da-pattern-band-row').forEach((row, i) => {
    const [min, max] = specs[i] || [];
    setSelectValue(row.querySelector('.pattern-rank-min'), min);
    setSelectValue(row.querySelector('.pattern-rank-max'), max);
  });
}

function renderWeightRows(gender, specs = [[0, 0]]) {
  const host = document.getElementById(gender === 'female' ? 'patternFemaleWeightRows' : 'patternMaleWeightRows');
  if (!host) return;
  host.innerHTML = specs.map(([min, max]) => weightRowHtml(min, max)).join('');
}

function renderHeightRows(specs = [[0, 0]]) {
  const host = document.getElementById('patternHeightRows');
  if (!host) return;
  const rows = (specs && specs.length) ? specs : [[0, 0]];
  host.innerHTML = rows.map(([min, max]) => heightRowHtml(min, max)).join('');
}

function setHeightMode(mode) {
  const radio = document.querySelector(`input[name="patternHeightMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
}

function setWeightMode(mode) {
  const radio = document.querySelector(`input[name="patternWeightMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
}

function ensureDefaultFixedKgBands() {
  renderWeightRows('male', [[0, 0]]);
  renderWeightRows('female', [[0, 0]]);
}

function ensureDefaultFixedCmBands() {
  renderHeightRows([[0, 0]]);
}

function ensureDefaultSmtClasses() {
  ['patternSmtShort', 'patternSmtMedium', 'patternSmtTall'].forEach((id) => {
    const cb = document.getElementById(id);
    if (cb) cb.checked = true;
  });
}

function currentVisibilityDefaults() {
  const eventKey = getSelectedEvent();
  const isSparring = eventKey === 'individual_sparring';
  const skips = patternMeta?.patternEventSkipsWeight || [];
  const heightEvents = patternMeta?.patternEventUsesHeight || [
    'individual_special_technique', 'team_special_technique', 'individual_sparring'
  ];
  return {
    usesWeight: !skips.includes(eventKey),
    usesHeight: heightEvents.includes(eventKey),
    isSparring
  };
}

function getCheckedHeightMode() {
  return document.querySelector('input[name="patternHeightMode"]:checked')?.value || 'none';
}

function getCheckedWeightMode() {
  return document.querySelector('input[name="patternWeightMode"]:checked')?.value || 'light_middle_heavy';
}

/** Height is on when a real mode (fixed cm / S/M/T) is selected — no separate checkbox. */
function isHeightEnabled(defaults, heightMode = getCheckedHeightMode()) {
  if (!defaults?.usesHeight) return false;
  return heightMode === 'fixed_cm' || heightMode === 'short_medium_tall';
}

/** Keep weight/height panels + default bands in sync with current selection. */
function syncWeightHeightUi(defaults = currentVisibilityDefaults()) {
  const weightSection = document.getElementById('patternWeightSection');
  const heightSection = document.getElementById('patternHeightSection');
  const weightModeRow = document.getElementById('patternWeightModeRow');
  const lmhBlock = document.getElementById('patternLmhBlock');
  const fixedKgBlock = document.getElementById('patternFixedKgBlock');
  const heightNoneLabel = document.getElementById('patternHeightNoneLabel');
  const heightModeBlock = document.getElementById('patternHeightModeBlock');
  const heightFixedBlock = document.getElementById('patternHeightFixedBlock');
  const heightSmtBlock = document.getElementById('patternHeightSmtBlock');
  const heightActions = document.querySelector('#patternHeightSection .da-pattern-section-actions');

  const usesWeight = Boolean(defaults.usesWeight);
  const usesHeight = Boolean(defaults.usesHeight);
  const isSparring = Boolean(defaults.isSparring);
  const weightMode = getCheckedWeightMode();
  const useLmh = weightMode === 'light_middle_heavy';

  if (weightSection) weightSection.hidden = !usesWeight;
  if (weightModeRow) weightModeRow.hidden = !usesWeight || !isSparring;
  if (lmhBlock) lmhBlock.hidden = !(usesWeight && useLmh);
  if (fixedKgBlock) fixedKgBlock.hidden = !(usesWeight && !useLmh);

  if (usesWeight && !useLmh) {
    const maleRows = document.querySelectorAll('#patternMaleWeightRows .da-pattern-band-row');
    const femaleRows = document.querySelectorAll('#patternFemaleWeightRows .da-pattern-band-row');
    if (!maleRows.length || !femaleRows.length) ensureDefaultFixedKgBands();
  }

  if (heightSection) heightSection.hidden = !usesHeight;
  if (heightNoneLabel) heightNoneLabel.hidden = !isSparring;
  if (heightModeBlock) heightModeBlock.hidden = !usesHeight;

  // Sparring default is "none" (height off). Non-sparring has no "none" option.
  let heightMode = getCheckedHeightMode();
  if (!isSparring && heightMode === 'none') {
    setHeightMode('fixed_cm');
    heightMode = 'fixed_cm';
  }

  const heightOn = isHeightEnabled(defaults, heightMode);
  const showFixed = heightOn && heightMode === 'fixed_cm';
  const showSmt = heightOn && heightMode === 'short_medium_tall';

  if (heightFixedBlock) heightFixedBlock.hidden = !showFixed;
  if (heightSmtBlock) heightSmtBlock.hidden = !showSmt;
  if (heightActions) heightActions.hidden = !showFixed;

  if (showFixed) {
    const rows = document.querySelectorAll('#patternHeightRows .da-pattern-band-row');
    if (!rows.length) ensureDefaultFixedCmBands();
  }
  if (showSmt) {
    ensureDefaultSmtClasses();
  }
}

function applyHeightModeSelection(mode) {
  setHeightMode(mode);
  if (mode === 'fixed_cm') {
    ensureDefaultFixedCmBands();
  } else if (mode === 'short_medium_tall') {
    ensureDefaultSmtClasses();
  }
  syncWeightHeightUi();
}

function applyWeightModeSelection(mode) {
  setWeightMode(mode);
  if (mode === 'fixed_kg') {
    ensureDefaultFixedKgBands();
  }
  syncWeightHeightUi();
}

function populateEventSelect() {
  const select = document.getElementById('patternEvent');
  if (!select || !patternMeta) return;
  select.innerHTML = patternMeta.eventColumns.map((key) => {
    const label = patternMeta.eventDisplayNames?.[key] || key;
    return `<option value="${key}">${label}</option>`;
  }).join('');
}

function populateDrawTypeSelect(drawType) {
  const select = document.getElementById('patternDrawType');
  if (!select || !patternMeta) return;
  select.innerHTML = patternMeta.drawTypeOptions.map((opt) => `<option value="${opt}">${opt}</option>`).join('');
  if (drawType) select.value = drawType;
}

export function getPatternMeta() {
  return patternMeta;
}

export async function initPatternForm() {
  patternMeta = await apiFetch('/api/division-advanced/meta');
  populateEventSelect();
  populateDrawTypeSelect();
  await applyPatternDefaults();
}

export async function applyPatternDefaults() {
  const eventKey = getSelectedEvent();
  const belt = getSelectedBelt();
  const defaults = await apiFetch(
    `/api/division-advanced/divisions/pattern-defaults?eventKey=${encodeURIComponent(eventKey)}&belt=${encodeURIComponent(belt)}`
  );

  populateDrawTypeSelect(defaults.drawType);

  const maleCb = document.getElementById('patternGenderMale');
  const femaleCb = document.getElementById('patternGenderFemale');
  if (maleCb) maleCb.checked = Boolean(defaults.genders?.male);
  if (femaleCb) femaleCb.checked = Boolean(defaults.genders?.female);

  renderAgeRows(defaults.ageSpecs);
  renderRankRows(defaults.rankSpecs, belt);

  const weightMode = defaults.weight?.mode === 'light_middle_heavy' ? 'light_middle_heavy' : 'fixed_kg';
  const weightModeInput = document.querySelector(`input[name="patternWeightMode"][value="${weightMode}"]`);
  if (weightModeInput) weightModeInput.checked = true;

  ['light', 'middle', 'heavy'].forEach((wc) => {
    const cb = document.getElementById(`patternLmh${wc.charAt(0).toUpperCase()}${wc.slice(1)}`);
    if (cb) cb.checked = (defaults.weight?.classes || []).includes(wc);
  });

  renderWeightRows('male', defaults.weight?.maleSpecs || [[0, 0]]);
  renderWeightRows('female', defaults.weight?.femaleSpecs || [[0, 0]]);

  // ST: fixed cm on by default. Sparring: none (height off) until fixed cm / S/M/T chosen.
  if (defaults.usesHeight && defaults.isSparring) {
    setHeightMode('none');
    ensureDefaultFixedCmBands();
    ensureDefaultSmtClasses();
  } else if (defaults.usesHeight) {
    setHeightMode('fixed_cm');
    ensureDefaultFixedCmBands();
    ensureDefaultSmtClasses();
  } else {
    setHeightMode('none');
  }

  syncWeightHeightUi(defaults);
}

function collectAgeSpecs() {
  return [...document.querySelectorAll('#patternAgeRows .da-pattern-band-row')].map((row) => {
    const min = row.querySelector('.pattern-age-min')?.value;
    const max = row.querySelector('.pattern-age-max')?.value;
    return [min === '' ? null : Number(min), max === '' ? null : Number(max)];
  });
}

function collectRankSpecs() {
  return [...document.querySelectorAll('#patternRankRows .da-pattern-band-row')].map((row) => [
    row.querySelector('.pattern-rank-min')?.value || '',
    row.querySelector('.pattern-rank-max')?.value || ''
  ]);
}

function collectWeightSpecs(gender) {
  const hostId = gender === 'female' ? 'patternFemaleWeightRows' : 'patternMaleWeightRows';
  return [...document.querySelectorAll(`#${hostId} .da-pattern-band-row`)].map((row) => {
    const min = row.querySelector('.pattern-weight-min')?.value;
    const max = row.querySelector('.pattern-weight-max')?.value;
    return [min === '' ? null : Number(min), max === '' ? null : Number(max)];
  });
}

function collectHeightSpecs() {
  return [...document.querySelectorAll('#patternHeightRows .da-pattern-band-row')].map((row) => {
    const min = row.querySelector('.pattern-height-min')?.value;
    const max = row.querySelector('.pattern-height-max')?.value;
    return [min === '' ? null : Number(min), max === '' ? null : Number(max)];
  });
}

export function collectPatternFormPayload() {
  const eventKey = getSelectedEvent();
  const belt = getSelectedBelt();
  const drawType = document.getElementById('patternDrawType')?.value || 'Premier League';
  const genders = [];
  if (document.getElementById('patternGenderMale')?.checked) genders.push('M');
  if (document.getElementById('patternGenderFemale')?.checked) genders.push('F');

  const weightMode = document.querySelector('input[name="patternWeightMode"]:checked')?.value || 'none';
  const weightClasses = ['light', 'middle', 'heavy'].filter((wc) => {
    const id = `patternLmh${wc.charAt(0).toUpperCase()}${wc.slice(1)}`;
    return document.getElementById(id)?.checked;
  });

  const heightMode = document.querySelector('input[name="patternHeightMode"]:checked')?.value || 'none';
  const heightClasses = ['short', 'medium', 'tall'].filter((hc) => {
    const id = `patternSmt${hc.charAt(0).toUpperCase()}${hc.slice(1)}`;
    return document.getElementById(id)?.checked;
  });

  const heightEnabled = heightMode === 'fixed_cm' || heightMode === 'short_medium_tall';

  return {
    eventKey,
    belt,
    drawType,
    genders,
    ageSpecs: collectAgeSpecs(),
    rankSpecs: collectRankSpecs(),
    weight: {
      mode: weightMode,
      classes: weightClasses,
      maleSpecs: collectWeightSpecs('male'),
      femaleSpecs: collectWeightSpecs('female')
    },
    height: {
      enabled: heightEnabled,
      mode: heightEnabled ? heightMode : 'none',
      specs: collectHeightSpecs(),
      classes: heightClasses
    }
  };
}

export function bindPatternForm() {
  document.getElementById('patternEvent')?.addEventListener('change', () => {
    applyPatternDefaults().catch(() => {});
  });

  document.querySelectorAll('input[name="patternBelt"]').forEach((input) => {
    input.addEventListener('change', () => {
      applyPatternDefaults().catch(() => {});
    });
  });

  document.getElementById('patternAgeDefaultBtn')?.addEventListener('click', () => {
    applyPatternDefaults().catch(() => {});
  });
  document.getElementById('patternAgeAddBtn')?.addEventListener('click', () => {
    const host = document.getElementById('patternAgeRows');
    host?.insertAdjacentHTML('beforeend', ageRowHtml());
  });
  document.getElementById('patternAgeRemoveBtn')?.addEventListener('click', () => {
    const rows = document.querySelectorAll('#patternAgeRows .da-pattern-band-row');
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
  });

  document.getElementById('patternRankDefaultBtn')?.addEventListener('click', () => {
    applyPatternDefaults().catch(() => {});
  });
  document.getElementById('patternRankAddBtn')?.addEventListener('click', () => {
    const belt = getSelectedBelt();
    const host = document.getElementById('patternRankRows');
    host?.insertAdjacentHTML('beforeend', rankRowHtml('', '', belt));
  });
  document.getElementById('patternRankRemoveBtn')?.addEventListener('click', () => {
    const rows = document.querySelectorAll('#patternRankRows .da-pattern-band-row');
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
  });

  document.querySelectorAll('input[name="patternWeightMode"]').forEach((input) => {
    input.addEventListener('change', () => applyWeightModeSelection(input.value));
    input.addEventListener('click', () => applyWeightModeSelection(input.value));
  });

  document.querySelectorAll('input[name="patternHeightMode"]').forEach((input) => {
    input.addEventListener('change', () => applyHeightModeSelection(input.value));
    input.addEventListener('click', () => applyHeightModeSelection(input.value));
  });

  document.getElementById('patternMaleWeightAddBtn')?.addEventListener('click', () => {
    document.getElementById('patternMaleWeightRows')?.insertAdjacentHTML('beforeend', weightRowHtml());
  });
  document.getElementById('patternMaleWeightRemoveBtn')?.addEventListener('click', () => {
    const rows = document.querySelectorAll('#patternMaleWeightRows .da-pattern-band-row');
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
  });
  document.getElementById('patternFemaleWeightAddBtn')?.addEventListener('click', () => {
    document.getElementById('patternFemaleWeightRows')?.insertAdjacentHTML('beforeend', weightRowHtml());
  });
  document.getElementById('patternFemaleWeightRemoveBtn')?.addEventListener('click', () => {
    const rows = document.querySelectorAll('#patternFemaleWeightRows .da-pattern-band-row');
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
  });

  document.getElementById('patternHeightDefaultBtn')?.addEventListener('click', () => {
    ensureDefaultFixedCmBands();
    setHeightMode('fixed_cm');
    syncWeightHeightUi();
  });
  document.getElementById('patternHeightAddBtn')?.addEventListener('click', () => {
    document.getElementById('patternHeightRows')?.insertAdjacentHTML('beforeend', heightRowHtml());
  });
  document.getElementById('patternHeightRemoveBtn')?.addEventListener('click', () => {
    const rows = document.querySelectorAll('#patternHeightRows .da-pattern-band-row');
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
  });
}
