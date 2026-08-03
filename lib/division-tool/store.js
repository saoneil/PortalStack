const { promisify } = require('util');

function createStore(db) {
  const query = promisify(db.query).bind(db);

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

  async function loadGroupings(eventId, clientId) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) return null;
    const rows = await query(
      'SELECT state_json, format_version, updated_at FROM groupings WHERE event_id = ? AND client_id = ? LIMIT 1',
      [eventId, clientId]
    );
    if (!rows || !rows.length) return null;
    const row = rows[0];
    let state = row.state_json;
    if (typeof state === 'string') state = JSON.parse(state);
    return { state, format_version: row.format_version, updated_at: row.updated_at };
  }

  async function listSavedGroupings(clientId) {
    const rows = await query(
      `SELECT g.event_id AS eventId,
              g.updated_at AS updatedAt,
              g.format_version AS formatVersion,
              e.event_name AS eventName,
              e.event_date_start AS eventDateStart
       FROM groupings g
       INNER JOIN events e
         ON e.id = g.event_id AND e.client_id = g.client_id
       WHERE g.client_id = ?
       ORDER BY g.updated_at DESC, e.event_date_start DESC, e.event_name ASC`,
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

  async function saveGroupings(eventId, clientId, state) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) throw new Error('Event not found or access denied.');
    const json = JSON.stringify(state);
    await query(
      `INSERT INTO groupings (client_id, event_id, format_version, state_json)
       VALUES (?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         state_json = VALUES(state_json),
         format_version = VALUES(format_version),
         client_id = VALUES(client_id),
         updated_at = CURRENT_TIMESTAMP`,
      [clientId, eventId, state.format_version || 1, json]
    );
    return loadGroupings(eventId, clientId);
  }

  async function loadDraws(eventId, clientId) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) return null;
    const rows = await query(
      'SELECT state_json, format_version, updated_at FROM draws WHERE event_id = ? AND client_id = ? LIMIT 1',
      [eventId, clientId]
    );
    if (!rows || !rows.length) return null;
    const row = rows[0];
    let state = row.state_json;
    if (typeof state === 'string') state = JSON.parse(state);
    return { state, format_version: row.format_version, updated_at: row.updated_at };
  }

  async function listSavedDraws(clientId) {
    const rows = await query(
      `SELECT d.event_id AS eventId,
              d.updated_at AS updatedAt,
              d.format_version AS formatVersion,
              e.event_name AS eventName,
              e.event_date_start AS eventDateStart
       FROM draws d
       INNER JOIN events e
         ON e.id = d.event_id AND e.client_id = d.client_id
       WHERE d.client_id = ?
       ORDER BY d.updated_at DESC, e.event_date_start DESC, e.event_name ASC`,
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

  async function saveDraws(eventId, clientId, state) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) throw new Error('Event not found or access denied.');
    const json = JSON.stringify(state);
    await query(
      `INSERT INTO draws (client_id, event_id, format_version, state_json)
       VALUES (?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         state_json = VALUES(state_json),
         format_version = VALUES(format_version),
         client_id = VALUES(client_id),
         updated_at = CURRENT_TIMESTAMP`,
      [clientId, eventId, state.format_version || 1, json]
    );
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
    return rows || [];
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

  async function deleteGroupings(eventId, clientId) {
    const result = await query(
      'DELETE FROM groupings WHERE event_id = ? AND client_id = ?',
      [eventId, clientId]
    );
    return Number(result?.affectedRows || 0);
  }

  async function deleteDraws(eventId, clientId) {
    const result = await query(
      'DELETE FROM draws WHERE event_id = ? AND client_id = ?',
      [eventId, clientId]
    );
    return Number(result?.affectedRows || 0);
  }

  async function deleteSchedule(eventId, clientId) {
    const result = await query(
      'DELETE FROM schedules WHERE event_id = ? AND client_id = ?',
      [eventId, clientId]
    );
    return Number(result?.affectedRows || 0);
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

  /** Deletes saved divisions/groupings/draws/schedule for an event. Does not touch registration. */
  async function deleteProfileFilesForEvent(eventId, clientId) {
    const owned = await verifyEventOwnership(eventId, clientId);
    if (!owned) {
      const err = new Error('Access denied.');
      err.status = 403;
      throw err;
    }
    const eventName = await getEventName(eventId, clientId);
    const [divisions, groupings, draws, schedules] = await Promise.all([
      eventName ? deleteDivisionTemplateByNickname(clientId, eventName) : Promise.resolve(0),
      deleteGroupings(eventId, clientId),
      deleteDraws(eventId, clientId),
      deleteSchedule(eventId, clientId)
    ]);
    return {
      eventId,
      eventName,
      deleted: { divisions, groupings, draws, schedules },
      total: divisions + groupings + draws + schedules
    };
  }

  return {
    verifyEventOwnership,
    getEventName,
    loadGroupings,
    listSavedGroupings,
    saveGroupings,
    deleteGroupings,
    loadDraws,
    listSavedDraws,
    saveDraws,
    deleteDraws,
    loadSchedule,
    loadPublicSchedule,
    listSavedSchedules,
    saveSchedule,
    deleteSchedule,
    fetchAthletesForEvent,
    listDivisionTemplates,
    getDivisionTemplate,
    saveDivisionTemplate,
    deleteDivisionTemplateByNickname,
    deleteProfileFilesForEvent
  };
}

module.exports = { createStore };
