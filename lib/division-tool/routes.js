const { createStore } = require('./store');
const {
  createAllDefaultDivisions,
  generateLeavesFromPattern,
  buildPatternConfigFromForm,
  getPatternFormDefaults,
  leavesForDbJson,
  leavesFromDbJson
} = require('./defaults');
const { normalizeAthletesFromRows, athletesByIndices, athleteSnapshot } = require('./athletes');
const { generateGroupings } = require('./groupings');
const { createDrawsFromGroupings, hydrateDrawCatalogAthletes, attachAthletesFromGroupings, moveAthleteBetweenDraws, rebuildDrawCatalogEntry } = require('./draws-types');
const { buildPdfFilesFromState } = require('./draws-pdf');
const { buildAllResultsPdf } = require('./results-pdf');
const { createPdfsZip } = require('./zip-export');
const {
  EVENT_COLUMNS,
  RANK_ORDER,
  DRAW_TYPE_OPTIONS,
  LIST_DRAW_TYPE_EVENT_KEYS,
  PATTERN_WEIGHT_CLASSES,
  PATTERN_HEIGHT_CLASSES,
  EVENT_DISPLAY_NAMES,
  ALL_RESULTS_PDF_FILENAME
} = require('./constants');
const { patternEventSkipsWeight, patternEventUsesHeight } = require('./utils');
const { swapSlots, plSetPoolCount, setEntryDrawType, refreshEntryFromJson } = require('./draw-edit');
const { syncScheduleFromDraws } = require('./schedule');

