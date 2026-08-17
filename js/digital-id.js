(function () {
  'use strict';

  const SLOT_MINUTES = 5;
  const DEFAULT_MATCH_MINUTES = 3;
  const DEFAULT_BUFFER_MINUTES = 0.5;

  const els = {
    eventTitle: document.getElementById('eventTitle'),
    eventMeta: document.getElementById('eventMeta'),
    athleteSearch: document.getElementById('athleteSearch'),
    athleteSuggestions: document.getElementById('athleteSuggestions'),
    statusMessage: document.getElementById('statusMessage'),
    athleteResult: document.getElementById('athleteResult'),
    selectedAthleteName: document.getElementById('selectedAthleteName'),
    athleteDivisions: document.getElementById('athleteDivisions')
  };

  const state = {
    clientId: '',
    eventId: '',
    event: null,
    schedule: null,
    athletes: [],
    activeSuggestionIndex: -1
  };

  function parseRoute() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'digital-id' && parts.length >= 3) {
      return { clientId: decodeURIComponent(parts[1]), eventId: decodeURIComponent(parts[2]) };
    }
    return { clientId: '', eventId: '' };
  }

  function norm(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseHhmm(text) {
    const match = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours > 23 || mins > 59) return null;
    return hours * 60 + mins;
  }

  function formatHhmm(totalMinutes) {
    const m = Math.max(0, Math.floor(totalMinutes));
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  function snapMinutes(minutes) {
    let m = Math.max(0, Math.floor(minutes));
    const rem = m % SLOT_MINUTES;
    if (rem) m += SLOT_MINUTES - rem;
    return m;
  }

  function matchCount(entry) {
    const divisionType = String(entry.division_type || '').trim();
    const n = Number(entry.athlete_count || 0) || 0;
    const jsonData = entry.json_data;
    if (divisionType === 'List') return Math.max(0, n);
    if (jsonData && typeof jsonData === 'object') {
      if (divisionType === 'Single Elimination' || divisionType === 'Round Robin') {
        return (jsonData.matches || []).length;
      }
      if (divisionType === 'Premier League') {
        const poolMatches = (jsonData.pools || []).reduce(
          (sum, p) => sum + ((p.round_robin_matches || []).length),
          0
        );
        const elimMatches = (
          ((jsonData.elimination || {}).matches || jsonData.elimination_matches || [])
        ).length;
        return poolMatches + elimMatches;
      }
    }
    if (divisionType === 'Round Robin') return n >= 2 ? (n * (n - 1)) / 2 : 0;
    if (divisionType === 'Single Elimination') return Math.max(0, n - 1);
    return Math.max(0, n);
  }

  function displayDurationMinutes(entry, matchDurations, bufferDurations) {
    const id = String(entry.id || '');
    const match = Number((matchDurations || {})[id] || DEFAULT_MATCH_MINUTES) || 0;
    const buffer = Number((bufferDurations || {})[id] || DEFAULT_BUFFER_MINUTES) || 0;
    const raw = (match + buffer) * matchCount(entry);
    return Math.max(SLOT_MINUTES, snapMinutes(raw));
  }

  function extractTeam(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return String(
      obj.country_dirty
      || obj.pdf_team
      || obj.country
      || obj.team
      || obj.club
      || obj.team_name_or_country
      || ''
    ).trim();
  }

  function personFromParts(name, teamSource) {
    const cleanedName = String(name || '').trim();
    if (!cleanedName) return null;
    return {
      name: cleanedName,
      team: extractTeam(typeof teamSource === 'object' ? teamSource : { team: teamSource })
    };
  }

  function sidePerson(side) {
    if (!side || typeof side !== 'object' || side.bye) return null;
    if (side.competitor && typeof side.competitor === 'object') {
      return personFromParts(side.competitor.name, side.competitor);
    }
    return personFromParts(side.name, side);
  }

  function athleteKey(person) {
    return `${norm(person && person.name)}\0${norm(person && person.team)}`;
  }

  function formatAthleteLabel(person) {
    const name = String(person && person.name || '').trim();
    const team = String(person && person.team || '').trim();
    if (!name) return '';
    return team ? `${name} — ${team}` : name;
  }

  function sameAthlete(candidate, selected) {
    if (!candidate || !selected) return false;
    if (norm(candidate.name) !== norm(selected.name)) return false;
    return norm(candidate.team) === norm(selected.team);
  }

  function athleteSearchHaystack(person) {
    return norm(`${person.name} ${person.team} ${formatAthleteLabel(person)}`);
  }

  function parseMatchNumber(label, fallbackIndex) {
    const text = String(label || '');
    const match = text.match(/(\d+)/);
    if (match) return Number(match[1]);
    return fallbackIndex + 1;
  }

  function collectAthletesFromEntry(entry, intoMap) {
    const json = entry.json_data;
    const divisionType = String(entry.division_type || '').trim();
    const add = (person) => {
      if (!person || !person.name) return;
      const key = athleteKey(person);
      if (!intoMap.has(key)) intoMap.set(key, person);
    };

    if (Array.isArray(entry.athletes)) {
      entry.athletes.forEach((athlete) => add(personFromParts(athlete && athlete.name, athlete)));
    }

    if (!json || typeof json !== 'object') return;

    if (divisionType === 'List') {
      (json.rows || []).forEach((row) => add(personFromParts(row && row.name, row)));
      (json.athletes || []).forEach((athlete) => add(personFromParts(athlete && athlete.name, athlete)));
      return;
    }

    if (divisionType === 'Premier League') {
      (json.athletes || []).forEach((athlete) => add(personFromParts(athlete && athlete.name, athlete)));
      return;
    }

    (json.matches || []).forEach((match) => {
      add(sidePerson(match && match.aka));
      add(sidePerson(match && match.ao));
    });
    (json.competitors || []).forEach((competitor) => add(personFromParts(competitor && competitor.name, competitor)));
  }

  function entryContainsAthlete(entry, selected) {
    if (firstMatchForAthlete(entry, selected)) return true;
    if (Array.isArray(entry.athletes)) {
      return entry.athletes.some((a) => sameAthlete(personFromParts(a && a.name, a), selected));
    }
    return false;
  }

  function firstMatchForAthlete(entry, selected) {
    const json = entry.json_data;
    const divisionType = String(entry.division_type || '').trim();
    if (!json || typeof json !== 'object') {
      if (Array.isArray(entry.athletes)
        && entry.athletes.some((a) => sameAthlete(personFromParts(a && a.name, a), selected))) {
        return { matchIndex: 0, matchNumber: 1, label: 'Division' };
      }
      return null;
    }

    if (divisionType === 'List') {
      const rows = json.rows || [];
      for (let i = 0; i < rows.length; i += 1) {
        if (sameAthlete(personFromParts(rows[i] && rows[i].name, rows[i]), selected)) {
          return { matchIndex: i, matchNumber: i + 1, label: `Entry ${i + 1}` };
        }
      }
      const listAthletes = json.athletes || [];
      for (let i = 0; i < listAthletes.length; i += 1) {
        if (sameAthlete(personFromParts(listAthletes[i] && listAthletes[i].name, listAthletes[i]), selected)) {
          return { matchIndex: i, matchNumber: i + 1, label: `Entry ${i + 1}` };
        }
      }
      return null;
    }

    if (divisionType === 'Premier League') {
      const athletes = json.athletes || [];
      const found = athletes.find((a) => sameAthlete(personFromParts(a && a.name, a), selected));
      if (!found) return null;
      const athleteId = found.id;
      let index = 0;
      for (const pool of (json.pools || [])) {
        const matches = pool.round_robin_matches || [];
        for (let i = 0; i < matches.length; i += 1) {
          const m = matches[i];
          const ids = [m.aka_id, m.ao_id, m.aka_competitor_id, m.ao_competitor_id]
            .map((v) => (v == null ? '' : String(v)));
          if (ids.includes(String(athleteId))) {
            return {
              matchIndex: index + i,
              matchNumber: parseMatchNumber(m.match_id || m.draw_label, index + i),
              label: m.match_id || m.draw_label || `Match ${index + i + 1}`
            };
          }
        }
        index += matches.length;
      }
      return { matchIndex: 0, matchNumber: 1, label: 'Pool' };
    }

    const matches = json.matches || [];
    let best = null;
    matches.forEach((match, index) => {
      const aka = sidePerson(match && match.aka);
      const ao = sidePerson(match && match.ao);
      if (!sameAthlete(aka, selected) && !sameAthlete(ao, selected)) return;
      const number = parseMatchNumber(match.draw_label || match.match_id, index);
      if (!best || number < best.matchNumber) {
        best = {
          matchIndex: index,
          matchNumber: number,
          label: match.draw_label || match.match_id || `Match ${number}`
        };
      }
    });
    if (best) return best;

    const competitors = json.competitors || [];
    const competitorHit = competitors.findIndex(
      (c) => sameAthlete(personFromParts(c && c.name, c), selected)
    );
    if (competitorHit >= 0) {
      return {
        matchIndex: competitorHit,
        matchNumber: competitorHit + 1,
        label: 'Draw'
      };
    }
    return null;
  }

  function buildAthleteIndex(schedule) {
    const map = new Map();
    (schedule.catalog || []).forEach((entry) => collectAthletesFromEntry(entry, map));
    return Array.from(map.values()).sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName) return byName;
      return a.team.localeCompare(b.team);
    });
  }

  function athleteScheduleRows(schedule, selected) {
    const rows = [];
    const days = schedule.days || [];
    const placements = schedule.placements || {};
    const scratchIds = new Set((schedule.scratch_ids || []).map((id) => String(id)));
    const matchDurations = schedule.match_durations || {};
    const bufferDurations = schedule.buffer_durations || {};

    (schedule.catalog || []).forEach((entry) => {
      const hit = firstMatchForAthlete(entry, selected);
      if (!hit && !entryContainsAthlete(entry, selected)) return;
      const matchInfo = hit || { matchIndex: 0, matchNumber: 1, label: 'Division' };

      const id = String(entry.id || '');
      const placement = placements[id] || null;
      const onScratch = scratchIds.has(id);
      const matchMinutes = Number(matchDurations[id] || DEFAULT_MATCH_MINUTES) || 0;
      const bufferMinutes = Number(bufferDurations[id] || DEFAULT_BUFFER_MINUTES) || 0;

      if (!placement) {
        rows.push({
          divisionName: entry.division_name || entry.id || 'Division',
          dayName: onScratch ? 'Scratch pad' : 'Not scheduled yet',
          ring: '—',
          divisionStart: '—',
          divisionEnd: '—',
          estimatedStart: '—',
          estimatedEnd: '—',
          matchNumber: matchInfo.matchNumber,
          matchLabel: matchInfo.label,
          scheduled: false,
          sortKey: 1e9 + matchInfo.matchIndex
        });
        return;
      }

      const day = days[Number(placement.day_index) || 0] || { name: 'Day 1', start_time: '08:00' };
      const dayStart = parseHhmm(day.start_time) || 8 * 60;
      const startOffset = Number(placement.start_offset_minutes || 0) || 0;
      const blockDuration = displayDurationMinutes(entry, matchDurations, bufferDurations);
      const divisionStart = dayStart + startOffset;
      const divisionEnd = divisionStart + blockDuration;
      const estStart = divisionStart + matchInfo.matchIndex * (matchMinutes + bufferMinutes);
      const estEnd = estStart + Math.max(matchMinutes, 1);

      rows.push({
        divisionName: entry.division_name || entry.id || 'Division',
        dayName: day.name || `Day ${(Number(placement.day_index) || 0) + 1}`,
        ring: (Number(placement.ring_index) || 0) + 1,
        divisionStart: formatHhmm(divisionStart),
        divisionEnd: formatHhmm(divisionEnd),
        estimatedStart: formatHhmm(estStart),
        estimatedEnd: formatHhmm(estEnd),
        matchNumber: matchInfo.matchNumber,
        matchLabel: matchInfo.label,
        scheduled: true,
        sortKey: divisionStart + matchInfo.matchIndex * 0.01
      });
    });

    rows.sort((a, b) => a.sortKey - b.sortKey);
    return rows;
  }

  function setStatus(message, isError) {
    if (!els.statusMessage) return;
    els.statusMessage.textContent = message || '';
    els.statusMessage.dataset.error = isError ? '1' : '0';
  }

  function hideSuggestions() {
    if (!els.athleteSuggestions) return;
    els.athleteSuggestions.hidden = true;
    els.athleteSuggestions.innerHTML = '';
    state.activeSuggestionIndex = -1;
  }

  function clearResult() {
    if (els.athleteResult) els.athleteResult.hidden = true;
    if (els.athleteDivisions) els.athleteDivisions.innerHTML = '';
  }

  function renderSuggestions(query) {
    const q = norm(query);
    if (!q) {
      hideSuggestions();
      clearResult();
      return;
    }

    const matches = state.athletes
      .filter((athlete) => athleteSearchHaystack(athlete).includes(q))
      .slice(0, 40);
    els.athleteSuggestions.innerHTML = '';

    if (!matches.length) {
      const empty = document.createElement('li');
      empty.className = 'digital-id-suggestion-empty';
      empty.textContent = 'No athletes found';
      els.athleteSuggestions.appendChild(empty);
      els.athleteSuggestions.hidden = false;
      state.activeSuggestionIndex = -1;
      return;
    }

    matches.forEach((athlete, index) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'digital-id-suggestion';
      btn.dataset.index = String(index);
      btn.dataset.name = athlete.name;
      btn.dataset.team = athlete.team || '';
      btn.innerHTML =
        `<span class="digital-id-suggestion-name">${escapeHtml(athlete.name)}</span>` +
        `<span class="digital-id-suggestion-meta">${escapeHtml(athlete.team || 'no team')}</span>`;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectAthlete(athlete);
      });
      li.appendChild(btn);
      els.athleteSuggestions.appendChild(li);
    });

    els.athleteSuggestions.hidden = false;
    state.activeSuggestionIndex = -1;
  }

  function updateActiveSuggestion(nextIndex) {
    const buttons = Array.from(els.athleteSuggestions.querySelectorAll('.digital-id-suggestion'));
    if (!buttons.length) return;
    state.activeSuggestionIndex = (nextIndex + buttons.length) % buttons.length;
    buttons.forEach((btn, idx) => {
      btn.classList.toggle('active', idx === state.activeSuggestionIndex);
    });
    buttons[state.activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
  }

  function selectAthlete(athlete) {
    const selected = {
      name: String(athlete && athlete.name || '').trim(),
      team: String(athlete && athlete.team || '').trim()
    };
    if (!selected.name) return;

    els.athleteSearch.value = formatAthleteLabel(selected);
    hideSuggestions();
    const rows = athleteScheduleRows(state.schedule, selected);
    els.selectedAthleteName.textContent = formatAthleteLabel(selected);
    els.athleteDivisions.innerHTML = '';

    if (!rows.length) {
      els.athleteDivisions.innerHTML =
        '<div class="digital-id-card"><p>No scheduled divisions found for this athlete yet.</p></div>';
    } else {
      rows.forEach((row) => {
        const card = document.createElement('article');
        card.className = 'digital-id-card';
        if (row.scheduled) {
          card.innerHTML =
            `<h3>${escapeHtml(row.divisionName)}</h3>` +
            `<p><strong>Day:</strong> ${escapeHtml(row.dayName)}</p>` +
            `<p><strong>Ring:</strong> ${escapeHtml(String(row.ring))}</p>` +
            `<p><strong>Division window:</strong> ${escapeHtml(row.divisionStart)} – ${escapeHtml(row.divisionEnd)}</p>` +
            `<p><strong>Your match:</strong> ${escapeHtml(row.matchLabel || `Match ${row.matchNumber}`)}` +
            ` (Estimated bout time: ${escapeHtml(row.estimatedStart)} – ${escapeHtml(row.estimatedEnd)})</p>`;
        } else {
          card.innerHTML =
            `<h3>${escapeHtml(row.divisionName)}</h3>` +
            `<p><strong>Status:</strong> ${escapeHtml(row.dayName)}</p>` +
            `<p><strong>Your match:</strong> ${escapeHtml(row.matchLabel || `Match ${row.matchNumber}`)}</p>` +
            `<p>Ring and bout times will appear once this division is placed on the live schedule.</p>`;
        }
        els.athleteDivisions.appendChild(card);
      });
    }

    els.athleteResult.hidden = false;
    setStatus(`${rows.length} division${rows.length === 1 ? '' : 's'} found.`);
  }

  function formatEventMeta(event) {
    if (!event) return '';
    const parts = [];
    if (event.dateStart || event.event_date_start || event.eventDateStart) {
      const raw = event.dateStart || event.event_date_start || event.eventDateStart;
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) {
        parts.push(date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }));
      }
    }
    if (event.location || event.event_location || event.eventLocation) {
      parts.push(event.location || event.event_location || event.eventLocation);
    }
    return parts.join(' · ');
  }

  async function loadSchedule() {
    const route = parseRoute();
    state.clientId = route.clientId;
    state.eventId = route.eventId;

    if (!state.clientId || !state.eventId) {
      els.eventTitle.textContent = 'Invalid link';
      setStatus('This page needs a valid event link: /digital-id/{clientId}/{eventId}', true);
      return;
    }

    try {
      const res = await fetch(
        `/api/live-schedule/${encodeURIComponent(state.clientId)}/${encodeURIComponent(state.eventId)}`
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Unable to load schedule.');
      }

      state.event = body.event || null;
      state.schedule = body.state || null;
      state.athletes = buildAthleteIndex(state.schedule || {});

      els.eventTitle.textContent =
        (state.event && (state.event.name || state.event.event_name || state.event.eventName))
        || 'Event schedule';
      els.eventMeta.textContent = formatEventMeta(state.event);
      els.athleteSearch.disabled = false;
      setStatus(
        state.athletes.length
          ? `Ready — ${state.athletes.length} athlete${state.athletes.length === 1 ? '' : 's'} available to search.`
          : 'Schedule loaded, but no athlete names were found in the draws yet.'
      );
    } catch (err) {
      els.eventTitle.textContent = 'Schedule unavailable';
      setStatus(err.message || 'Unable to load schedule.', true);
    }
  }

  function bindEvents() {
    els.athleteSearch.addEventListener('input', () => {
      clearResult();
      renderSuggestions(els.athleteSearch.value);
    });

    els.athleteSearch.addEventListener('keydown', (e) => {
      if (els.athleteSuggestions.hidden) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        updateActiveSuggestion(state.activeSuggestionIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        updateActiveSuggestion(state.activeSuggestionIndex - 1);
      } else if (e.key === 'Enter') {
        const buttons = els.athleteSuggestions.querySelectorAll('.digital-id-suggestion');
        if (!buttons.length) return;
        e.preventDefault();
        const idx = state.activeSuggestionIndex >= 0 ? state.activeSuggestionIndex : 0;
        const btn = buttons[idx];
        if (btn) {
          selectAthlete({
            name: btn.dataset.name || '',
            team: btn.dataset.team || ''
          });
        }
      } else if (e.key === 'Escape') {
        hideSuggestions();
      }
    });

    document.addEventListener('click', (e) => {
      if (!els.athleteSearch.contains(e.target) && !els.athleteSuggestions.contains(e.target)) {
        hideSuggestions();
      }
    });
  }

  bindEvents();
  loadSchedule();
}());
