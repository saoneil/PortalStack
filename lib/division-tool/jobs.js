const crypto = require('crypto');
const { createAllDefaultDivisions } = require('./defaults');
const { normalizeAthletesFromRows } = require('./athletes');
const { generateGroupings } = require('./groupings');
const { createDrawsFromGroupings } = require('./draws-types');
const { createScheduleFromDraws, DEFAULT_RING_COUNT } = require('./schedule');

const jobs = new Map();

function newJobId() {
  return crypto.randomBytes(16).toString('hex');
}

function createJob(sessionId, meta = {}) {
  const id = newJobId();
  const job = {
    id,
    sessionId,
    status: 'running',
    step: 'starting',
    progress: 0,
    message: 'Starting…',
    result: null,
    error: null,
    createdAt: Date.now(),
    ...meta
  };
  jobs.set(id, job);
  return job;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

function getJob(id, sessionId) {
  const job = jobs.get(id);
  if (!job || job.sessionId !== sessionId) return null;
  return job;
}

function cleanupOldJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  jobs.forEach((job, id) => {
    if (job.createdAt < cutoff) jobs.delete(id);
  });
}

setInterval(cleanupOldJobs, 15 * 60 * 1000);

async function runWorkflow(jobId, store, clientId, eventId, refDate) {
  try {
    updateJob(jobId, { step: 'divisions', progress: 8, message: 'Creating default divisions…' });
    const { leaves, failures, count } = createAllDefaultDivisions();

    updateJob(jobId, { step: 'athletes', progress: 24, message: 'Importing athletes from registration…' });
    const rows = await store.fetchAthletesForEvent(eventId);
    const athletes = normalizeAthletesFromRows(rows);

    updateJob(jobId, { step: 'groupings', progress: 42, message: 'Generating groupings…' });
    const groupingsState = generateGroupings(leaves, athletes, refDate);

    updateJob(jobId, { step: 'draws', progress: 62, message: 'Creating draws…' });
    const drawsState = createDrawsFromGroupings(groupingsState);

    updateJob(jobId, { step: 'schedule', progress: 82, message: 'Building schedule (3 rings)…' });
    const { state: scheduleState, placed, skipped } = createScheduleFromDraws(drawsState, {
      ringCount: DEFAULT_RING_COUNT,
      groupingsState
    });

    updateJob(jobId, {
      status: 'complete',
      step: 'done',
      progress: 100,
      message: 'Workflow complete.',
      result: {
        leaves,
        athletes,
        groupingsState,
        drawsState,
        scheduleState,
        divisionCount: count,
        athleteCount: athletes.length,
        groupingCount: groupingsState.catalog.length,
        drawCount: drawsState.catalog.filter((e) => e.athlete_count > 0).length,
        schedulePlaced: placed,
        scheduleSkipped: skipped,
        scheduleRings: scheduleState.ring_count,
        failures
      }
    });
  } catch (err) {
    updateJob(jobId, {
      status: 'error',
      error: err.message || String(err),
      message: err.message || 'Workflow failed.'
    });
  }
}

module.exports = {
  createJob,
  updateJob,
  getJob,
  runWorkflow
};
