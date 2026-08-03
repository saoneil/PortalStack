const { createStore } = require('./store');
const { createJob, getJob, runWorkflow } = require('./jobs');
const {
  createAllDefaultDivisions,
  generateLeavesFromPattern,
  buildPatternConfigFromForm,
  getPatternFormDefaults,
  leavesForDbJson,
  leavesFromDbJson
} = require('./defaults');
const { normalizeAthletesFromRows } = require('./athletes');
const { generateGroupings, buildGroupingsState, moveAthlete, hydrateAthletesFromGroupingsState } = require('./groupings');
const { createDrawsFromGroupings } = require('./draws-types');
const { buildDrawFilesFromState, buildPdfForCatalogEntry } = require('./draws-pdf');
const { createDrawsZip } = require('./zip-export');
const {
  EVENT_COLUMNS,
  RANK_ORDER,
  DRAW_TYPE_OPTIONS,
  LIST_DRAW_TYPE_EVENT_KEYS,
  PATTERN_WEIGHT_CLASSES,
  PATTERN_HEIGHT_CLASSES,
  EVENT_DISPLAY_NAMES
} = require('./constants');
const { patternEventSkipsWeight, patternEventUsesHeight } = require('./utils');
const { swapSlots, plSetPoolCount, refreshEntryFromJson } = require('./draw-edit');

