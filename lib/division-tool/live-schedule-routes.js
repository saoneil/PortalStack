const { createStore } = require('./store');
const { placeDivisionIds, ensurePackOrder, clampScheduleToBounds } = require('./schedule');

function sanitizeScheduleState(state) {
  if (!state || typeof state !== 'object') return state;
  const clone = JSON.parse(JSON.stringify(state));
  (clone.catalog || []).forEach((entry) => {
    if (entry && typeof entry === 'object') {
      delete entry.athletes;
    }
  });
  return clone;
}

function registerLiveScheduleRoutes(app, db, middleware) {
  const { requireLogin, requirePrincipleUserAdvanced, liveScheduleLimiter } = middleware;
  const store = createStore(db);

  function clientIdsMatch(sessionClientId, urlClientId) {
    return String(sessionClientId) === String(urlClientId);
  }

  function resolveCanEdit(req, clientId) {
    return Boolean(
      req.session
      && req.session.loggedIn
      && clientIdsMatch(req.session.clientId, clientId)
      && Number(req.session.principleUserAdvanced) === 1
    );
  }

  app.get('/api/live-schedule/saved', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const items = await store.listSavedSchedules(req.session.clientId);
      res.json({
        clientId: String(req.session.clientId),
        items: items || []
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to list saved schedules.' });
    }
  });

  app.get('/api/live-schedule/:clientId/:eventId', liveScheduleLimiter, async (req, res) => {
    try {
      const clientId = req.params.clientId;
      const eventId = req.params.eventId;
      const loaded = await store.loadPublicSchedule(clientId, eventId);
      if (!loaded) {
        return res.status(404).json({ error: 'Schedule not found for this client and event.' });
      }

      let canEdit = resolveCanEdit(req, clientId);
      if (
        req.session
        && req.session.loggedIn
        && clientIdsMatch(req.session.clientId, clientId)
        && !canEdit
        && typeof middleware.lookupUserFlags === 'function'
      ) {
        await new Promise((resolve) => {
          middleware.lookupUserFlags(req.session.username, req.session.clientId, (flags) => {
            req.session.principleUser = flags.principleUser;
            req.session.principleUserAdvanced = flags.principleUserAdvanced;
            canEdit = Number(flags.principleUserAdvanced) === 1;
            resolve();
          });
        });
      }

      const stateTimezone = loaded.state && typeof loaded.state.timezone === 'string'
        ? loaded.state.timezone
        : null;
      const sessionTimezone = req.session && req.session.timezone
        ? req.session.timezone
        : null;
      const timezone = (canEdit && sessionTimezone) || stateTimezone || sessionTimezone || null;

      res.json({
        event: loaded.event,
        state: sanitizeScheduleState(loaded.state),
        format_version: loaded.format_version,
        updated_at: loaded.updated_at,
        canEdit,
        timezone
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to load live schedule.' });
    }
  });

  app.put('/api/live-schedule/:clientId/:eventId', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const clientId = req.params.clientId;
      const eventId = req.params.eventId;
      if (!clientIdsMatch(req.session.clientId, clientId)) {
        return res.status(403).json({ error: 'Access denied for this client.' });
      }
      let scheduleState = req.body.state;
      if (!scheduleState) return res.status(400).json({ error: 'State is required.' });
      if (req.session.timezone && !scheduleState.timezone) {
        scheduleState.timezone = req.session.timezone;
      }
      scheduleState = clampScheduleToBounds(scheduleState);
      const saved = await store.saveSchedule(eventId, req.session.clientId, scheduleState);
      res.json({
        state: sanitizeScheduleState(saved.state),
        format_version: saved.format_version,
        updated_at: saved.updated_at,
        canEdit: true,
        timezone: (saved.state && saved.state.timezone) || req.session.timezone || null
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to save live schedule.' });
    }
  });

  app.post('/api/live-schedule/:clientId/:eventId/pack', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const clientId = req.params.clientId;
      const eventId = req.params.eventId;
      if (!clientIdsMatch(req.session.clientId, clientId)) {
        return res.status(403).json({ error: 'Access denied for this client.' });
      }
      const owned = await store.verifyEventOwnership(eventId, req.session.clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      const scheduleState = req.body.state;
      if (!scheduleState) return res.status(400).json({ error: 'State is required.' });

      let next = clampScheduleToBounds(ensurePackOrder(scheduleState));
      const rawIds = req.body.divisionIds;
      let divisionIds;
      if (rawIds === 'all' || rawIds == null) {
        divisionIds = next.pack_order || (next.catalog || []).map((e) => String(e.id));
      } else if (Array.isArray(rawIds)) {
        divisionIds = rawIds.map(String);
      } else {
        return res.status(400).json({ error: 'divisionIds must be an array or "all".' });
      }
      const replaceExisting = req.body.replaceExisting !== false;
      const startDayIndex = Number(req.body.startDayIndex);
      const dayOnly = req.body.dayOnly === true;
      const packed = placeDivisionIds(next, divisionIds, {
        replaceExisting,
        startDayIndex: Number.isFinite(startDayIndex) ? startDayIndex : 0,
        dayOnly
      });

      res.json({
        state: sanitizeScheduleState(packed.state),
        placed: packed.placed,
        skipped: packed.skipped
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to pack schedule.' });
    }
  });
}

module.exports = { registerLiveScheduleRoutes };
