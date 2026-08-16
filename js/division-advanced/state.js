export const state = {
  eventId: '',
  events: [],
  leaves: [],
  drawsState: null,
  templates: [],
  creationStatus: null,
  screen: 'wheel',
  wheelPhase: 'pick',
  targetGroupingId: '',
  selectedDrawId: '',
  selectedAthleteIndices: new Set(),
  drawSubtab: 'pool',
  drawDirty: false,
  filterDrawsToSolo: false,
  divisionMode: '',
  soloDivisionsCombined: false,
  savedDivisionTemplateName: ''
};

export function requireEvent() {
  if (!state.eventId) throw new Error('select an event first.');
  return state.eventId;
}

export function selectedDrawEntry() {
  return (state.drawsState?.catalog || []).find((e) => e.id === state.selectedDrawId) || null;
}

export function clearSelectedAthletes() {
  state.selectedAthleteIndices = new Set();
}
