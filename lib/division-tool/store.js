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

function sortDrawRows(rows) {
  return (rows || []).slice().sort((a, b) => {
    const orderCmp = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
    if (orderCmp) return orderCmp;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
  });
}

function sortAthleteRows(rows) {
  return (rows || []).slice().sort((a, b) => {
    const lastCmp = String(a.last_name || '').localeCompare(String(b.last_name || ''));
    if (lastCmp) return lastCmp;
    const firstCmp = String(a.first_name || '').localeCompare(String(b.first_name || ''));
    if (firstCmp) return firstCmp;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
  });
}

function sortDivisionTemplates(rows) {
  return (rows || []).slice().sort((a, b) => {
    const nameCmp = String(a.nickname || '').localeCompare(String(b.nickname || ''));
    if (nameCmp) return nameCmp;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
  });
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
    const rows = sortDrawRows(await query(
      `SELECT id, category_id, division_name, division_type, event_key, athlete_count,
              sort_order, format_version, body_text, athlete_indices, state_json, updated_at
       FROM draws
       WHERE event_id = ? AND client_id = ?`,
      [eventId, clientId]
    ));
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

  function daysFromScheduleState(stateJson) {
    const state = parseJson(stateJson);
    const days = Array.isArray(state?.days) && state.days.length
      ? state.days
      : [{ name: 'Day 1' }];
    return days.map((day, index) => ({
      name: String((day && day.name) || ('Day ' + (index + 1)))
    }));
  }

  async function listSavedSchedules(clientId) {
    const rows = await query(
      `SELECT s.event_id AS eventId,
              s.updated_at AS updatedAt,
              s.format_version AS formatVersion,
              JSON_EXTRACT(s.state_json, '$.days') AS daysJson,
              e.event_name AS eventName,
              e.event_date_start AS eventDateStart
       FROM schedules s
       INNER JOIN events e
         ON e.id = s.event_id AND e.client_id = s.client_id
       WHERE s.client_id = ?`,
      [clientId]
    );
    return (rows || []).map((row) => ({
      eventId: String(row.eventId),
      eventName: row.eventName || `event ${row.eventId}`,
      eventDateStart: row.eventDateStart || null,
      updatedAt: row.updatedAt || null,
      formatVersion: row.formatVersion,
      days: daysFromScheduleState({ days: parseJson(row.daysJson) })
    })).sort((a, b) => {
      const dateA = a.eventDateStart ? new Date(a.eventDateStart).getTime() : 0;
      const dateB = b.eventDateStart ? new Date(b.eventDateStart).getTime() : 0;
      if (dateA !== dateB) return dateA - dateB;
      const nameCmp = String(a.eventName).localeCompare(String(b.eventName));
      if (nameCmp) return nameCmp;
      const updA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const updB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return updB - updA;
    });
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
    const rows = sortAthleteRows(await query(
      `SELECT id, first_name, last_name, dob, \`rank\`, gender, weight_kg, height_kg AS height_cm,
              team_name_or_country,
              individual_patterns, individual_sparring, individual_special_technique, individual_power_test,
              team_patterns, team_sparring, team_special_technique, team_power_test, pre_arranged_sparring
       FROM registration
       WHERE event_id = ? AND LOWER(role) = 'athlete'`,
      [eventId]
    ));
    return rows || [];
  }

  async function listDivisionTemplates(clientId) {
    const rows = sortDivisionTemplates(await query(
      `SELECT id, nickname, leaf_count, format_version, updated_at
       FROM divisions
       WHERE client_id = ?`,
      [clientId]
    ));
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

  function parseResultJson(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(String(raw));
    } catch (_) {
      return null;
    }
  }

  /**
   * Events owned by this client that have at least one saved draws_results row.
   * Prefer draws_results.event_id (new column); fall back to draw joins / JSON.
   */
  async function listEventsWithResults(clientId) {
    try {
      const byMap = new Map();
      const mergeRow = (row) => {
        const id = String(row.eventId);
        const prev = byMap.get(id);
        const count = Number(row.resultCount || 0);
        const updatedAt = row.updatedAt || null;
        if (!prev) {
          byMap.set(id, {
            eventId: id,
            eventName: row.eventName || `event ${id}`,
            eventDateStart: row.eventDateStart || null,
            updatedAt,
            resultCount: count
          });
          return;
        }
        prev.resultCount = Math.max(prev.resultCount, count);
        if (updatedAt && (!prev.updatedAt || new Date(updatedAt) > new Date(prev.updatedAt))) {
          prev.updatedAt = updatedAt;
        }
      };

      // Primary: dedicated event_id column on draws_results.
      try {
        const byEventCol = await query(
          `SELECT e.id AS eventId,
                  e.event_name AS eventName,
                  e.event_date_start AS eventDateStart,
                  MAX(dr.updated_at) AS updatedAt,
                  COUNT(DISTINCT dr.draw_id) AS resultCount
           FROM draws_results dr
           INNER JOIN events e
             ON e.id = dr.event_id AND e.client_id = ?
           WHERE dr.event_id IS NOT NULL
           GROUP BY e.id, e.event_name, e.event_date_start`,
          [clientId]
        );
        (byEventCol || []).forEach(mergeRow);
      } catch (colErr) {
        if (!(colErr && colErr.code === 'ER_BAD_FIELD_ERROR')) throw colErr;
      }

      // Legacy fallbacks when event_id is null / column missing.
      const byCategory = await query(
        `SELECT e.id AS eventId,
                e.event_name AS eventName,
                e.event_date_start AS eventDateStart,
                MAX(dr.updated_at) AS updatedAt,
                COUNT(DISTINCT dr.draw_id) AS resultCount
         FROM events e
         INNER JOIN draws d
           ON d.event_id = e.id AND d.client_id = e.client_id
         INNER JOIN draws_results dr
           ON CONVERT(dr.draw_id USING utf8mb4) = CONVERT(d.category_id USING utf8mb4)
         WHERE e.client_id = ?
         GROUP BY e.id, e.event_name, e.event_date_start`,
        [clientId]
      );
      (byCategory || []).forEach(mergeRow);

      try {
        const byId = await query(
          `SELECT e.id AS eventId,
                  e.event_name AS eventName,
                  e.event_date_start AS eventDateStart,
                  MAX(dr.updated_at) AS updatedAt,
                  COUNT(DISTINCT dr.draw_id) AS resultCount
           FROM events e
           INNER JOIN draws d
             ON d.event_id = e.id AND d.client_id = e.client_id
           INNER JOIN draws_results dr
             ON CONVERT(dr.draw_id USING utf8mb4) = CONVERT(d.id USING utf8mb4)
           WHERE e.client_id = ?
           GROUP BY e.id, e.event_name, e.event_date_start`,
          [clientId]
        );
        (byId || []).forEach(mergeRow);
      } catch (idErr) {
        if (!(idErr && idErr.code === 'ER_BAD_FIELD_ERROR')) throw idErr;
      }

      return Array.from(byMap.values()).sort((a, b) => {
        const da = a.eventDateStart ? new Date(a.eventDateStart).getTime() : 0;
        const dbVal = b.eventDateStart ? new Date(b.eventDateStart).getTime() : 0;
        if (da !== dbVal) return da - dbVal;
        return String(a.eventName).localeCompare(String(b.eventName));
      });
    } catch (err) {
      if (err && err.code === 'ER_NO_SUCH_TABLE') return [];
      throw err;
    }
  }

  /**
   * Load saved scoring results for an event (one row per draw with results).
   */
  async function loadDrawResults(eventId, clientId) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) return null;

    try {
      const byDrawId = new Map();
      const absorb = (row) => {
        const key = String(row.drawId || row.categoryId || '');
        if (!key || byDrawId.has(key)) return;
        const result = parseResultJson(row.resultJson);
        if (!result || typeof result !== 'object') return;
        let drawJson = null;
        if (row.drawJson != null) {
          drawJson = typeof row.drawJson === 'object' ? row.drawJson : parseResultJson(row.drawJson);
        }
        byDrawId.set(key, {
          drawId: key,
          categoryId: row.categoryId != null ? String(row.categoryId) : key,
          divisionName: row.divisionName || result.division_name || key,
          divisionType: row.divisionType || result.division_type || '',
          eventKey: row.eventKey || result.event_key || '',
          sortOrder: Number(row.sortOrder != null ? row.sortOrder : 9999),
          updatedAt: row.updatedAt || null,
          drawJson: drawJson && typeof drawJson === 'object' ? drawJson : null,
          result
        });
      };

      // Primary: event_id column (any scoring app / machine).
      try {
        const byEventCol = await query(
          `SELECT dr.draw_id AS drawId,
                  dr.result_json AS resultJson,
                  dr.updated_at AS updatedAt,
                  d.category_id AS categoryId,
                  d.state_json AS drawJson,
                  COALESCE(d.division_name, JSON_UNQUOTE(JSON_EXTRACT(dr.result_json, '$.division_name'))) AS divisionName,
                  COALESCE(d.division_type, JSON_UNQUOTE(JSON_EXTRACT(dr.result_json, '$.division_type'))) AS divisionType,
                  COALESCE(d.event_key, JSON_UNQUOTE(JSON_EXTRACT(dr.result_json, '$.event_key'))) AS eventKey,
                  COALESCE(d.sort_order, 9999) AS sortOrder
           FROM draws_results dr
           LEFT JOIN draws d
             ON d.event_id = ? AND d.client_id = ?
            AND (
              CONVERT(dr.draw_id USING utf8mb4) = CONVERT(d.id USING utf8mb4)
              OR CONVERT(dr.draw_id USING utf8mb4) = CONVERT(d.category_id USING utf8mb4)
            )
           WHERE dr.event_id = ?
           `,
          [eventId, clientId, eventId]
        );
        (byEventCol || []).forEach(absorb);
      } catch (colErr) {
        if (!(colErr && (colErr.code === 'ER_BAD_FIELD_ERROR' || String(colErr.message || '').includes('JSON')))) {
          throw colErr;
        }
      }

      if (!byDrawId.size) {
        const rowsByCategory = await query(
          `SELECT dr.draw_id AS drawId,
                  dr.result_json AS resultJson,
                  dr.updated_at AS updatedAt,
                  d.category_id AS categoryId,
                  d.state_json AS drawJson,
                  d.division_name AS divisionName,
                  d.division_type AS divisionType,
                  d.event_key AS eventKey,
                  d.sort_order AS sortOrder
           FROM draws_results dr
           INNER JOIN draws d
             ON CONVERT(dr.draw_id USING utf8mb4) = CONVERT(d.category_id USING utf8mb4)
           WHERE d.event_id = ? AND d.client_id = ?`,
          [eventId, clientId]
        );
        (rowsByCategory || []).forEach(absorb);

        try {
          const rowsById = await query(
            `SELECT dr.draw_id AS drawId,
                    dr.result_json AS resultJson,
                    dr.updated_at AS updatedAt,
                    d.category_id AS categoryId,
                    d.state_json AS drawJson,
                    d.division_name AS divisionName,
                    d.division_type AS divisionType,
                    d.event_key AS eventKey,
                    d.sort_order AS sortOrder
             FROM draws_results dr
             INNER JOIN draws d
               ON CONVERT(dr.draw_id USING utf8mb4) = CONVERT(d.id USING utf8mb4)
             WHERE d.event_id = ? AND d.client_id = ?`,
            [eventId, clientId]
          );
          (rowsById || []).forEach(absorb);
        } catch (idErr) {
          if (!(idErr && idErr.code === 'ER_BAD_FIELD_ERROR')) throw idErr;
        }

        try {
          const rowsByJson = await query(
            `SELECT dr.draw_id AS drawId,
                    dr.result_json AS resultJson,
                    dr.updated_at AS updatedAt
             FROM draws_results dr
             WHERE JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.event_id')) = ?
                OR JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.eventId')) = ?`,
            [String(eventId), String(eventId)]
          );
          (rowsByJson || []).forEach((row) => {
            const result = parseResultJson(row.resultJson);
            if (!result || typeof result !== 'object') return;
            absorb({
              drawId: row.drawId || result.draw_id || result.category_id,
              categoryId: result.category_id,
              divisionName: result.division_name,
              divisionType: result.division_type,
              eventKey: result.event_key,
              sortOrder: 9999,
              updatedAt: row.updatedAt,
              resultJson: row.resultJson
            });
          });
        } catch (jsonErr) {
          if (!(jsonErr && (jsonErr.code === 'ER_BAD_FIELD_ERROR' || jsonErr.code === 'ER_INVALID_JSON_TEXT'
            || jsonErr.code === 'ER_WRONG_JSON_PATH' || String(jsonErr.message || '').includes('JSON')))) {
            throw jsonErr;
          }
        }
      }

      return Array.from(byDrawId.values()).sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return String(a.divisionName).localeCompare(String(b.divisionName));
      });
    } catch (err) {
      if (err && err.code === 'ER_NO_SUCH_TABLE') return [];
      throw err;
    }
  }

  /**
   * Catalog division ids that have saved scoring results (draws_results).
   */
  async function getCompletedScheduleDivisionIds(eventId, clientId, catalog) {
    const results = await loadDrawResults(eventId, clientId);
    const entries = Array.isArray(catalog) ? catalog : [];
    let updatedAt = null;
    (results || []).forEach((row) => {
      if (!row.updatedAt) return;
      if (!updatedAt || new Date(row.updatedAt) > new Date(updatedAt)) updatedAt = row.updatedAt;
    });
    if (!results?.length || !entries.length) {
      return { ids: [], updatedAt };
    }

    const resultKeys = new Set();
    results.forEach((row) => {
      if (row.drawId) resultKeys.add(String(row.drawId));
      if (row.categoryId) resultKeys.add(String(row.categoryId));
    });

    const ids = entries
      .map((entry) => String(entry.id))
      .filter((id) => resultKeys.has(id));

    return { ids, updatedAt };
  }

  /**
   * Lightweight live check: how many result rows exist for this event right now.
   */
  async function getDrawResultsMeta(eventId, clientId) {
    const rows = await loadDrawResults(eventId, clientId);
    if (rows == null) return null;
    let latest = null;
    rows.forEach((row) => {
      if (!row.updatedAt) return;
      if (!latest || new Date(row.updatedAt) > new Date(latest)) latest = row.updatedAt;
    });
    return {
      eventId: String(eventId),
      resultCount: rows.length,
      updatedAt: latest,
      divisions: rows.map((row) => ({
        drawId: row.drawId,
        divisionName: row.divisionName,
        updatedAt: row.updatedAt
      }))
    };
  }

  /**
   * Clears scoring results for an event's draws.
   * Prefer draws_results.event_id; also clear legacy rows matched via draws / JSON.
   * Must run before deleteDraws so join keys still exist for legacy cleanup.
   */
  async function deleteDrawResults(eventId, clientId) {
    try {
      let deleted = 0;

      try {
        const byEventCol = await query(
          `DELETE dr FROM draws_results dr
           INNER JOIN events e ON e.id = dr.event_id AND e.client_id = ?
           WHERE dr.event_id = ?`,
          [clientId, eventId]
        );
        deleted += Number(byEventCol?.affectedRows || 0);
      } catch (colErr) {
        if (!(colErr && colErr.code === 'ER_BAD_FIELD_ERROR')) throw colErr;
      }

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

      // Fallback: some rows store event id inside result_json. Scope by client via events join
      // to prevent cross-tenant deletes when event_id values collide.
      try {
        const byJson = await query(
          `DELETE dr FROM draws_results dr
           INNER JOIN events e ON e.id = ? AND e.client_id = ?
           WHERE (
             JSON_UNQUOTE(JSON_EXTRACT(dr.result_json, '$.event_id')) = ?
             OR JSON_UNQUOTE(JSON_EXTRACT(dr.result_json, '$.eventId')) = ?
           )`,
          [String(eventId), String(clientId), String(eventId), String(eventId)]
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

  async function deleteUmpireAssignments(eventId, clientId) {
    try {
      const result = await query(
        'DELETE FROM umpire_assignments WHERE event_id = ? AND client_id = ?',
        [eventId, clientId]
      );
      return Number(result?.affectedRows || 0);
    } catch (err) {
      if (err && err.code === 'ER_NO_SUCH_TABLE') return 0;
      throw err;
    }
  }

  async function deleteSchedule(eventId, clientId) {
    try {
      const result = await query(
        'DELETE FROM schedules WHERE event_id = ? AND client_id = ?',
        [String(eventId), String(clientId)]
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
    const umpireAssignmentsFirst = await deleteUmpireAssignments(eventId, clientId);

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
    const umpireAssignments = Math.max(umpireAssignmentsFirst, await deleteUmpireAssignments(eventId, clientId));
    const divisions = eventLeaves + legacyDivisions;
    return {
      eventId,
      eventName,
      deleted: { divisions, groupings, draws, drawResults, schedules, umpireAssignments },
      total: divisions + groupings + draws + drawResults + schedules + umpireAssignments
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
    listEventsWithResults,
    loadDrawResults,
    getDrawResultsMeta,
    getCompletedScheduleDivisionIds,
    deleteDrawResults,
    loadSchedule,
    loadPublicSchedule,
    listSavedSchedules,
    saveSchedule,
    deleteSchedule,
    deleteUmpireAssignments,
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
