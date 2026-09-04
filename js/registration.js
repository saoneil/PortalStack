function logInteraction(action, details) {
  var payload = { interaction: Object.assign({ action: action, page: 'registration' }, details || {}) };
  fetch('/api/public-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(function() {});
}

var EVENT_CHECKBOX_FIELDS = [
  { name: 'individualPatterns', key: 'individual_patterns', label: 'individual patterns' },
  { name: 'individualSparring', key: 'individual_sparring', label: 'individual sparring' },
  { name: 'individualSpecialTechnique', key: 'individual_special_technique', label: 'individual special technique' },
  { name: 'individualPowerTest', key: 'individual_power_test', label: 'individual power test' },
  { name: 'teamPatterns', key: 'team_patterns', label: 'team patterns' },
  { name: 'teamSparring', key: 'team_sparring', label: 'team sparring' },
  { name: 'teamSpecialTechnique', key: 'team_special_technique', label: 'team special technique' },
  { name: 'teamPowerTest', key: 'team_power_test', label: 'team power test' },
  { name: 'preArrangedSparring', key: 'pre_arranged_sparring', label: 'pre-arranged sparring' }
];

var TEAM_AGE_YEARS = {
  'pre-junior': 13,
  junior: 16,
  adult: 25
};

function parseEventEventsList(eventRow) {
  var raw = getEventField(eventRow, 'event_events') ||
    getEventField(eventRow, 'Event Events') ||
    getEventField(eventRow, 'Events');
  if (!raw) return [];
  return String(raw)
    .split(';')
    .map(function(part) { return part.trim().toLowerCase(); })
    .filter(Boolean);
}

function getAllowedEventKeysForSelectedEvent() {
  var eventRow = eventsById[selectedEventId];
  if (!eventRow) return [];
  return parseEventEventsList(eventRow);
}

function getActiveEventsGrid() {
  if (isTeamRole()) return document.getElementById('teamEventsGrid');
  return document.getElementById('athleteEventsGrid');
}

function isTeamEventKey(key) {
  return String(key || '').indexOf('team') !== -1;
}

function syncAthleteTeamEventHint() {
  var host = document.getElementById('athleteTeamEventsHint');
  if (!host) return;
  var allowed = getAllowedEventKeysForSelectedEvent();
  var standardKeys = {};
  EVENT_CHECKBOX_FIELDS.forEach(function(field) {
    standardKeys[field.key] = true;
  });

  var labels = EVENT_CHECKBOX_FIELDS
    .filter(function(field) {
      return isTeamEventKey(field.key) && allowed.indexOf(field.key) !== -1;
    })
    .map(function(field) { return field.label; });

  // Custom event types that include "team" (e.g. test_team_event_2) also belong here.
  allowed.forEach(function(key) {
    if (standardKeys[key] || !isTeamEventKey(key)) return;
    labels.push(String(key).replace(/_/g, ' '));
  });

  if (!labels.length) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }

  host.hidden = false;
  host.innerHTML = labels.map(function(label) {
    return '<div class="athlete-team-event-faint">' + label + '</div>';
  }).join('') +
    '<p class="athlete-team-event-note">to register for these, complete a separate registration with the “team” role</p>';
}

function parseTeamMemberLastNames(raw) {
  var cleaned = String(raw || '')
    .trim()
    .replace(/^\(+/, '')
    .replace(/\)+$/, '')
    .trim();
  var names = cleaned
    .split(/[,;]+/)
    .map(function(part) { return part.trim(); })
    .filter(Boolean);
  if (names.length < 3 || names.length > 5) {
    return {
      error: 'enter 3 to 5 team member last names, separated by commas.',
      names: names
    };
  }
  return {
    value: '(' + names.join(', ') + ')',
    names: names
  };
}

function syncEventCheckboxVisibility() {
  var allowed = getAllowedEventKeysForSelectedEvent();
  var standardKeys = {};
  EVENT_CHECKBOX_FIELDS.forEach(function(field) {
    standardKeys[field.key] = true;
  });

  function syncGrid(gridId, teamOnly) {
    var checkboxList = document.getElementById(gridId);
    var eventsGroup = checkboxList ? checkboxList.closest('.events-group') : null;
    if (!checkboxList) return;
    var visibleCount = 0;

    EVENT_CHECKBOX_FIELDS.forEach(function(field) {
      var input = checkboxList.querySelector('[name="' + field.name + '"]');
      if (!input) return;
      var labelEl = input.closest('.checkbox-item');
      // Athletes never select team division events here — those use the team role.
      if (!teamOnly && isTeamEventKey(field.key)) {
        if (labelEl) labelEl.hidden = true;
        input.checked = false;
        return;
      }
      var show = allowed.indexOf(field.key) !== -1;
      if (teamOnly) show = show && isTeamEventKey(field.key);
      if (labelEl) labelEl.hidden = !show;
      if (!show) input.checked = false;
      if (show) visibleCount += 1;
    });

    checkboxList.querySelectorAll('.checkbox-item.custom-event-item').forEach(function(item) {
      item.remove();
    });

    // Custom/other event keys on athlete form skip team_* keys.
    allowed.forEach(function(key) {
      if (standardKeys[key]) return;
      if (!teamOnly && isTeamEventKey(key)) return;

      var label = document.createElement('label');
      label.className = 'checkbox-item custom-event-item';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'customEvent_' + key;
      input.value = '1';
      input.dataset.customEventKey = key;
      input.checked = true;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + key.replace(/_/g, ' ')));
      checkboxList.appendChild(label);
      visibleCount += 1;
    });

    if (teamOnly) {
      if (eventsGroup) eventsGroup.hidden = visibleCount === 0;
    } else {
      var hint = document.getElementById('athleteTeamEventsHint');
      var hasTeamHint = hint && !hint.hidden;
      if (eventsGroup) eventsGroup.hidden = visibleCount === 0 && !hasTeamHint;
    }
  }

  syncAthleteTeamEventHint();
  syncGrid('athleteEventsGrid', false);
  syncGrid('teamEventsGrid', true);
}

var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseEventDateParts(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    var isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return {
        year: Number(isoMatch[1]),
        month: Number(isoMatch[2]) - 1,
        day: Number(isoMatch[3])
      };
    }
  }
  var date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate()
  };
}

function formatCompactSingleDate(parts) {
  return MONTH_SHORT[parts.month] + ' ' + parts.day + ' ' + parts.year;
}

function formatCompactDateRange(startValue, endValue) {
  var start = parseEventDateParts(startValue);
  var end = parseEventDateParts(endValue);

  if (!start && !end) return '';
  if (!start) return formatCompactSingleDate(end);
  if (!end) return formatCompactSingleDate(start);

  if (start.year === end.year && start.month === end.month && start.day === end.day) {
    return formatCompactSingleDate(start);
  }
  if (start.year === end.year && start.month === end.month) {
    return MONTH_SHORT[start.month] + ' ' + start.day + '-' + end.day + ' ' + start.year;
  }
  if (start.year === end.year) {
    return MONTH_SHORT[start.month] + ' ' + start.day + ' - ' + MONTH_SHORT[end.month] + ' ' + end.day + ' ' + start.year;
  }
  return formatCompactSingleDate(start) + ' - ' + formatCompactSingleDate(end);
}

function formatEventDate(value) {
  var parts = parseEventDateParts(value);
  if (!parts) return '';
  return formatCompactSingleDate(parts);
}

function getEventDateFromRow(eventRow, snakeKey, displayKeys) {
  var keys = [snakeKey].concat(displayKeys || []);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (eventRow[key] != null && eventRow[key] !== '') {
      return eventRow[key];
    }
    var fromField = getEventField(eventRow, key);
    if (fromField) return fromField;
  }
  return '';
}

function formatDateRangeLine(prefix, startValue, endValue) {
  var range = formatCompactDateRange(startValue, endValue);
  if (!range) range = 'dates TBD';
  return prefix + range;
}

function getEventLocationFromRow(eventRow) {
  return getEventDateFromRow(eventRow, 'event_location', ['Location', 'Event Location']);
}