function registerDivisionAdvancedRoutes(app, db, middleware) {
  const { requireLogin, requirePrincipleUser, requirePrincipleUserAdvanced } = middleware;
  const store = createStore(db);

  async function syncEventScheduleFromDraws(eventId, clientId, drawsState) {
    if (!drawsState || !Array.isArray(drawsState.catalog)) return { scheduleSynced: false };
    try {
      const existing = await store.loadSchedule(eventId, clientId);
      const { state: scheduleState } = syncScheduleFromDraws(
        existing?.state || null,
        drawsState,
        { mode: existing?.state ? 'update' : 'create' }
      );
      await store.saveSchedule(eventId, clientId, scheduleState);
      return { scheduleSynced: true };
    } catch (err) {
      console.error('schedule sync after draws save failed:', err);
      return { scheduleSynced: false, scheduleSyncError: err.message || 'schedule sync failed' };
    }
  }

  app.get('/api/division-advanced/events', requireLogin, requirePrincipleUserAdvanced, (req, res) => {
    const clientId = req.session.clientId;
    const sql = `SELECT id, event_name, event_date_start, event_date_end, event_location, event_events
                 FROM events WHERE client_id = ? ORDER BY event_date_start ASC, event_name ASC`;
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
      if (store.isInternalEventLeavesNickname(nickname)) {
        return res.status(400).json({ error: 'That template name is reserved.' });
      }
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

  app.delete('/api/division-advanced/divisions/templates/:templateId', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const deleted = await store.deleteDivisionTemplate(req.params.templateId, req.session.clientId);
      if (!deleted) return res.status(404).json({ error: 'Template not found.' });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'Unable to delete template.' });
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

  app.post('/api/division-advanced/events/:eventId/divisions', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const owned = await store.verifyEventOwnership(eventId, clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });
      const leaves = req.body.leaves;
      if (!Array.isArray(leaves) || !leaves.length) {
        return res.status(400).json({ error: 'Leaves array is required.' });
      }
      const id = await store.saveEventDivisionLeaves(
        eventId,
        clientId,
        leavesForDbJson(leaves)
      );
      res.json({
        success: true,
        id,
        count: leaves.length
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to save event divisions.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/divisions', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const owned = await store.verifyEventOwnership(eventId, clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });
      const row = await store.findEventDivisionLeaves(eventId, clientId);
      if (!row) return res.json({ leaves: [], count: 0 });
      const leaves = leavesFromDbJson(row.leaves_json);
      res.json({ leaves, count: leaves.length, id: row.id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to load event divisions.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/creation-status', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const owned = await store.verifyEventOwnership(eventId, clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });
      const eventName = await store.getEventNickname(eventId, clientId);
      const [draws, template] = await Promise.all([
        store.loadDraws(eventId, clientId),
        store.findEventDivisionLeaves(eventId, clientId)
      ]);
      const catalog = draws?.state?.catalog || [];
      res.json({
        eventId,
        eventName: eventName || '',
        hasDraws: catalog.length > 0,
        drawCount: catalog.length,
        drawsWithAthletes: catalog.filter((e) => Number(e.athlete_count || 0) > 0).length,
        hasDivisions: Boolean(template),
        divisionCount: Number(template?.leaf_count || 0),
        templateId: template?.id || null
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to load creation status.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/draws', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const data = await store.loadDraws(req.params.eventId, req.session.clientId);
      if (!data) return res.json({ state: null });
      try {
        const rows = await store.fetchAthletesForEvent(req.params.eventId);
        const athletes = normalizeAthletesFromRows(rows);
        if (data.state) hydrateDrawCatalogAthletes(data.state, athletes);
      } catch (_) { /* athlete list is optional for viewing */ }
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Unable to load draws.' });
    }
  });

  app.put('/api/division-advanced/events/:eventId/draws', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const state = req.body.state;
      if (!state) return res.status(400).json({ error: 'State is required.' });
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const saved = await store.saveDraws(eventId, clientId, state);
      const scheduleMeta = await syncEventScheduleFromDraws(eventId, clientId, saved?.state || state);
      res.json({ ...(saved || {}), ...scheduleMeta });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to save draws.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/draws/create-from-divisions', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const owned = await store.verifyEventOwnership(eventId, clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      let leaves = req.body.leaves;
      if (!Array.isArray(leaves) || !leaves.length) {
        const template = await store.findEventDivisionLeaves(eventId, clientId);
        if (!template) {
          return res.status(400).json({ error: 'Save divisions for this event first.' });
        }
        leaves = leavesFromDbJson(template.leaves_json);
      }
      if (!Array.isArray(leaves) || !leaves.length) {
        return res.status(400).json({ error: 'Division leaves are required.' });
      }

      const rows = await store.fetchAthletesForEvent(eventId);
      const athletes = normalizeAthletesFromRows(rows);
      const groupingsState = generateGroupings(leaves, athletes, req.body.refDate || null);
      const drawsState = createDrawsFromGroupings(groupingsState);
      attachAthletesFromGroupings(drawsState, groupingsState);
      if (!(drawsState.catalog || []).length) {
        return res.status(400).json({
          error: 'No athletes matched the saved divisions, so no draws were created.'
        });
      }
      const saved = await store.saveDraws(eventId, clientId, drawsState);
      if (saved?.state) hydrateDrawCatalogAthletes(saved.state, athletes);
      // Fresh create always rebuilds the schedule for this event.
      let scheduleMeta = { scheduleSynced: false };
      try {
        const { state: scheduleState } = syncScheduleFromDraws(null, saved?.state || drawsState, {
          mode: 'create'
        });
        await store.saveSchedule(eventId, clientId, scheduleState);
        scheduleMeta = { scheduleSynced: true };
      } catch (schedErr) {
        console.error('schedule sync after draw create failed:', schedErr);
        scheduleMeta = {
          scheduleSynced: false,
          scheduleSyncError: schedErr.message || 'schedule sync failed'
        };
      }
      res.json({ ...(saved || { state: drawsState }), ...scheduleMeta });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to create draws.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/draws/move', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const owned = await store.verifyEventOwnership(eventId, clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      const { fromDivisionId, toDivisionId, athleteIndex } = req.body || {};
      if (!fromDivisionId || !toDivisionId || athleteIndex == null) {
        return res.status(400).json({ error: 'fromDivisionId, toDivisionId, and athleteIndex are required.' });
      }

      const loaded = await store.loadDraws(eventId, clientId);
      if (!loaded?.state) {
        return res.status(404).json({ error: 'No draws saved for this event.' });
      }
      const rows = await store.fetchAthletesForEvent(eventId);
      const athletes = normalizeAthletesFromRows(rows);
      hydrateDrawCatalogAthletes(loaded.state, athletes);
      const next = moveAthleteBetweenDraws(
        loaded.state,
        athletes,
        fromDivisionId,
        toDivisionId,
        Number(athleteIndex)
      );
      const saved = await store.saveDraws(eventId, clientId, next);
      if (saved?.state) hydrateDrawCatalogAthletes(saved.state, athletes);
      const scheduleMeta = await syncEventScheduleFromDraws(eventId, clientId, saved?.state || next);
      res.json({
        ...(saved || {
          state: {
            format_version: next.format_version || 1,
            catalog: (next.catalog || []).filter((e) => Number(e.athlete_count || 0) > 0)
          }
        }),
        ...scheduleMeta
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to move athlete.' });
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
      } else if (action === 'set_type') {
        error = setEntryDrawType(entry, req.body.drawType);
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

  app.get('/api/division-advanced/events/:eventId/draws/pdfs.zip', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const owned = await store.verifyEventOwnership(eventId, clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      const loaded = await store.loadDraws(eventId, clientId);
      const drawsState = loaded?.state;
      if (!drawsState || !(drawsState.catalog || []).some((e) => Number(e.athlete_count || 0) > 0)) {
        return res.status(404).json({ error: 'No draws available to download.' });
      }

      const eventName = await store.getEventName(eventId, clientId);
      const pdfFiles = await buildPdfFilesFromState(drawsState, { eventName: eventName || '' });
      if (!Object.keys(pdfFiles).length) {
        return res.status(404).json({ error: 'No draw PDFs could be built.' });
      }

      const zipBuffer = await createPdfsZip(pdfFiles);
      const filename = safeZipFilename(eventName, `event_${eventId}_draws`);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
      res.send(zipBuffer);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to create PDF download.' });
    }
  });

  function safePdfFilename(eventName, fallback) {
    const cleaned = String(eventName || '')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .slice(0, 100)
      .trim();
    const base = cleaned || String(fallback || 'results');
    return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
  }

  app.get('/api/division-advanced/results/events', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const clientId = req.session.clientId;
      const items = await store.listEventsWithResults(clientId);
      res.json({ clientId: String(clientId || ''), items });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to list events with results.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/results/meta', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const meta = await store.getDrawResultsMeta(eventId, clientId);
      if (!meta) return res.status(403).json({ error: 'Access denied.' });
      res.json(meta);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to load results status.' });
    }
  });

  app.get('/api/division-advanced/events/:eventId/results.pdf', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const owned = await store.verifyEventOwnership(eventId, clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      const results = await store.loadDrawResults(eventId, clientId);
      if (!results || !results.length) {
        return res.status(404).json({ error: 'No results available to download.' });
      }

      const eventName = await store.getEventName(eventId, clientId);
      const pdfBuffer = await buildAllResultsPdf(results, { eventName: eventName || '' });
      if (!pdfBuffer || !pdfBuffer.length) {
        return res.status(404).json({ error: 'No results PDF could be built.' });
      }

      const filename = safePdfFilename(
        eventName ? `${eventName}_results` : ALL_RESULTS_PDF_FILENAME,
        `event_${eventId}_results`
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to create results PDF.' });
    }
  });

  app.post('/api/division-advanced/events/:eventId/draws/regenerate', requireLogin, requirePrincipleUserAdvanced, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const clientId = req.session.clientId;
      const owned = await store.verifyEventOwnership(eventId, clientId);
      if (!owned) return res.status(403).json({ error: 'Access denied.' });

      const incoming = req.body.state;
      if (!incoming || !Array.isArray(incoming.catalog)) {
        return res.status(400).json({ error: 'Draw state with catalog is required.' });
      }

      const rows = await store.fetchAthletesForEvent(eventId);
      const athletes = normalizeAthletesFromRows(rows);
      const next = {
        format_version: incoming.format_version || 1,
        catalog: incoming.catalog.map((entry) => ({ ...entry }))
      };
      next.catalog.forEach((entry) => {
        const preserve = Boolean(entry.preserve_structure) && entry.json_data && typeof entry.json_data === 'object';
        delete entry.preserve_structure;
        delete entry._draw_slot_list;
        if (preserve) {
          const matched = athletesByIndices(athletes, entry.athlete_indices || []).map((a) => athleteSnapshot(a));
          entry.athletes = matched;
          entry.athlete_count = matched.length;
          refreshEntryFromJson(entry);
          return;
        }
        rebuildDrawCatalogEntry(entry, athletes);
      });
      next.catalog = next.catalog.filter(
        (e) => Number(e.athlete_count || 0) > 0 || (e.athlete_indices || []).length > 0
      );
      const saved = await store.saveDraws(eventId, clientId, next);
      if (saved?.state) hydrateDrawCatalogAthletes(saved.state, athletes);
      const scheduleMeta = await syncEventScheduleFromDraws(eventId, clientId, saved?.state || next);
      res.json({
        ...(saved || { state: { format_version: next.format_version, catalog: [] } }),
        ...scheduleMeta
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Unable to regenerate draws.' });
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
