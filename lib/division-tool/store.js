const { promisify } = require('util');

const CATEGORY_ID_MAX = 255;
const INSERT_BATCH_SIZE = 40;

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function jsonParam(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function uniqueCategoryId(entry, index, used) {
  let id = String(entry?.id || '').trim();
  if (!id) id = String(entry?.division_name || '').trim() || `division_${index + 1}`;
  id = id.slice(0, CATEGORY_ID_MAX);
  const base = id;
  let n = 2;
  while (used.has(id)) {
    const suffix = `_${n}`;
    id = `${base.slice(0, CATEGORY_ID_MAX - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function latestTimestamp(rows, field = 'updated_at') {
  let latest = null;
  (rows || []).forEach((row) => {
    const value = row?.[field];
    if (!value) return;
    if (!latest || new Date(value) > new Date(latest)) latest = value;
  });
  return latest;
}

function rowToDrawCatalogEntry(row) {
  return {
    id: row.category_id,
    division_name: row.division_name || row.category_id,
    division_type: row.division_type || '',
    event_key: row.event_key || '',
    athlete_count: Number(row.athlete_count || 0),
    athlete_indices: parseJson(row.athlete_indices) || [],
    body_text: row.body_text || '',
    json_data: parseJson(row.state_json),
    draw_dirty: false
  };
}

function createStore(db) {
  const query = promisify(db.query).bind(db);

  function getConnection() {
    return new Promise((resolve, reject) => {
      db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
    });
  }

  async function withTransaction(work) {
    const conn = await getConnection();
    const txQuery = promisify(conn.query).bind(conn);
    const begin = promisify(conn.beginTransaction).bind(conn);
    const commit = promisify(conn.commit).bind(conn);
    const rollback = promisify(conn.rollback).bind(conn);
    try {
      await begin();
      const result = await work(txQuery);
      await commit();
      return result;
    } catch (err) {
      try {
        await rollback();
      } catch (_) {
        /* ignore rollback errors */
      }
      throw err;
    } finally {
      conn.release();
    }
  }

  async function insertParamRows(txQuery, sqlPrefix, rowSql, paramRows) {
    for (let i = 0; i < paramRows.length; i += INSERT_BATCH_SIZE) {
      const batch = paramRows.slice(i, i + INSERT_BATCH_SIZE);
      const placeholders = batch.map(() => rowSql).join(', ');
      await txQuery(`${sqlPrefix} ${placeholders}`, batch.flat());
    }
  }

  async function verifyEventOwnership(eventId, clientId) {
    const rows = await query(
      'SELECT id FROM events WHERE id = ? AND client_id = ? LIMIT 1',
      [eventId, clientId]
    );
    return rows && rows.length > 0;
  }

  async function getEventName(eventId, clientId) {
    const rows = await query(
      'SELECT event_name FROM events WHERE id = ? AND client_id = ? LIMIT 1',
      [eventId, clientId]
    );
    if (!rows || !rows.length) return null;
    const name = String(rows[0].event_name || '').trim();
    return name || null;
  }

  async function getEventNickname(eventId, clientId) {
    const name = await getEventName(eventId, clientId);
    return name || `event_${eventId}`;
  }

  async function loadDraws(eventId, clientId) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) return null;
    const rows = await query(
      `SELECT category_id, division_name, division_type, event_key, athlete_count,
              format_version, body_text, athlete_indices, state_json, updated_at
       FROM draws
       WHERE event_id = ? AND client_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [eventId, clientId]
    );
    if (!rows || !rows.length) return null;
    const first = rows[0];
    const state = {
      format_version: Number(first.format_version || 1),
      catalog: rows.map(rowToDrawCatalogEntry)
    };
    return {
      state,
      format_version: state.format_version,
      updated_at: latestTimestamp(rows)
    };
  }

  function drawHasAthletes(entry) {
    if (Number(entry?.athlete_count || 0) > 0) return true;
    return Array.isArray(entry?.athlete_indices) && entry.athlete_indices.length > 0;
  }

  async function saveDraws(eventId, clientId, state) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) throw new Error('Event not found or access denied.');
    const catalog = (Array.isArray(state?.catalog) ? state.catalog : []).filter(drawHasAthletes);
    const formatVersion = state?.format_version || 1;
    const usedIds = new Set();
    const paramRows = catalog.map((entry, index) => {
      const categoryId = uniqueCategoryId(entry, index, usedIds);
      const athleteIndices = Array.isArray(entry.athlete_indices) ? entry.athlete_indices : [];
      return [
        clientId,
        eventId,
        categoryId,
        String(entry.division_name || categoryId).slice(0, 500),
        String(entry.division_type || '').slice(0, 64),
        String(entry.event_key || '').slice(0, 64),
        Number(entry.athlete_count || athleteIndices.length || 0),
        index,
        formatVersion,
        entry.body_text || '',
        jsonParam(athleteIndices),
        jsonParam(entry.json_data)
      ];
    });

    await withTransaction(async (txQuery) => {
      await txQuery(
        'DELETE FROM draws WHERE event_id = ? AND client_id = ?',
        [eventId, clientId]
      );
      if (!paramRows.length) return;
      await insertParamRows(
        txQuery,
        `INSERT INTO draws (
           client_id, event_id, category_id, division_name, division_type, event_key,
           athlete_count, sort_order, format_version,
           body_text, athlete_indices, state_json
         ) VALUES`,
        '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))',
        paramRows
      );
    });
    return loadDraws(eventId, clientId);
  }

  async function loadSchedule(eventId, clientId) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) return null;
    const rows = await query(
      'SELECT state_json, format_version, updated_at FROM schedules WHERE event_id = ? AND client_id = ? LIMIT 1',
      [eventId, clientId]
    );
    if (!rows || !rows.length) return null;
    const row = rows[0];
    let state = row.state_json;
    if (typeof state === 'string') state = JSON.parse(state);
    return { state, format_version: row.format_version, updated_at: row.updated_at };
  }

  async function loadPublicSchedule(clientId, eventId) {
    const rows = await query(
      `SELECT s.state_json, s.format_version, s.updated_at,
              e.event_name, e.event_date_start, e.event_date_end, e.event_location
       FROM schedules s
       INNER JOIN events e
         ON e.id = s.event_id AND e.client_id = s.client_id
       WHERE s.client_id = ? AND s.event_id = ?
       LIMIT 1`,
      [clientId, eventId]
    );
    if (!rows || !rows.length) return null;
    const row = rows[0];
    let state = row.state_json;
    if (typeof state === 'string') state = JSON.parse(state);
    return {
      state,
      format_version: row.format_version,
      updated_at: row.updated_at,
      event: {
        id: String(eventId),
        clientId: String(clientId),
        name: row.event_name || `event ${eventId}`,
        dateStart: row.event_date_start || null,
        dateEnd: row.event_date_end || null,
        location: row.event_location || null
      }
    };
  }

  async function listSavedSchedules(clientId) {
    const rows = await query(
      `SELECT s.event_id AS eventId,
              s.updated_at AS updatedAt,
              s.format_version AS formatVersion,
              e.event_name AS eventName,
              e.event_date_start AS eventDateStart
       FROM schedules s
       INNER JOIN events e
         ON e.id = s.event_id AND e.client_id = s.client_id
       WHERE s.client_id = ?
       ORDER BY s.updated_at DESC, e.event_date_start DESC, e.event_name ASC`,
      [clientId]
    );
    return (rows || []).map((row) => ({
      eventId: String(row.eventId),
      eventName: row.eventName || `event ${row.eventId}`,
      eventDateStart: row.eventDateStart || null,
      updatedAt: row.updatedAt || null,
      formatVersion: row.formatVersion
    }));
  }

  async function saveSchedule(eventId, clientId, state) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) throw new Error('Event not found or access denied.');
    const json = JSON.stringify(state);
    await query(
      `INSERT INTO schedules (client_id, event_id, format_version, state_json)
       VALUES (?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         state_json = VALUES(state_json),
         format_version = VALUES(format_version),
         client_id = VALUES(client_id),
         updated_at = CURRENT_TIMESTAMP`,
      [clientId, eventId, state.format_version || 5, json]
    );
    return loadSchedule(eventId, clientId);
  }

  async function fetchAthletesForEvent(eventId) {
    const rows = await query(
      `SELECT first_name, last_name, dob, \`rank\`, gender, weight_kg, height_kg AS height_cm,
              team_name_or_country,
              individual_patterns, individual_sparring, individual_special_technique, individual_power_test,
              team_patterns, team_sparring, team_special_technique, team_power_test, pre_arranged_sparring
       FROM registration
       WHERE event_id = ? AND LOWER(role) = 'athlete'
       ORDER BY last_name ASC, first_name ASC, id ASC`,
      [eventId]
    );
    return rows || [];
  }

  async function listDivisionTemplates(clientId) {
    const rows = await query(
      `SELECT id, nickname, leaf_count, format_version, updated_at
       FROM divisions
       WHERE client_id = ?
       ORDER BY nickname ASC, id ASC`,
      [clientId]
    );
    return (rows || []).filter((row) => !isInternalEventLeavesNickname(row.nickname));
  }

  async function getDivisionTemplate(templateId, clientId) {
    const rows = await query(
      `SELECT id, client_id, nickname, leaves_json, leaf_count, format_version
       FROM divisions WHERE id = ? AND client_id = ? LIMIT 1`,
      [templateId, clientId]
    );
    if (!rows || !rows.length) return null;
    return rows[0];
  }

  async function saveDivisionTemplate(clientId, nickname, leaves, overwriteId = null) {
    const leavesJson = JSON.stringify(leaves);
    const leafCount = leaves.length;
    if (overwriteId) {
      await query(
        `UPDATE divisions SET nickname = ?, leaves_json = CAST(? AS JSON), leaf_count = ?, format_version = ?
         WHERE id = ? AND client_id = ?`,
        [nickname, leavesJson, leafCount, 1, overwriteId, clientId]
      );
      return overwriteId;
    }
    const result = await query(
      `INSERT INTO divisions (client_id, nickname, leaves_json, leaf_count, format_version)
       VALUES (?, ?, CAST(? AS JSON), ?, ?)`,
      [clientId, nickname, leavesJson, leafCount, 1]
    );
    return result.insertId;
  }

  async function findDivisionTemplateByNickname(clientId, nickname) {
    const name = String(nickname || '').trim();
    if (!name) return null;
    const rows = await query(
      `SELECT id, client_id, nickname, leaves_json, leaf_count, format_version
       FROM divisions
       WHERE client_id = ? AND LOWER(TRIM(nickname)) = LOWER(?)
       LIMIT 1`,
      [clientId, name]
    );
    if (!rows || !rows.length) return null;
    return rows[0];
  }

  /** Working division leaves for an event (not shown in reusable template list). */
  function eventLeavesNickname(eventId) {
    return `__event__:${eventId}`;
  }

  function isInternalEventLeavesNickname(nickname) {
    return String(nickname || '').trim().toLowerCase().startsWith('__event__:');
  }

  /**
   * Load persisted leaves for an event.
   * Prefers `__event__:{id}`; falls back to legacy nickname = event name.
   */
  async function findEventDivisionLeaves(eventId, clientId) {
    const primary = await findDivisionTemplateByNickname(clientId, eventLeavesNickname(eventId));
    if (primary) return primary;
    const eventName = await getEventNickname(eventId, clientId);
    if (!eventName || isInternalEventLeavesNickname(eventName)) return null;
    return findDivisionTemplateByNickname(clientId, eventName);
  }

  async function saveEventDivisionLeaves(eventId, clientId, leaves) {
    const nickname = eventLeavesNickname(eventId);
    const existing = await findDivisionTemplateByNickname(clientId, nickname);
    return saveDivisionTemplate(clientId, nickname, leaves, existing?.id || null);
  }

  async function deleteGroupings(eventId, clientId) {
    try {
      const [entries, meta] = await Promise.all([
        query(
          'DELETE FROM groupings WHERE event_id = ? AND client_id = ?',
          [eventId, clientId]
        ),
        query(
          'DELETE FROM groupings_meta WHERE event_id = ? AND client_id = ?',
          [eventId, clientId]
        )
      ]);
      return Number(entries?.affectedRows || 0) + Number(meta?.affectedRows || 0);
    } catch (err) {
      if (err && err.code === 'ER_NO_SUCH_TABLE') return 0;
      throw err;
    }
  }

  async function deleteDraws(eventId, clientId) {
    try {
      const result = await query(
        'DELETE FROM draws WHERE event_id = ? AND client_id = ?',
        [eventId, clientId]
      );
      return Number(result?.affectedRows || 0);
    } catch (err) {
      if (err && err.code === 'ER_NO_SUCH_TABLE') return 0;
      throw err;
    }
  }

  /**
   * Clears scoring results for an event's draws.
   * draws_results is keyed by draw_id (typically draws.category_id).
   * Must run before deleteDraws so join keys still exist.
   */
  async function deleteDrawResults(eventId, clientId) {
    try {
      let deleted = 0;

      const byCategory = await query(
        `DELETE dr FROM draws_results dr
         INNER JOIN draws d
           ON CONVERT(dr.draw_id USING utf8mb4) = CONVERT(d.category_id USING utf8mb4)
         WHERE d.event_id = ? AND d.client_id = ?`,
        [eventId, clientId]
      );
      deleted += Number(byCategory?.affectedRows || 0);

      try {
        const byRowId = await query(
          `DELETE dr FROM draws_results dr
           INNER JOIN draws d
             ON CONVERT(dr.draw_id USING utf8mb4) = CONVERT(d.id USING utf8mb4)
           WHERE d.event_id = ? AND d.client_id = ?`,
          [eventId, clientId]
        );
        deleted += Number(byRowId?.affectedRows || 0);
      } catch (idErr) {
        if (!(idErr && idErr.code === 'ER_BAD_FIELD_ERROR')) throw idErr;
      }

      // Fallback: some rows store event id inside result_json (covers orphans / alternate ids).
      try {
        const byJson = await query(
          `DELETE FROM draws_results
           WHERE JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.event_id')) = ?
              OR JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.eventId')) = ?`,
          [String(eventId), String(eventId)]
        );
        deleted += Number(byJson?.affectedRows || 0);
      } catch (jsonErr) {
        if (!(jsonErr && (jsonErr.code === 'ER_BAD_FIELD_ERROR' || jsonErr.code === 'ER_INVALID_JSON_TEXT'
          || jsonErr.code === 'ER_WRONG_JSON_PATH' || String(jsonErr.message || '').includes('JSON')))) {
          throw jsonErr;
        }
      }

      return deleted;
    } catch (err) {
      if (err && err.code === 'ER_NO_SUCH_TABLE') return 0;
      throw err;
    }
  }

  async function deleteSchedule(eventId, clientId) {
    try {
      const result = await query(
        'DELETE FROM schedules WHERE event_id = ? AND client_id = ?',
        [eventId, clientId]
      );
      return Number(result?.affectedRows || 0);
    } catch (err) {
      if (err && err.code === 'ER_NO_SUCH_TABLE') return 0;
      throw err;
    }
  }

  async function deleteDivisionTemplate(templateId, clientId) {
    const row = await getDivisionTemplate(templateId, clientId);
    if (!row) return false;
    if (isInternalEventLeavesNickname(row.nickname)) {
      const err = new Error('That template cannot be deleted.');
      err.status = 400;
      throw err;
    }
    const result = await query(
      'DELETE FROM divisions WHERE id = ? AND client_id = ?',
      [templateId, clientId]
    );
    return Number(result?.affectedRows || 0) > 0;
  }

  async function deleteDivisionTemplateByNickname(clientId, nickname) {
    const name = String(nickname || '').trim();
    if (!name) return 0;
    const result = await query(
      'DELETE FROM divisions WHERE client_id = ? AND LOWER(TRIM(nickname)) = LOWER(?)',
      [clientId, name]
    );
    return Number(result?.affectedRows || 0);
  }

  /** Deletes saved divisions/groupings/draws/draw-results/schedule for an event. Does not touch registration. */
  async function deleteProfileFilesForEvent(eventId, clientId) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) {
      const err = new Error('Access denied.');
      err.status = 403;
      throw err;
    }
    const eventName = await getEventNickname(eventId, clientId);

    // Clear live schedule first so a partial failure later never leaves a stale schedule behind.
    const schedulesFirst = await deleteSchedule(eventId, clientId);

    // Clear draw results before draws rows (join uses category_id / draw_id).
    const drawResults = await deleteDrawResults(eventId, clientId);

    const [eventLeaves, legacyDivisions, groupings, draws] = await Promise.all([
      deleteDivisionTemplateByNickname(clientId, eventLeavesNickname(eventId)),
      eventName && !isInternalEventLeavesNickname(eventName)
        ? deleteDivisionTemplateByNickname(clientId, eventName)
        : Promise.resolve(0),
      deleteGroupings(eventId, clientId),
      deleteDraws(eventId, clientId)
    ]);

    // Delete schedule again after draws/groupings (covers any race with concurrent saves).
    const schedules = Math.max(schedulesFirst, await deleteSchedule(eventId, clientId));
    const divisions = eventLeaves + legacyDivisions;
    return {
      eventId,
      eventName,
      deleted: { divisions, groupings, draws, drawResults, schedules },
      total: divisions + groupings + draws + drawResults + schedules
    };
  }

  return {
    verifyEventOwnership,
    getEventName,
    getEventNickname,
    eventLeavesNickname,
    isInternalEventLeavesNickname,
    deleteGroupings,
    loadDraws,
    saveDraws,
    deleteDraws,
    deleteDrawResults,
    loadSchedule,
    loadPublicSchedule,
    listSavedSchedules,
    saveSchedule,
    deleteSchedule,
    fetchAthletesForEvent,
    listDivisionTemplates,
    getDivisionTemplate,
    findDivisionTemplateByNickname,
    findEventDivisionLeaves,
    saveEventDivisionLeaves,
    saveDivisionTemplate,
    deleteDivisionTemplate,
    deleteDivisionTemplateByNickname,
    deleteProfileFilesForEvent
  };
}

module.exports = { createStore };