function getEventField(eventRow, fieldName) {
  if (!eventRow) return '';
  if (eventRow[fieldName] != null && eventRow[fieldName] !== '') return eventRow[fieldName];
  var lowerKey = Object.keys(eventRow).find(function(key) {
    return key.toLowerCase() === fieldName.toLowerCase();
  });
  return lowerKey ? eventRow[lowerKey] : '';
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1';
}

function eventRequiresWaiver(eventId) {
  var eventRow = eventsById[eventId];
  if (!eventRow) return false;
  // Waiver is required for every role whenever waiver text is present, regardless of the
  // waiver_required organizer checkbox (server enforces the same rule).
  return isTruthyFlag(eventRow.has_waiver);
}

function hasAcceptedWaiverForEvent(eventId) {
  return eventId != null && String(waiverAcceptedForEventId) === String(eventId);
}

function clearWaiverAcceptance() {
  waiverAcceptedForEventId = null;
  pendingWaiverEventId = null;
}

function hideWaiverModal() {
  if (!waiverOverlay) return;
  waiverOverlay.hidden = true;
  if (waiverDocument) waiverDocument.textContent = '';
  pendingWaiverEventId = null;
}

function showWaiverModal(waiverText) {
  if (!waiverOverlay || !waiverDocument) return;
  waiverDocument.textContent = waiverText || '';
  waiverOverlay.hidden = false;
  if (waiverDocument.focus) {
    try { waiverDocument.focus(); } catch (e) {}
  }
}

function setReviewWaiverButtonLabel(accepted) {
  if (!reviewWaiverBtn) return;
  var textEl = reviewWaiverBtn.querySelector('.text');
  if (textEl) textEl.textContent = accepted ? 'waiver accepted' : 'accept waiver';
}

function syncWaiverSubmitState() {
  var requires = eventRequiresWaiver(selectedEventId);
  var accepted = hasAcceptedWaiverForEvent(selectedEventId);
  var formReady = !validateRegistration();

  if (reviewWaiverBtn) {
    if (!requires || submitRow.hidden) {
      reviewWaiverBtn.hidden = true;
      reviewWaiverBtn.disabled = true;
      setReviewWaiverButtonLabel(false);
    } else {
      reviewWaiverBtn.hidden = false;
      reviewWaiverBtn.disabled = !formReady || accepted;
      setReviewWaiverButtonLabel(accepted);
    }
  }

  if (submitRegistrationBtn) {
    var canSubmit = !requires || accepted;
    submitRegistrationBtn.disabled = !canSubmit;
    submitRegistrationBtn.classList.toggle('is-disabled', !canSubmit);
    if (!canSubmit) {
      submitRegistrationBtn.title = 'Accept the event waiver to submit registration.';
    } else {
      submitRegistrationBtn.title = '';
    }
  }
}

function openWaiverForSubmit() {
  if (!eventRequiresWaiver(selectedEventId)) return;

  var validationError = validateRegistration();
  if (validationError) {
    setFormStatus(validationError, 'error');
    syncWaiverSubmitState();
    return;
  }

  pendingWaiverEventId = selectedEventId;
  if (waiverAcceptBtn) waiverAcceptBtn.disabled = true;
  if (waiverDeclineBtn) waiverDeclineBtn.disabled = true;

  fetch('/api/registration/events/' + encodeURIComponent(selectedEventId) + '/waiver', {
    headers: { Accept: 'application/json' }
  })
    .then(function(res) {
      return res.json().then(function(data) {
        return { ok: res.ok, data: data || {} };
      }).catch(function() {
        return { ok: res.ok, data: {} };
      });
    })
    .then(function(result) {
      if (waiverAcceptBtn) waiverAcceptBtn.disabled = false;
      if (waiverDeclineBtn) waiverDeclineBtn.disabled = false;
      if (String(pendingWaiverEventId) !== String(selectedEventId)) return;
      if (!result.ok || !result.data.waiverText) {
        setFormStatus(result.data.error || 'Unable to load the event waiver. Please try again.', 'error');
        syncWaiverSubmitState();
        return;
      }
      showWaiverModal(result.data.waiverText);
      logInteraction('waiver_shown', {
        eventId: selectedEventId,
        eventName: getEventField(eventsById[selectedEventId], 'Event Name')
      });
    })
    .catch(function() {
      if (waiverAcceptBtn) waiverAcceptBtn.disabled = false;
      if (waiverDeclineBtn) waiverDeclineBtn.disabled = false;
      if (String(pendingWaiverEventId) !== String(selectedEventId)) return;
      setFormStatus('Unable to load the event waiver. Please try again.', 'error');
      syncWaiverSubmitState();
    });
}

function acceptWaiver() {
  if (!pendingWaiverEventId || String(selectedEventId) !== String(pendingWaiverEventId)) {
    hideWaiverModal();
    return;
  }
  var eventId = pendingWaiverEventId;
  waiverAcceptedForEventId = eventId;
  hideWaiverModal();
  setFormStatus('waiver accepted. you can submit your registration.', 'success');
  syncWaiverSubmitState();
  logInteraction('waiver_accepted', {
    eventId: eventId,
    eventName: getEventField(eventsById[eventId], 'Event Name')
  });
}

function declineWaiver() {
  var eventId = pendingWaiverEventId || selectedEventId;
  hideWaiverModal();
  clearWaiverAcceptance();
  if (eventId) {
    logInteraction('waiver_declined', {
      eventId: eventId,
      eventName: getEventField(eventsById[eventId], 'Event Name')
    });
  }
  setFormStatus('you must accept the event waiver before submitting registration.', 'error');
  syncWaiverSubmitState();
}

function formatEventDateRange(eventRow) {
  var start = getEventDateFromRow(eventRow, 'event_date_start', ['Start Date', 'Event Date Start']);
  var end = getEventDateFromRow(eventRow, 'event_date_end', ['End Date', 'Event Date End']);
  return formatCompactDateRange(start, end);
}

function formatEventOptionLabel(eventRow) {
  var parts = [
    getEventField(eventRow, 'Event Name'),
    formatEventDateRange(eventRow),
    getEventField(eventRow, 'Location')
  ].filter(function(part) { return part; });
  return parts.join('  |  ');
}

function getEventId(eventRow) {
  if (eventRow.id != null) return eventRow.id;
  if (eventRow.ID != null) return eventRow.ID;
  if (eventRow.event_id != null) return eventRow.event_id;
  return eventRow['Event ID'] != null ? eventRow['Event ID'] : null;
}

