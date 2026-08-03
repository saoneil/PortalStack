export const state = {
  eventId: '',
  events: [],
  leaves: [],
  athletes: [],
  groupingsState: null,
  drawsState: null,
  scheduleState: null,
  templates: [],
  selectedGroupingId: '',
  targetGroupingId: '',
  selectedDrawId: '',
  selectedAthleteIndex: null,
  groupingFilter: '',
  groupingAthleteFilter: '',
  groupingEventFilter: '',
  groupingTypeFilter: '',
  groupingSort: 'name',
  athleteFilter: '',
  drawSubtab: 'text',
  drawSlots: [],
  drawDirty: false,
  drawSnapshot: null,
  scheduleSelectedIds: new Set(),
  scheduleUiBound: false
};

export function getEventId() {
  return state.eventId;
}

export function requireEvent() {
  if (!state.eventId) throw new Error('select an event first.');
  return state.eventId;
}

export function selectedDrawEntry() {
  return (state.drawsState?.catalog || []).find((e) => e.id === state.selectedDrawId) || null;
}