function registerDivisionAdvancedRoutes(app, db, middleware) {
  const { requireLogin, requirePrincipleUserAdvanced } = middleware;
  const store = createStore(db);

  app.get('/api/division-advanced/events', requireLogin, requirePrincipleUserAdvanced, (req, res) => {
    const clientId = req.session.clientId;
    const sql = `SELECT id, event_name, event_date_start, event_date_end, event_location, event_events
                 FROM events WHERE client_id = ? ORDER BY event_date_start DESC, event_name ASC`;
    db.query(sql, [clientId], (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Unable to load events.' });
      }
      res.json(rows || []);
    });
  });

  app.get('/api/division-advanced/divisions/templates', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const templates = await store.listDivisionTemplates(req.session.clientId);
      res.json(templates);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to load division templates.' });
    }
  });

  app.get('/api/division-advanced/divisions/templates/:templateId', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const row = await store.getDivisionTemplate(req.params.templateId, req.session.clientId);
      if (!row) return res.status(404).json({ error: 'Template not found.' });
      const leaves = leavesFromDbJson(row.leaves_json);
      res.json({ ...row, leaves });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to load template.' });
    }
  });

  app.post('/api/division-advanced/divisions/templates', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const nickname = String(req.body.nickname || '').trim();
      const leaves = req.body.leaves;
      if (!nickname) return res.status(400).json({ error: 'Nickname is required.' });
      if (!Array.isArray(leaves)) return res.status(400).json({ error: 'Leaves array is required.' });
      const id = await store.saveDivisionTemplate(
        req.session.clientId,
        nickname,
        leavesForDbJson(leaves),
        req.body.overwriteId || null
      );
      res.json({ success: true, id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to save template.' });
    }
  });

  app.post('/api/division-advanced/divisions/create-all-defaults', requireLogin, requirePrincipleUserAdvanced, (req, res) => {
    const { leaves, failures, count } = createAllDefaultDivisions();
    res.json({ leaves, failures, count });
  });

  app.get('/api/division-advanced/divisions/pattern-defaults', requireLogin, requirePrincipleUserAdvanced, (req, res) => {
    const eventKey = String(req.query.eventKey || EVENT_COLUMNS[0]).trim();
    const belt = String(req.query.belt || 'color').trim().toLowerCase();
    if (!EVENT_COLUMNS.includes(eventKey)) {
      return res.status(400).json({ error: 'Invalid event key.' });
    }
    if (!['color', 'black'].includes(belt)) {
      return res.status(400).json({ error: 'Belt must be color or black.' });
    }
    res.json(getPatternFormDefaults(eventKey, belt));
  });

  app.post('/api/division-advanced/divisions/generate-pattern', requireLogin, requirePrincipleUserAdvanced, (req, res) => {
    try {
      const body = req.body || {};
      const hasCustomForm = Boolean(
        body.ageSpecs?.length || body.rankSpecs?.length || body.genders
        || body.weight || body.height || body.drawType
      );
      let payload = body;
      if (!hasCustomForm) {
        const eventKey = String(body.eventKey || EVENT_COLUMNS[0]).trim();
        const belt = String(body.belt || 'color').trim().toLowerCase();
        const defaults = getPatternFormDefaults(eventKey, belt);
        const genders = [];
        if (defaults.genders?.male) genders.push('M');
        if (defaults.genders?.female) genders.push('F');
        payload = {
          eventKey,
          belt,
          drawType: defaults.drawType,
          genders,
          ageSpecs: defaults.ageSpecs,
          rankSpecs: defaults.rankSpecs,
          weight: defaults.weight,
          height: defaults.height
        };
      }
      const config = buildPatternConfigFromForm(payload);
      const leaves = generateLeavesFromPattern(config);
      res.json({ leaves, count: leaves.length, config });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to generate pattern.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/athletes', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const owned = await store.verifyEventOwnership(eventId, req.session.clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });
      const rows = await store.fetchAthletesForEvent(eventId);
      const athletes = normalizeAthletesFromRows(rows);
      res.json({ athletes, count: athletes.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to load athletes.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/groupings', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const data = await store.loadGroupings(req.params.eventId, req.session.clientId);
      if (!data) return res.json({ state: null });
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to load groupings.' });
    }
  });

  app.get('/api/division-advanced/groupings/saved', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const items = await store.listSavedGroupings(req.session.clientId);
      res.json({ items });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to list saved groupings.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/groupings/import', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const targetEventId = req.params.eventId;
      const sourceEventId = String(req.body?.sourceEventId || '').trim();
      if (!sourceEventId) {
        return res.status(400).json({ error: 'sourceEventId is required.' });
      }
      const clientId = req.session.clientId;
      const targetOwned = await store.verifyEventOwnership(targetEventId, clientId);
      if (!targetOwned) return res.status(403).json({ error: 'Access denied.' });

      const source = await store.loadGroupings(sourceEventId, clientId);
      if (!source || !source.state) {
        return res.status(404).json({ error: 'No saved groupings found for that event.' });
      }

      // Copy onto the currently selected event so move/edit APIs keep working.
      const saved = sourceEventId === String(targetEventId)
        ? source
        : await store.saveGroupings(targetEventId, clientId, source.state);

      res.json({
        ...saved,
        importedFromEventId: sourceEventId,
        copied: sourceEventId !== String(targetEventId)
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to import groupings.' });
    }
  });

  app.put('/api/division-advanced/events/:eventId/groupings', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const state = req.body.state;
      if (!state) return res.status(400).json({ error: 'State is required.' });
      const saved = await store.saveGroupings(req.params.eventId, req.session.clientId, state);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to save groupings.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/groupings/generate', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const owned = await store.verifyEventOwnership(eventId, req.session.clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });
      const leaves = req.body.leaves;
      if (!Array.isArray(leaves) || !leaves.length) {
        return res.status(400).json({ error: 'Division leaves are required.' });
      }
      let athletes;
      if (Array.isArray(req.body.athletes) && req.body.athletes.length) {
        athletes = normalizeAthletesFromRows(req.body.athletes);
      } else {
        const rows = await store.fetchAthletesForEvent(eventId);
        athletes = normalizeAthletesFromRows(rows);
      }
      const state = generateGroupings(leaves, athletes, req.body.refDate || null);
      res.json({ state });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to generate groupings.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/groupings/move', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const { fromDivisionId, toDivisionId, athleteIndex } = req.body || {};
      let working = req.body.state;
      if (!working) {
        const loaded = await store.loadGroupings(req.params.eventId, req.session.clientId);
        if (!loaded || !loaded.state) {
          return res.status(404).json({ error: 'No groupings in session or saved for this event.' });
        }
        working = loaded.state;
      }
      const state = moveAthlete(working, fromDivisionId, toDivisionId, Number(athleteIndex));
      res.json({ state });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to move athlete.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/draws', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const data = await store.loadDraws(req.params.eventId, req.session.clientId);
      if (!data) return res.json({ state: null });
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to load draws.' });
    }
  });

  app.get('/api/division-advanced/draws/saved', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const items = await store.listSavedDraws(req.session.clientId);
      res.json({ items });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to list saved draws.' });
    }
  });

  app.put('/api/division-advanced/events/:eventId/draws', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const state = req.body.state;
      if (!state) return res.status(400).json({ error: 'State is required.' });
      const saved = await store.saveDraws(req.params.eventId, req.session.clientId, state);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to save draws.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/draws/generate', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const owned = await store.verifyEventOwnership(eventId, req.session.clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      let groupingsState = req.body.groupingsState;
      if (!groupingsState) {
        const loaded = await store.loadGroupings(eventId, req.session.clientId);
        if (!loaded || !loaded.state) {
          return res.status(400).json({ error: 'Generate groupings first.' });
        }
        groupingsState = loaded.state;
      }

      const drawsState = createDrawsFromGroupings(groupingsState);
      res.json({ state: drawsState });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to generate draws.' });
    }
  });

  app.post('/api/division-advanced/draws/edit', requireLogin, requirePrincipleUserAdvanced, (req, res) => {
    try {
      const entry = req.body.entry;
      if (!entry || typeof entry !== 'object') {
        return res.status(400).json({ error: 'Draw entry is required.' });
      }
      const action = String(req.body.action || '').trim();
      let error = null;
      if (action === 'swap') {
        error = swapSlots(entry, req.body.sourceSlotId, req.body.targetSlotId);
      } else if (action === 'set_pool_count') {
        error = plSetPoolCount(entry, Number(req.body.poolCount));
      } else if (action === 'refresh') {
        // no-op mutate path
      } else {
        return res.status(400).json({ error: 'Unknown edit action.' });
      }
      if (error) return res.status(400).json({ error });
      const refreshed = refreshEntryFromJson(entry);
      res.json({
        entry: refreshed.entry,
        slots: refreshed.slots
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to edit draw.' });
    }
  });

  app.post('/api/division-advanced/draws/preview.pdf', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const entry = req.body.entry;
      if (!entry || typeof entry !== 'object') {
        return res.status(400).json({ error: 'Draw entry is required.' });
      }
      const pdfBytes = await buildPdfForCatalogEntry(entry);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
      res.send(Buffer.from(pdfBytes));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to build PDF preview.' });
    }
  });

  function safeZipFilename(name, fallback) {
    const cleaned = String(name || '')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .slice(0, 120)
      .trim();
    const base = cleaned || String(fallback || 'draws');
    return base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`;
  }

  async function sendDrawsZip(res, eventId, drawsState, clientId) {
    const { plainFiles, pdfFiles } = await buildDrawFilesFromState(drawsState);
    const zipBuffer = await createDrawsZip(plainFiles, pdfFiles);
    const eventName = clientId
      ? await store.getEventName(eventId, clientId)
      : null;
    const filename = safeZipFilename(eventName, `event_${eventId}_draws`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.send(zipBuffer);
  }

  app.get('/api/division-advanced/events/:eventId/draws/download.zip', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const loaded = await store.loadDraws(eventId, req.session.clientId);
      if (!loaded || !loaded.state) {
        return res.status(404).json({ error: 'No draws saved for this event.' });
      }
      await sendDrawsZip(res, eventId, loaded.state, req.session.clientId);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to create download.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/draws/download.zip', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const owned = await store.verifyEventOwnership(eventId, req.session.clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });
      let drawsState = req.body.state;
      if (!drawsState) {
        const loaded = await store.loadDraws(eventId, req.session.clientId);
        drawsState = loaded?.state;
      }
      if (!drawsState) {
        return res.status(404).json({ error: 'No draws available to download.' });
      }
      await sendDrawsZip(res, eventId, drawsState, req.session.clientId);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to create download.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/schedule', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const data = await store.loadSchedule(req.params.eventId, req.session.clientId);
      if (!data) return res.json({ state: null });
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to load schedule.' });
    }
  });

  app.get('/api/division-advanced/schedules/saved', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const items = await store.listSavedSchedules(req.session.clientId);
      res.json({ items });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to list saved schedules.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/schedule/generate', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const owned = await store.verifyEventOwnership(eventId, req.session.clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      let drawsState = req.body.drawsState;
      if (!drawsState) {
        const loaded = await store.loadDraws(eventId, req.session.clientId);
        if (!loaded?.state) {
          return res.status(400).json({ error: 'Generate draws first.' });
        }
        drawsState = loaded.state;
      }

      let groupingsState = req.body.groupingsState || null;
      if (!groupingsState) {
        try {
          const loadedG = await store.loadGroupings(eventId, req.session.clientId);
          groupingsState = loadedG?.state || null;
        } catch (_) {
          groupingsState = null;
        }
      }

      const { createScheduleFromDraws, DEFAULT_RING_COUNT } = require('./schedule');
      const ringCount = Number(req.body.ringCount) || DEFAULT_RING_COUNT;
      const autoPlace = req.body.autoPlace !== false;
      const { state, placed, skipped } = createScheduleFromDraws(drawsState, {
        ringCount,
        groupingsState,
        autoPlace
      });
      res.json({ state, placed, skipped });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to generate schedule.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/schedule/pack', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const owned = await store.verifyEventOwnership(eventId, req.session.clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      const scheduleState = req.body.state;
      if (!scheduleState) return res.status(400).json({ error: 'State is required.' });

      const { placeDivisionIds, ensurePackOrder } = require('./schedule');
      let next = ensurePackOrder(scheduleState);
      const divisionIds = Array.isArray(req.body.divisionIds)
        ? req.body.divisionIds.map(String)
        : (next.pack_order || (next.catalog || []).map((e) => String(e.id)));
      const replaceExisting = req.body.replaceExisting !== false;
      const startDayIndex = Number(req.body.startDayIndex);
      const dayOnly = req.body.dayOnly === true;
      const packed = placeDivisionIds(next, divisionIds, {
        replaceExisting,
        startDayIndex: Number.isFinite(startDayIndex) ? startDayIndex : 0,
        dayOnly
      });
      res.json({
        state: packed.state,
        placed: packed.placed,
        skipped: packed.skipped
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to pack schedule.' });
    }
  });

  app.put('/api/division-advanced/events/:eventId/schedule', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const scheduleState = req.body.state;
      if (!scheduleState) return res.status(400).json({ error: 'State is required.' });
      const saved = await store.saveSchedule(req.params.eventId, req.session.clientId, scheduleState);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to save schedule.' });
    }
  });

  app.delete('/api/division-advanced/events/:eventId/profile-files', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const result = await store.deleteProfileFilesForEvent(req.params.eventId, req.session.clientId);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error(err);
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'Unable to remove profile files.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/workflow/run', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const owned = await store.verifyEventOwnership(eventId, req.session.clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });
      const job = createJob(req.sessionID, { eventId, clientId: req.session.clientId });
      setImmediate(() => {
        runWorkflow(job.id, store, req.session.clientId, eventId, req.body.refDate || null);
      });
      res.json({ jobId: job.id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to start workflow.' });
    }
  });

  app.get('/api/division-advanced/jobs/:jobId', requireLogin, requirePrincipleUserAdvanced, (req, res) => {
    const job = getJob(req.params.jobId, req.sessionID);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    res.json(job);
  });

  app.get('/api/division-advanced/meta', requireLogin, requirePrincipleUserAdvanced, (req, res) => {
    res.json({
      eventColumns: EVENT_COLUMNS,
      eventDisplayNames: EVENT_DISPLAY_NAMES,
      rankOrder: RANK_ORDER,
      drawTypeOptions: DRAW_TYPE_OPTIONS,
      listDrawTypeEventKeys: [...LIST_DRAW_TYPE_EVENT_KEYS],
      patternWeightClasses: PATTERN_WEIGHT_CLASSES,
      patternHeightClasses: PATTERN_HEIGHT_CLASSES,
      patternEventSkipsWeight: EVENT_COLUMNS.filter((ek) => patternEventSkipsWeight(ek)),
      patternEventUsesHeight: EVENT_COLUMNS.filter((ek) => patternEventUsesHeight(ek))
    });
  });
}

function createRequirePrincipleUser(lookupUserFlagsFn) {
  return function requirePrincipleUser(req, res, next) {
    if (Number(req.session.principleUser) === 1) {
      next();
      return;
    }
    const username = req.session.username;
    const clientId = req.session.clientId;
    lookupUserFlagsFn(username, clientId, (flags) => {
      req.session.principleUser = flags.principleUser;
      req.session.principleUserAdvanced = flags.principleUserAdvanced;
      if (Number(flags.principleUser) === 1) {
        next();
      } else {
        res.status(403).json({ error: 'Principle user access required.' });
      }
    });
  };
}

function createRequirePrincipleUserAdvanced(lookupUserFlagsFn) {
  return function requirePrincipleUserAdvanced(req, res, next) {
    if (Number(req.session.principleUserAdvanced) === 1) {
      next();
      return;
    }
    const username = req.session.username;
    const clientId = req.session.clientId;
    lookupUserFlagsFn(username, clientId, (flags) => {
      req.session.principleUser = flags.principleUser;
      req.session.principleUserAdvanced = flags.principleUserAdvanced;
      if (Number(flags.principleUserAdvanced) === 1) {
        next();
      } else {
        res.status(403).json({ error: 'Advanced division tool access required.' });
      }
    });
  };
}

module.exports = {
  registerDivisionAdvancedRoutes,
  createRequirePrincipleUser,
  createRequirePrincipleUserAdvanced
};