function scrubFieldValue(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\0/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>'"`;\\]/g, '')
    .trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

var eventGrid = document.getElementById('eventGrid');
var eventGridHint = document.getElementById('eventGridHint');
var eventFocusStage = document.getElementById('eventFocusStage');
var eventFocusPoster = document.getElementById('eventFocusPoster');
var eventFocusDetails = document.getElementById('eventFocusDetails');
var backToEventsBtn = document.getElementById('backToEventsBtn');
var eventStatus = document.getElementById('eventStatus');
var registrationClosedWarning = document.getElementById('registrationClosedWarning');
var registrationFlow = document.getElementById('registrationFlow');
var entryForm = document.getElementById('entryFieldsForm');
var formStatus = document.getElementById('formStatus');
var submitRegistrationBtn = document.getElementById('submitRegistrationBtn');
var reviewWaiverBtn = document.getElementById('reviewWaiverBtn');
var roleSelect = document.getElementById('reg-role');
var roleDivider = document.getElementById('roleDivider');
var athleteFields = document.getElementById('athleteFields');
var teamFields = document.getElementById('teamFields');
var staffFields = document.getElementById('staffFields');
var simpleFields = document.getElementById('simpleFields');
var submitRow = document.getElementById('submitRow');
var teamAgeRangeSelect = document.getElementById('reg-team-age-range');
var teamRankSelect = document.getElementById('reg-team-rank');
var teamGenderSelect = document.getElementById('reg-team-gender');
var staffRankSelect = document.getElementById('reg-staff-rank');
var staffGenderSelect = document.getElementById('reg-staff-gender');
var umpireOnlyFields = document.getElementById('umpireOnlyFields');
var umpirePreferredRoleSelect = document.getElementById('reg-umpire-preferred-role');
var umpireClassSelect = document.getElementById('reg-umpire-class');
var confirmOverlay = document.getElementById('confirmOverlay');
var confirmSummary = document.getElementById('confirmSummary');
var confirmSubmitBtn = document.getElementById('confirmSubmitBtn');
var confirmCancelBtn = document.getElementById('confirmCancelBtn');
var successOverlay = document.getElementById('successOverlay');
var successOkBtn = document.getElementById('successOkBtn');
var waiverOverlay = document.getElementById('waiverOverlay');
var waiverDocument = document.getElementById('waiverDocument');
var waiverAcceptBtn = document.getElementById('waiverAcceptBtn');
var waiverDeclineBtn = document.getElementById('waiverDeclineBtn');
var eventsById = Object.create(null);
var selectedEventId = null;
var pendingPayload = null;
var waiverAcceptedForEventId = null;
var pendingWaiverEventId = null;

function setStatus(message, isError) {
  eventStatus.textContent = message || '';
  eventStatus.classList.toggle('error', !!isError);
}

function setFormStatus(message, type) {
  formStatus.textContent = message || '';
  formStatus.classList.remove('error', 'success');
  if (type) formStatus.classList.add(type);
}

function getCheckboxValue(name) {
  var grid = getActiveEventsGrid();
  var input = grid
    ? grid.querySelector('[name="' + name + '"]')
    : entryForm.querySelector('[name="' + name + '"]');
  return !!(input && input.checked);
}

function getSelectedOtherEventKeys() {
  var keys = [];
  var grid = getActiveEventsGrid();
  if (!grid) return keys;
  grid.querySelectorAll('.checkbox-item.custom-event-item input[type="checkbox"]').forEach(function(input) {
    if (!input.checked || !input.dataset.customEventKey) return;
    var key = String(input.dataset.customEventKey).trim();
    if (key && keys.indexOf(key) === -1) keys.push(key);
  });
  return keys;
}

function getSelectedEventLabels() {
  var grid = getActiveEventsGrid();
  var labels = EVENT_CHECKBOX_FIELDS
    .filter(function(field) {
      if (!grid) return false;
      var input = grid.querySelector('[name="' + field.name + '"]');
      if (!input) return false;
      var labelEl = input.closest('.checkbox-item');
      if (labelEl && labelEl.hidden) return false;
      return !!input.checked;
    })
    .map(function(field) { return field.label; });

  getSelectedOtherEventKeys().forEach(function(key) {
    labels.push(key.replace(/_/g, ' '));
  });

  return labels;
}

function isAthleteRole() {
  return roleSelect.value === 'athlete';
}

function isTeamRole() {
  return roleSelect.value === 'team';
}

function dobFromAgeYears(years) {
  var age = Number(years);
  if (!Number.isFinite(age) || age <= 0) return '';
  var date = new Date();
  date.setFullYear(date.getFullYear() - age);
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function mapTeamRankBand(value) {
  var band = String(value || '').trim().toLowerCase();
  if (band === 'gup') return '1st gup';
  if (band === 'dan') return '1st dan';
  return '';
}

function syncFieldEmptyStates() {
  roleSelect.classList.toggle('field-empty', !roleSelect.value);
  if (entryForm.rank) entryForm.rank.classList.toggle('field-empty', !entryForm.rank.value);
  if (entryForm.gender) entryForm.gender.classList.toggle('field-empty', !entryForm.gender.value);
  if (teamAgeRangeSelect) teamAgeRangeSelect.classList.toggle('field-empty', !teamAgeRangeSelect.value);
  if (teamRankSelect) teamRankSelect.classList.toggle('field-empty', !teamRankSelect.value);
  if (teamGenderSelect) teamGenderSelect.classList.toggle('field-empty', !teamGenderSelect.value);
  if (staffRankSelect) staffRankSelect.classList.toggle('field-empty', !staffRankSelect.value);
  if (staffGenderSelect) staffGenderSelect.classList.toggle('field-empty', !staffGenderSelect.value);
  if (umpirePreferredRoleSelect) {
    umpirePreferredRoleSelect.classList.toggle('field-empty', !umpirePreferredRoleSelect.value);
  }
  if (umpireClassSelect) umpireClassSelect.classList.toggle('field-empty', !umpireClassSelect.value);
}

var dobParts = { year: '', month: '', day: '' };
var dobActiveSegment = 'year';

function dobSegmentLength(segment) {
  return segment === 'year' ? 4 : 2;
}

function dobSegmentPlaceholder(segment) {
  if (segment === 'year') return 'yyyy';
  if (segment === 'month') return 'mm';
  return 'dd';
}

function dobSegmentText(segment) {
  var value = dobParts[segment];
  var placeholder = dobSegmentPlaceholder(segment);
  var length = dobSegmentLength(segment);
  if (!value) return placeholder;
  if (value.length >= length) return value.slice(0, length);
  return value + placeholder.slice(value.length);
}

function dobDisplayValue() {
  return dobSegmentText('year') + '/' + dobSegmentText('month') + '/' + dobSegmentText('day');
}

function dobSegmentFromCursor(position) {
  if (position <= 3) return 'year';
  if (position <= 6) return 'month';
  return 'day';
}

function dobCursorForSegment(segment) {
  if (segment === 'year') return Math.min(dobParts.year.length, 3);
  if (segment === 'month') return 5 + Math.min(dobParts.month.length, 1);
  return 8 + Math.min(dobParts.day.length, 1);
}

function dobRenderHtml() {
  function chars(segment) {
    var value = dobParts[segment];
    var placeholder = dobSegmentPlaceholder(segment);
    var length = dobSegmentLength(segment);
    var html = '';
    var i;
    for (i = 0; i < length; i++) {
      if (i < value.length) {
        html += '<span class="field-value">' + value[i] + '</span>';
      } else {
        html += '<span class="field-hint">' + placeholder[i] + '</span>';
      }
    }
    return html;
  }
  return chars('year') + '<span class="field-hint">/</span>' + chars('month') + '<span class="field-hint">/</span>' + chars('day');
}

function isStaffRole() {
  var role = roleSelect.value;
  return role === 'coach' || role === 'umpire';
}

function isUmpireRole() {
  return roleSelect.value === 'umpire';
}

function getActiveDobInput() {
  if (isStaffRole()) return document.getElementById('reg-staff-dob');
  return entryForm.dob;
}

function getActiveDobDisplay() {
  if (isStaffRole()) return document.getElementById('staffDobDisplay');
  return document.getElementById('dobDisplay');
}

function syncDobInput() {
  var input = getActiveDobInput();
  var display = getActiveDobDisplay();
  if (!input) return;
  input.value = dobDisplayValue();
  if (display) display.innerHTML = dobRenderHtml();
  try {
    var cursor = dobCursorForSegment(dobActiveSegment);
    input.setSelectionRange(cursor, cursor);
  } catch (_) { /* ignore */ }
}

function resetDobField() {
  dobParts.year = '';
  dobParts.month = '';
  dobParts.day = '';
  dobActiveSegment = 'year';
  // Keep both mirrors blank when resetting
  [entryForm.dob, document.getElementById('reg-staff-dob')].forEach(function(input) {
    if (input) input.value = dobDisplayValue();
  });
  ['dobDisplay', 'staffDobDisplay'].forEach(function(id) {
    var display = document.getElementById(id);
    if (display) display.innerHTML = dobRenderHtml();
  });
}

function isDobComplete() {
  return dobParts.year.length === 4 &&
    dobParts.month.length >= 1 &&
    dobParts.day.length >= 1;
}

function isDobValid() {
  if (!isDobComplete()) return false;
  var year = parseInt(dobParts.year, 10);
  var month = parseInt(dobParts.month, 10);
  var day = parseInt(dobParts.day, 10);
  if (month < 1 || month > 12 || day < 1) return false;
  var date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function getDobSubmitValue() {
  if (!isDobComplete()) return '';
  return dobParts.year + '-' +
    dobParts.month.padStart(2, '0') + '-' +
    dobParts.day.padStart(2, '0');
}

function dobMoveSegment(direction) {
  if (direction < 0) {
    if (dobActiveSegment === 'month') dobActiveSegment = 'year';
    else if (dobActiveSegment === 'day') dobActiveSegment = 'month';
  } else {
    if (dobActiveSegment === 'year') dobActiveSegment = 'month';
    else if (dobActiveSegment === 'month') dobActiveSegment = 'day';
  }
  syncDobInput();
}

function dobApplyDigit(digit) {
  var segment = dobActiveSegment;
  var maxLen = dobSegmentLength(segment);
  if (dobParts[segment].length >= maxLen) {
    if (segment === 'year') {
      dobActiveSegment = 'month';
      dobApplyDigit(digit);
    } else if (segment === 'month') {
      dobActiveSegment = 'day';
      dobApplyDigit(digit);
    }
    return;
  }
  dobParts[segment] += digit;
  if (dobParts[segment].length >= maxLen) {
    if (segment === 'year') dobActiveSegment = 'month';
    else if (segment === 'month') dobActiveSegment = 'day';
  }
  syncDobInput();
}

function dobBackspace() {
  var segment = dobActiveSegment;
  if (dobParts[segment].length > 0) {
    dobParts[segment] = dobParts[segment].slice(0, -1);
    syncDobInput();
    return;
  }
  if (segment === 'month') {
    dobActiveSegment = 'year';
    dobParts.year = dobParts.year.slice(0, -1);
  } else if (segment === 'day') {
    dobActiveSegment = 'month';
    dobParts.month = dobParts.month.slice(0, -1);
  }
  syncDobInput();
}

function initDobField() {
  function bindDobInput(input) {
    if (!input) return;
    input.addEventListener('focus', syncDobInput);
    input.addEventListener('click', function() {
      dobActiveSegment = dobSegmentFromCursor(input.selectionStart || 0);
      syncDobInput();
    });
    input.addEventListener('keydown', function(e) {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        dobApplyDigit(e.key);
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        dobBackspace();
        return;
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        dobParts[dobActiveSegment] = '';
        syncDobInput();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        dobMoveSegment(-1);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === '/') {
        e.preventDefault();
        dobMoveSegment(1);
        return;
      }
      if (e.key.length === 1) e.preventDefault();
    });
    input.addEventListener('paste', function(e) {
      e.preventDefault();
      var pasted = (e.clipboardData || window.clipboardData).getData('text');
      var match = pasted.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
      if (!match) return;
      dobParts.year = match[1];
      dobParts.month = match[2];
      dobParts.day = match[3];
      dobActiveSegment = 'day';
      syncDobInput();
    });
  }

  bindDobInput(entryForm.dob);
  bindDobInput(document.getElementById('reg-staff-dob'));
  resetDobField();
}

function initFieldHints() {
  function bindHint(inputId, hintId) {
    var input = document.getElementById(inputId);
    var hint = document.getElementById(hintId);
    if (!input || !hint) return;
    input.addEventListener('focus', function() { hint.hidden = false; });
    input.addEventListener('blur', function() { hint.hidden = true; });
  }
  bindHint('reg-weight', 'weightHint');
  bindHint('reg-height', 'heightHint');
}

function hideRoleFields() {
  roleDivider.hidden = true;
  athleteFields.hidden = true;
  if (teamFields) teamFields.hidden = true;
  if (staffFields) staffFields.hidden = true;
  if (umpireOnlyFields) umpireOnlyFields.hidden = true;
  simpleFields.hidden = true;
  submitRow.hidden = true;
  if (reviewWaiverBtn) reviewWaiverBtn.hidden = true;
}

function onRoleChange() {
  hideRoleFields();
  setFormStatus('');
  clearWaiverAcceptance();
  hideWaiverModal();

  if (!roleSelect.value) {
    syncFieldEmptyStates();
    syncWaiverSubmitState();
    return;
  }

  roleDivider.hidden = false;

  if (isAthleteRole()) {
    athleteFields.hidden = false;
    applyAthleteDefaults();
  } else if (isTeamRole()) {
    if (teamFields) teamFields.hidden = false;
    applyTeamDefaults();
  } else if (isStaffRole()) {
    if (staffFields) staffFields.hidden = false;
    if (umpireOnlyFields) umpireOnlyFields.hidden = !isUmpireRole();
    applyStaffDefaults();
  } else {
    simpleFields.hidden = false;
  }

  submitRow.hidden = false;
  syncFieldEmptyStates();
  syncWaiverSubmitState();
  logInteraction('role_selected', { role: roleSelect.value });
}

function applyAthleteDefaults() {
  syncEventCheckboxVisibility();
  var grid = document.getElementById('athleteEventsGrid');
  EVENT_CHECKBOX_FIELDS.forEach(function(field) {
    var input = grid ? grid.querySelector('[name="' + field.name + '"]') : null;
    if (!input) return;
    var labelEl = input.closest('.checkbox-item');
    if (labelEl && labelEl.hidden) {
      input.checked = false;
      return;
    }
    input.checked = field.name === 'individualPatterns' || field.name === 'individualSparring';
  });
  resetDobField();
}

function applyTeamDefaults() {
  syncEventCheckboxVisibility();
  var grid = document.getElementById('teamEventsGrid');
  EVENT_CHECKBOX_FIELDS.forEach(function(field) {
    var input = grid ? grid.querySelector('[name="' + field.name + '"]') : null;
    if (!input) return;
    var labelEl = input.closest('.checkbox-item');
    if (labelEl && labelEl.hidden) {
      input.checked = false;
      return;
    }
    input.checked = field.name === 'teamPatterns' || field.name === 'teamSparring';
  });
  if (teamAgeRangeSelect) teamAgeRangeSelect.value = '';
  if (teamRankSelect) teamRankSelect.value = '';
  if (teamGenderSelect) teamGenderSelect.value = '';
}

function applyStaffDefaults() {
  resetDobField();
  if (staffRankSelect) staffRankSelect.value = '';
  if (staffGenderSelect) staffGenderSelect.value = '';
  var teamInput = document.getElementById('reg-staff-team');
  if (teamInput) teamInput.value = '';
  if (umpirePreferredRoleSelect) umpirePreferredRoleSelect.value = '';
  if (umpireClassSelect) umpireClassSelect.value = '';
}

function resetRegistrationForm() {
  entryForm.reset();
  roleSelect.value = '';
  hideRoleFields();
  applyAthleteDefaults();
  syncFieldEmptyStates();
}

function collectRegistrationPayload() {
  var role = scrubFieldValue(roleSelect.value);
  var payload = {
    eventId: scrubFieldValue(selectedEventId),
    role: role,
    contactEmail: '',
    firstName: '',
    lastName: '',
    dob: '',
    rank: '',
    gender: '',
    weightKg: '',
    heightKg: '',
    teamNameOrCountry: '',
    individualPatterns: false,
    individualSparring: false,
    individualSpecialTechnique: false,
    individualPowerTest: false,
    teamPatterns: false,
    teamSparring: false,
    teamSpecialTechnique: false,
    teamPowerTest: false,
    preArrangedSparring: false,
    otherEvents: ''
  };

  if (role === 'athlete') {
    payload.contactEmail = scrubFieldValue(entryForm.contactEmail.value);
    payload.firstName = scrubFieldValue(entryForm.firstName.value);
    payload.lastName = scrubFieldValue(entryForm.lastName.value);
    payload.dob = getDobSubmitValue();
    payload.rank = scrubFieldValue(entryForm.rank.value);
    payload.gender = scrubFieldValue(entryForm.gender.value);
    payload.weightKg = scrubFieldValue(entryForm.weightKg.value);
    payload.heightKg = scrubFieldValue(entryForm.heightKg.value);
    payload.teamNameOrCountry = scrubFieldValue(entryForm.teamNameOrCountry.value);
    EVENT_CHECKBOX_FIELDS.forEach(function(field) {
      payload[field.name] = isTeamEventKey(field.key) ? false : getCheckboxValue(field.name);
    });
    payload.otherEvents = getSelectedOtherEventKeys().join(':');
  } else if (role === 'team') {
    payload.contactEmail = scrubFieldValue(document.getElementById('reg-team-email').value);
    payload.firstName = scrubFieldValue(document.getElementById('reg-team-name').value);
    var membersParsed = parseTeamMemberLastNames(document.getElementById('reg-team-members').value);
    payload.lastName = membersParsed.value || scrubFieldValue(document.getElementById('reg-team-members').value);
    payload.gender = scrubFieldValue(teamGenderSelect && teamGenderSelect.value);
    payload.rank = mapTeamRankBand(teamRankSelect && teamRankSelect.value);
    payload.dob = dobFromAgeYears(TEAM_AGE_YEARS[teamAgeRangeSelect && teamAgeRangeSelect.value]);
    payload.teamNameOrCountry = payload.firstName;
    payload.weightKg = '';
    payload.heightKg = '';
    payload.ageRange = scrubFieldValue(teamAgeRangeSelect && teamAgeRangeSelect.value);
    payload.rankBand = scrubFieldValue(teamRankSelect && teamRankSelect.value);
    EVENT_CHECKBOX_FIELDS.forEach(function(field) {
      payload[field.name] = getCheckboxValue(field.name);
    });
    payload.otherEvents = getSelectedOtherEventKeys().join(':');
  } else if (isStaffRole()) {
    payload.contactEmail = scrubFieldValue(document.getElementById('reg-staff-email').value);
    payload.firstName = scrubFieldValue(document.getElementById('reg-staff-first-name').value);
    payload.lastName = scrubFieldValue(document.getElementById('reg-staff-last-name').value);
    payload.dob = getDobSubmitValue();
    payload.rank = scrubFieldValue(staffRankSelect && staffRankSelect.value);
    payload.gender = scrubFieldValue(staffGenderSelect && staffGenderSelect.value);
    payload.teamNameOrCountry = scrubFieldValue(document.getElementById('reg-staff-team').value);
    if (isUmpireRole()) {
      payload.umpirePreferredRole = scrubFieldValue(
        umpirePreferredRoleSelect && umpirePreferredRoleSelect.value
      );
      payload.umpireClass = scrubFieldValue(umpireClassSelect && umpireClassSelect.value);
    }
  } else {
    payload.contactEmail = scrubFieldValue(document.getElementById('reg-simple-email').value);
    payload.firstName = scrubFieldValue(entryForm.simpleFirstName.value);
    payload.lastName = scrubFieldValue(entryForm.simpleLastName.value);
  }

  payload.waiverAccepted = eventRequiresWaiver(selectedEventId)
    ? hasAcceptedWaiverForEvent(selectedEventId)
    : false;

  return payload;
}

function validateRegistration() {
  if (!selectedEventId) {
    return 'please select an event.';
  }
  if (isRegistrationClosed(selectedEventId)) {
    return 'registration for this event has closed.';
  }
  if (!roleSelect.value) {
    return 'please select a role.';
  }

  if (isAthleteRole()) {
    var email = scrubFieldValue(entryForm.contactEmail.value);
    if (!email) return 'please enter your email.';
    if (!isValidEmail(email)) return 'please enter a valid email address.';
    if (!scrubFieldValue(entryForm.firstName.value)) return 'please enter your first name.';
    if (!scrubFieldValue(entryForm.lastName.value)) return 'please enter your last name.';
    if (!isDobComplete()) return 'please enter your complete date of birth.';
    if (!isDobValid()) return 'please enter a valid date of birth.';
    if (!entryForm.rank.value) return 'please select your rank.';
    if (!entryForm.gender.value) return 'please select your gender.';
    if (!scrubFieldValue(entryForm.weightKg.value)) return 'please enter your weight.';
    if (!scrubFieldValue(entryForm.heightKg.value)) return 'please enter your height.';
    if (!scrubFieldValue(entryForm.teamNameOrCountry.value)) return 'please enter your team name or country.';
    if (getSelectedEventLabels().length === 0) return 'please select at least one event.';
    return '';
  }

  if (isTeamRole()) {
    var teamEmail = scrubFieldValue(document.getElementById('reg-team-email').value);
    if (!teamEmail) return 'please enter the team email.';
    if (!isValidEmail(teamEmail)) return 'please enter a valid email address.';
    if (!scrubFieldValue(document.getElementById('reg-team-name').value)) return 'please enter the team name.';
    var membersCheck = parseTeamMemberLastNames(document.getElementById('reg-team-members').value);
    if (membersCheck.error) return membersCheck.error;
    if (!teamGenderSelect || !teamGenderSelect.value) return 'please select the gender of the group.';
    if (getSelectedEventLabels().length === 0) return 'please select at least one event.';
    return '';
  }

  if (isStaffRole()) {
    var staffEmail = scrubFieldValue(document.getElementById('reg-staff-email').value);
    if (!staffEmail) return 'please enter your email.';
    if (!isValidEmail(staffEmail)) return 'please enter a valid email address.';
    if (!scrubFieldValue(document.getElementById('reg-staff-first-name').value)) return 'please enter your first name.';
    if (!scrubFieldValue(document.getElementById('reg-staff-last-name').value)) return 'please enter your last name.';
    if (!isDobComplete()) return 'please enter your complete date of birth.';
    if (!isDobValid()) return 'please enter a valid date of birth.';
    if (!staffRankSelect || !staffRankSelect.value) return 'please select your rank.';
    if (!staffGenderSelect || !staffGenderSelect.value) return 'please select your gender.';
    if (!scrubFieldValue(document.getElementById('reg-staff-team').value)) {
      return 'please enter your team name or country.';
    }
    if (isUmpireRole()) {
      if (!umpirePreferredRoleSelect || !umpirePreferredRoleSelect.value) {
        return 'please select your preferred role.';
      }
      if (!umpireClassSelect || !umpireClassSelect.value) {
        return 'please select your umpire class.';
      }
    }
    return '';
  }

  var simpleEmail = scrubFieldValue(document.getElementById('reg-simple-email').value);
  if (!simpleEmail) return 'please enter your email.';
  if (!isValidEmail(simpleEmail)) return 'please enter a valid email address.';
  if (!scrubFieldValue(entryForm.simpleFirstName.value)) return 'please enter your first name.';
  if (!scrubFieldValue(entryForm.simpleLastName.value)) return 'please enter your last name.';
  return '';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getPreselectedEventId() {
  var pathMatch = window.location.pathname.match(/\/registration\/([^/]+)\/?$/);
  if (pathMatch && pathMatch[1]) {
    return decodeURIComponent(pathMatch[1]);
  }
  return new URLSearchParams(window.location.search).get('event') || '';
}

function updateEventUrl(eventId) {
  var nextPath = eventId
    ? '/registration/' + encodeURIComponent(eventId)
    : '/registration';
  if (window.location.pathname !== nextPath) {
    window.history.replaceState(null, '', nextPath);
  }
}

function resolveEventId(eventId) {
  if (!eventId) return '';
  if (eventsById[eventId]) return String(eventId);
  var target = String(eventId);
  for (var id in eventsById) {
    if (Object.prototype.hasOwnProperty.call(eventsById, id) && String(id) === target) {
      return String(id);
    }
  }
  return '';
}

function applyPreselectedEvent() {
  var eventId = resolveEventId(getPreselectedEventId());
  if (!eventId) return;
  if (eventsById[eventId]) {
    selectEvent(eventId);
  }
}

function buildConfirmSummary(payload) {
  var eventRow = eventsById[payload.eventId];
  var eventLabel = eventRow ? formatEventOptionLabel(eventRow) : payload.eventId;
  var lines = ['role: ' + payload.role];

  if (payload.role === 'athlete') {
    lines.push('name: ' + payload.firstName + ' ' + payload.lastName);
    lines.push('email: ' + payload.contactEmail);
    lines.push('dob: ' + payload.dob);
    lines.push('rank: ' + payload.rank);
    lines.push('gender: ' + payload.gender);
    lines.push('weight: ' + payload.weightKg + ' kg');
    lines.push('height: ' + payload.heightKg + ' cm');
    lines.push('team/country: ' + payload.teamNameOrCountry);
    lines.push('events: ' + getSelectedEventLabels().join(', '));
  } else if (payload.role === 'team') {
    lines.push('team name: ' + payload.firstName);
    lines.push('members: ' + payload.lastName);
    lines.push('email: ' + payload.contactEmail);
    if (payload.dob) lines.push('age range dob: ' + payload.dob);
    if (payload.rank) lines.push('rank: ' + payload.rank);
    lines.push('gender: ' + (payload.gender === 'X' ? 'mixed' : payload.gender));
    lines.push('events: ' + getSelectedEventLabels().join(', '));
  } else if (payload.role === 'coach' || payload.role === 'umpire') {
    lines.push('name: ' + payload.firstName + ' ' + payload.lastName);
    lines.push('email: ' + payload.contactEmail);
    lines.push('dob: ' + payload.dob);
    lines.push('rank: ' + payload.rank);
    lines.push('gender: ' + payload.gender);
    lines.push('team/country: ' + payload.teamNameOrCountry);
    if (payload.role === 'umpire') {
      if (payload.umpirePreferredRole) lines.push('preferred role: ' + payload.umpirePreferredRole);
      if (payload.umpireClass) lines.push('umpire class: ' + payload.umpireClass);
    }
  } else {
    lines.push('name: ' + payload.firstName + ' ' + payload.lastName);
    lines.push('email: ' + payload.contactEmail);
  }

  return '<p class="confirm-line">event: ' + escapeHtml(eventLabel) + '</p>' +
    '<div class="confirm-spacer"></div>' +
    lines.map(function(line) {
      return '<p class="confirm-line">' + escapeHtml(line) + '</p>';
    }).join('');
}

function showConfirmModal(payload) {
  pendingPayload = payload;
  confirmSummary.innerHTML = buildConfirmSummary(payload);
  confirmOverlay.hidden = false;
}

function hideConfirmModal() {
  confirmOverlay.hidden = true;
  pendingPayload = null;
}

function submitRegistration(payload) {
  submitRegistrationBtn.disabled = true;
  setFormStatus('');

  fetch('/api/registration/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(function(res) {
      return res.json().then(function(data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function(result) {
      if (!result.ok || !result.data.success) {
        throw new Error(result.data.error || 'unable to submit registration.');
      }
      logInteraction('registration_submit_success', {
        eventId: payload.eventId,
        role: payload.role,
        registrationId: result.data.registrationId
      });
      successOverlay.hidden = false;
    })
    .catch(function(err) {
      setFormStatus(err.message || 'unable to submit registration. please try again shortly.', 'error');
      logInteraction('registration_submit_error', {
        eventId: payload.eventId,
        role: payload.role,
        message: err.message
      });
    })
    .finally(function() {
      syncWaiverSubmitState();
    });
}

function renderEventCards(events) {
  eventGrid.innerHTML = '';

  if (events.length === 0) {
    eventGrid.innerHTML = '<p class="event-grid-loading">no events are open for registration right now.</p>';
    setStatus('');
    return;
  }

  events.forEach(function(eventRow) {
    var eventId = getEventId(eventRow);
    if (eventId == null) return;
    eventsById[eventId] = eventRow;
    
    var card = document.createElement('div');
    card.className = 'event-card';
    card.dataset.eventId = String(eventId);
    
    var poster = document.createElement('div');
    poster.className = 'event-card-poster';
    
    var hasPoster = eventRow.has_poster || eventRow.event_poster;
    if (hasPoster) {
      var img = document.createElement('img');
      img.src = getPosterUrl(eventRow, eventId);
      img.alt = getEventField(eventRow, 'Event Name') || 'Event poster';
      poster.appendChild(img);
    } else {
      var placeholder = document.createElement('div');
      placeholder.className = 'event-card-poster-placeholder';
      placeholder.textContent = '📅';
      poster.appendChild(placeholder);
    }
    
    var name = document.createElement('div');
    name.className = 'event-card-name';
    name.textContent = getEventField(eventRow, 'Event Name') || 'Untitled Event';
    
    var dates = document.createElement('div');
    dates.className = 'event-card-dates';
    appendEventMetaLines(dates, eventRow, 'event-card-link', 'event-card-link-row');
    
    var actionHint = document.createElement('div');
    actionHint.className = 'event-card-action-hint';
    
    var isClosed = isRegistrationClosed(eventId);
    if (isClosed) {
      actionHint.textContent = 'registration closed';
      actionHint.classList.add('event-card-closed');
      card.classList.add('event-card-registration-closed');
    } else {
      actionHint.textContent = 'tap to register';
    }

    var details = document.createElement('div');
    details.className = 'event-card-details';
    details.appendChild(name);
    details.appendChild(dates);
    details.appendChild(actionHint);
    
    card.appendChild(poster);
    card.appendChild(details);
    
    card.addEventListener('click', function() {
      selectEvent(String(eventId));
    });
    
    eventGrid.appendChild(card);
  });

  setStatus('');
  syncFieldEmptyStates();
}

function updateGridHint() {
  if (!eventGridHint) return;
  if (selectedEventId) {
    eventGridHint.textContent = isRegistrationClosed(selectedEventId)
      ? 'event details above'
      : 'complete registration below';
  } else {
    eventGridHint.textContent = 'tap an event for details';
  }
}

var eventPublicResources = document.getElementById('eventPublicResources');
var eventDrawsLink = document.getElementById('eventDrawsLink');
var eventDigitalIdLink = document.getElementById('eventDigitalIdLink');
var eventLiveScheduleLink = document.getElementById('eventLiveScheduleLink');
var publicResourcesRequestId = 0;

function clearEventPublicResources() {
  if (eventPublicResources) eventPublicResources.hidden = true;
  if (eventDrawsLink) {
    eventDrawsLink.hidden = true;
    eventDrawsLink.removeAttribute('href');
  }
  if (eventDigitalIdLink) {
    eventDigitalIdLink.hidden = true;
    eventDigitalIdLink.removeAttribute('href');
  }
  if (eventLiveScheduleLink) {
    eventLiveScheduleLink.hidden = true;
    eventLiveScheduleLink.removeAttribute('href');
  }
}

function syncEventPublicResources(eventId) {
  if (!eventId) {
    clearEventPublicResources();
    return;
  }

  clearEventPublicResources();

  var requestId = ++publicResourcesRequestId;
  fetch('/api/registration/events/' + encodeURIComponent(eventId) + '/resources')
    .then(function(res) {
      return res.json().then(function(data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function(result) {
      if (requestId !== publicResourcesRequestId) return;
      if (String(selectedEventId) !== String(eventId)) return;
      if (!result.ok || !result.data) {
        clearEventPublicResources();
        return;
      }

      var data = result.data;
      var hasAny = false;

      if (eventDrawsLink) {
        if (data.hasDraws && data.drawsPdfUrl) {
          eventDrawsLink.href = data.drawsPdfUrl;
          eventDrawsLink.hidden = false;
          hasAny = true;
        } else {
          eventDrawsLink.hidden = true;
          eventDrawsLink.removeAttribute('href');
        }
      }

      if (eventDigitalIdLink) {
        if (data.hasDraws && data.digitalIdUrl) {
          eventDigitalIdLink.href = data.digitalIdUrl;
          eventDigitalIdLink.hidden = false;
          hasAny = true;
        } else {
          eventDigitalIdLink.hidden = true;
          eventDigitalIdLink.removeAttribute('href');
        }
      }

      if (eventLiveScheduleLink) {
        if (data.hasSchedule && data.liveScheduleUrl) {
          eventLiveScheduleLink.href = data.liveScheduleUrl;
          eventLiveScheduleLink.hidden = false;
          hasAny = true;
        } else {
          eventLiveScheduleLink.hidden = true;
          eventLiveScheduleLink.removeAttribute('href');
        }
      }

      if (eventPublicResources) eventPublicResources.hidden = !hasAny;
    })
    .catch(function() {
      if (requestId !== publicResourcesRequestId) return;
      clearEventPublicResources();
    });
}

function isRegistrationClosed(eventId) {
  var eventRow = eventsById[eventId];
  if (!eventRow) return false;
  
  var regCloseRaw = getEventDateFromRow(eventRow, 'registration_close_date', [
    'Registration Close Date',
    'Reg Close Date',
    'Registration End Date',
    'Registration End',
    'Reg Close'
  ]);
  
  if (!regCloseRaw) return false;
  
  var closeDate = new Date(regCloseRaw);
  if (isNaN(closeDate.getTime())) return false;
  
  var nowUTC = new Date();
  var todayUTC = new Date(Date.UTC(nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(), nowUTC.getUTCDate()));
  var closeDateUTC = new Date(Date.UTC(closeDate.getFullYear(), closeDate.getMonth(), closeDate.getDate()));
  
  return closeDateUTC < todayUTC;
}

function getPosterUrl(eventRow, eventId) {
  var posterVersion = eventRow && eventRow.poster_version != null ? String(eventRow.poster_version) : '';
  return '/api/registration/events/' + eventId + '/poster'
    + (posterVersion ? ('?v=' + encodeURIComponent(posterVersion)) : '');
}

function appendEventMetaLines(container, eventRow, linkClassName, linkRowClassName) {
  var eventStartRaw = getEventDateFromRow(eventRow, 'event_date_start', ['Start Date', 'Event Date Start']);
  var eventEndRaw = getEventDateFromRow(eventRow, 'event_date_end', ['End Date', 'Event Date End']);
  var regOpenRaw = getEventDateFromRow(eventRow, 'registration_open_date', [
    'Registration Open Date',
    'Reg Open Date',
    'Registration Start Date',
    'Registration Start',
    'Reg Open'
  ]);
  var regCloseRaw = getEventDateFromRow(eventRow, 'registration_close_date', [
    'Registration Close Date',
    'Reg Close Date',
    'Registration End Date',
    'Registration End',
    'Reg Close'
  ]);
  var location = getEventLocationFromRow(eventRow);
  var contact = eventRow.event_contact || getEventField(eventRow, 'event_contact') || '';

  var locationLine = document.createElement('div');
  locationLine.textContent = 'location: ' + (location || 'TBD');
  container.appendChild(locationLine);

  var eventDatesLine = document.createElement('div');
  eventDatesLine.textContent = formatDateRangeLine('event date: ', eventStartRaw, eventEndRaw);
  container.appendChild(eventDatesLine);

  var regDatesLine = document.createElement('div');
  regDatesLine.textContent = formatDateRangeLine('registration date: ', regOpenRaw, regCloseRaw);
  container.appendChild(regDatesLine);

  if (contact) {
    var contactLine = document.createElement('div');
    contactLine.textContent = 'contact: ' + contact;
    container.appendChild(contactLine);
  }

  var eventLink = eventRow.event_link || getEventField(eventRow, 'event_link');
  if (eventLink) {
    var linkRow = document.createElement('div');
    linkRow.className = linkRowClassName || 'event-card-link-row';
    var link = document.createElement('a');
    link.className = linkClassName || 'event-card-link';
    link.href = eventLink;
    link.textContent = 'Event Link';
    link.title = 'opens event website';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.addEventListener('click', function(e) {
      e.stopPropagation();
      logInteraction('event_link_click', { eventId: getEventId(eventRow), eventLink: eventLink });
    });
    linkRow.appendChild(link);
    container.appendChild(linkRow);
  }
}

function clearFocusStage() {
  if (eventFocusPoster) eventFocusPoster.innerHTML = '';
  if (eventFocusDetails) eventFocusDetails.innerHTML = '';
  if (eventFocusStage) eventFocusStage.hidden = true;
  if (backToEventsBtn) backToEventsBtn.hidden = true;
  document.body.classList.remove('registration-focus-active');
  if (eventGrid) eventGrid.hidden = false;
}

function renderFocusStage(eventId) {
  var eventRow = eventsById[eventId];
  if (!eventRow || !eventFocusStage || !eventFocusPoster || !eventFocusDetails) return;

  eventFocusPoster.innerHTML = '';
  eventFocusDetails.innerHTML = '';

  var hasPoster = eventRow.has_poster || eventRow.event_poster;
  if (hasPoster) {
    var img = document.createElement('img');
    img.src = getPosterUrl(eventRow, eventId);
    img.alt = getEventField(eventRow, 'Event Name') || 'Event poster';
    eventFocusPoster.appendChild(img);
  } else {
    var placeholder = document.createElement('div');
    placeholder.className = 'event-focus-poster-placeholder';
    placeholder.textContent = '📅';
    eventFocusPoster.appendChild(placeholder);
  }

  var name = document.createElement('h2');
  name.className = 'event-focus-name';
  name.textContent = getEventField(eventRow, 'Event Name') || 'Untitled Event';

  var meta = document.createElement('div');
  meta.className = 'event-focus-meta';
  appendEventMetaLines(meta, eventRow, 'event-focus-link', 'event-focus-link-row');

  eventFocusDetails.appendChild(name);
  eventFocusDetails.appendChild(meta);

  eventGrid.hidden = true;
  eventFocusStage.hidden = false;
  if (backToEventsBtn) backToEventsBtn.hidden = false;
  document.body.classList.add('registration-focus-active');
}

function syncGridFocusState() {
  if (selectedEventId) {
    renderFocusStage(selectedEventId);
    syncEventPublicResources(selectedEventId);
  } else {
    clearFocusStage();
    clearEventPublicResources();
  }
  updateGridHint();
}

function deselectEvent() {
  var previousEventId = selectedEventId;
  hideWaiverModal();
  clearWaiverAcceptance();
  selectedEventId = null;
  registrationFlow.hidden = true;
  registrationClosedWarning.hidden = true;
  resetRegistrationForm();
  setFormStatus('');
  updateEventUrl('');
  syncGridFocusState();
  syncWaiverSubmitState();
  logInteraction('event_deselected', {
    eventId: previousEventId,
    eventName: eventsById[previousEventId] ? getEventField(eventsById[previousEventId], 'Event Name') : ''
  });
}

function selectEvent(eventId) {
  if (selectedEventId === eventId) {
    deselectEvent();
    return;
  }

  hideWaiverModal();
  clearWaiverAcceptance();
  selectedEventId = eventId;

  var isClosed = isRegistrationClosed(eventId);

  // Always show event details + public resource links (draws / digital ID / schedule),
  // even when registration is closed.
  if (isClosed) {
    registrationFlow.hidden = true;
    registrationClosedWarning.hidden = false;
    resetRegistrationForm();
    setFormStatus('');
  } else {
    registrationClosedWarning.hidden = true;
    registrationFlow.hidden = false;
    resetRegistrationForm();
    syncEventCheckboxVisibility();
    setFormStatus('');
  }

  updateEventUrl(eventId);
  syncGridFocusState();
  syncWaiverSubmitState();
  logInteraction(isClosed ? 'event_selected_closed' : 'event_selected', {
    eventId: eventId,
    eventName: getEventField(eventsById[eventId], 'Event Name')
  });
}


entryForm.addEventListener('submit', function(e) {
  e.preventDefault();
  if (eventRequiresWaiver(selectedEventId) && !hasAcceptedWaiverForEvent(selectedEventId)) {
    setFormStatus('please accept the event waiver before submitting registration.', 'error');
    syncWaiverSubmitState();
    return;
  }
  var validationError = validateRegistration();
  if (validationError) {
    setFormStatus(validationError, 'error');
    syncWaiverSubmitState();
    return;
  }
  showConfirmModal(collectRegistrationPayload());
});

confirmCancelBtn.addEventListener('click', hideConfirmModal);
confirmSubmitBtn.addEventListener('click', function() {
  if (!pendingPayload) return;
  var payload = pendingPayload;
  hideConfirmModal();
  submitRegistration(payload);
});

if (reviewWaiverBtn) {
  reviewWaiverBtn.addEventListener('click', function() {
    openWaiverForSubmit();
  });
}

if (waiverAcceptBtn) {
  waiverAcceptBtn.addEventListener('click', acceptWaiver);
}
if (waiverDeclineBtn) {
  waiverDeclineBtn.addEventListener('click', declineWaiver);
}
if (waiverOverlay) {
  waiverOverlay.addEventListener('click', function(evt) {
    if (evt.target === waiverOverlay) {
      declineWaiver();
    }
  });
}

successOkBtn.addEventListener('click', function() {
  successOverlay.hidden = true;
  window.location.href = '/registration';
});

if (backToEventsBtn) {
  backToEventsBtn.addEventListener('click', function() {
    if (!selectedEventId) return;
    deselectEvent();
  });
}

logInteraction('page_view', { description: 'Event information page loaded' });

fetch('/api/registration/events')
  .then(function(res) {
    return res.json().then(function(data) {
      return { ok: res.ok, data: data };
    });
  })
  .then(function(result) {
    if (!result.ok) throw new Error(result.data.error || 'unable to load events.');
    renderEventCards(Array.isArray(result.data) ? result.data : []);
    applyPreselectedEvent();
  })
  .catch(function(err) {
    setStatus(err.message || 'unable to load events. please try again shortly.', true);
    eventGrid.innerHTML = '<p class="event-grid-loading">unable to load events.</p>';
  });
roleSelect.addEventListener('change', onRoleChange);
entryForm.addEventListener('input', function() {
  if (hasAcceptedWaiverForEvent(selectedEventId)) {
    clearWaiverAcceptance();
  }
  syncWaiverSubmitState();
});
entryForm.addEventListener('change', function() {
  if (hasAcceptedWaiverForEvent(selectedEventId)) {
    clearWaiverAcceptance();
  }
  syncWaiverSubmitState();
});
entryForm.rank.addEventListener('change', syncFieldEmptyStates);
entryForm.gender.addEventListener('change', syncFieldEmptyStates);
if (teamAgeRangeSelect) teamAgeRangeSelect.addEventListener('change', syncFieldEmptyStates);
if (teamRankSelect) teamRankSelect.addEventListener('change', syncFieldEmptyStates);
if (teamGenderSelect) teamGenderSelect.addEventListener('change', syncFieldEmptyStates);
if (staffRankSelect) staffRankSelect.addEventListener('change', syncFieldEmptyStates);
if (staffGenderSelect) staffGenderSelect.addEventListener('change', syncFieldEmptyStates);
if (umpirePreferredRoleSelect) umpirePreferredRoleSelect.addEventListener('change', syncFieldEmptyStates);
if (umpireClassSelect) umpireClassSelect.addEventListener('change', syncFieldEmptyStates);
initDobField();
initFieldHints();
initTeamNamePickers();

var registrationTeamsDirectory = { countries: [], clubs: [], provinces: [] };

function filterTeamNames(names, query) {
  var q = String(query || '').trim().toLowerCase();
  var list = Array.isArray(names) ? names.slice() : [];
  if (!q) return list;

  var starts = [];
  var contains = [];
  list.forEach(function(name) {
    var lower = String(name).toLowerCase();
    if (lower.indexOf(q) === 0) starts.push(name);
    else if (lower.indexOf(q) !== -1) contains.push(name);
  });
  return starts.concat(contains);
}

function renderTeamPickerPanel(panel, query) {
  if (!panel) return;
  var q = String(query || '').trim();
  var groups = [
    { label: 'Country', names: filterTeamNames(registrationTeamsDirectory.countries || [], q) },
    { label: 'Club', names: filterTeamNames(registrationTeamsDirectory.clubs || [], q) },
    { label: 'Province', names: filterTeamNames(registrationTeamsDirectory.provinces || [], q) }
  ];
  var total = groups.reduce(function(sum, group) { return sum + group.names.length; }, 0);
  var html = groups.map(function(group) {
    if (!group.names.length) return '';
    return '<div class="team-picker-group">' +
      '<div class="team-picker-group-label">' + escapeHtml(group.label) +
      ' <span class="team-picker-count">(' + group.names.length + ')</span></div>' +
      group.names.map(function(name) {
        return '<button type="button" class="team-picker-option" role="option" data-value="' +
          escapeHtml(name) + '">' + escapeHtml(name) + '</button>';
      }).join('') +
      '</div>';
  }).join('');

  if (!html) {
    panel.innerHTML = '<div class="team-picker-empty">no matches — keep typing a custom name</div>';
    return;
  }
  panel.innerHTML = (q
    ? '<div class="team-picker-status">' + total + ' match' + (total === 1 ? '' : 'es') + ' for “' + escapeHtml(q) + '”</div>'
    : '') + html;
}

function closeTeamPicker(root) {
  if (!root) return;
  var panel = root.querySelector('.team-picker-panel');
  var input = root.querySelector('.team-picker-input');
  if (panel) panel.hidden = true;
  if (input) input.setAttribute('aria-expanded', 'false');
  root.classList.remove('is-open');
}

function openTeamPicker(root) {
  if (!root) return;
  var panel = root.querySelector('.team-picker-panel');
  var input = root.querySelector('.team-picker-input');
  if (!panel || !input) return;
  renderTeamPickerPanel(panel, input.value);
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  root.classList.add('is-open');
}

function refreshOpenTeamPickers() {
  document.querySelectorAll('[data-team-picker].is-open').forEach(function(root) {
    var panel = root.querySelector('.team-picker-panel');
    var input = root.querySelector('.team-picker-input');
    if (panel && input && !panel.hidden) {
      renderTeamPickerPanel(panel, input.value);
    }
  });
}

function bindTeamNamePicker(root) {
  if (!root || root.dataset.teamPickerBound === '1') return;
  var input = root.querySelector('.team-picker-input');
  var toggle = root.querySelector('.team-picker-toggle');
  var panel = root.querySelector('.team-picker-panel');
  if (!input || !panel) return;
  root.dataset.teamPickerBound = '1';

  function chooseValue(value) {
    input.value = value;
    closeTeamPicker(root);
    input.focus();
  }

  input.addEventListener('focus', function() {
    openTeamPicker(root);
  });

  input.addEventListener('click', function() {
    openTeamPicker(root);
  });

  input.addEventListener('input', function() {
    // Keep the panel open and narrow results as the user types.
    renderTeamPickerPanel(panel, input.value);
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
  });

  input.addEventListener('keydown', function(evt) {
    if (evt.key === 'Escape') {
      closeTeamPicker(root);
    } else if (evt.key === 'ArrowDown') {
      openTeamPicker(root);
      var first = panel.querySelector('.team-picker-option');
      if (first) {
        evt.preventDefault();
        first.focus();
      }
    }
  });

  if (toggle) {
    toggle.addEventListener('mousedown', function(evt) {
      evt.preventDefault();
    });
    toggle.addEventListener('click', function() {
      if (panel.hidden) {
        openTeamPicker(root);
        input.focus();
      } else {
        closeTeamPicker(root);
      }
    });
  }

  panel.addEventListener('mousedown', function(evt) {
    // Prevent input blur from closing before option click registers.
    evt.preventDefault();
  });

  panel.addEventListener('click', function(evt) {
    var option = evt.target.closest('.team-picker-option');
    if (!option) return;
    chooseValue(option.getAttribute('data-value') || option.textContent || '');
  });

  panel.addEventListener('keydown', function(evt) {
    var option = evt.target.closest('.team-picker-option');
    if (!option) return;
    if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      chooseValue(option.getAttribute('data-value') || option.textContent || '');
    } else if (evt.key === 'Escape') {
      closeTeamPicker(root);
      input.focus();
    } else if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      evt.preventDefault();
      var options = Array.prototype.slice.call(panel.querySelectorAll('.team-picker-option'));
      var idx = options.indexOf(option);
      var next = evt.key === 'ArrowDown' ? options[idx + 1] : options[idx - 1];
      if (next) next.focus();
    }
  });
}

function initTeamNamePickers() {
  var pickers = document.querySelectorAll('[data-team-picker]');
  pickers.forEach(bindTeamNamePicker);

  document.addEventListener('mousedown', function(evt) {
    pickers.forEach(function(root) {
      if (!root.contains(evt.target)) closeTeamPicker(root);
    });
  });

  fetch('/api/registration/teams')
    .then(function(res) {
      if (!res.ok) throw new Error('Unable to load teams');
      return res.json();
    })
    .then(function(teams) {
      registrationTeamsDirectory = {
        countries: (teams && teams.countries) || [],
        clubs: (teams && teams.clubs) || [],
        provinces: (teams && teams.provinces) || []
      };
      refreshOpenTeamPickers();
    })
    .catch(function() {
      // Manual entry still works if the directory fails to load.
    });
}