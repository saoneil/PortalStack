-- Public registration event list (used by GET /api/registration/events).
-- Run against the portal database, then restart the app.

DROP PROCEDURE IF EXISTS sp_pub_view_live_events;

DELIMITER //

CREATE PROCEDURE sp_pub_view_live_events()
BEGIN
  SELECT
    id,
    client_id,
    event_name,
    event_name AS `Event Name`,
    event_date_start,
    event_date_start AS `Start Date`,
    event_date_end,
    event_date_end AS `End Date`,
    registration_open_date,
    registration_open_date AS `Registration Open Date`,
    registration_close_date,
    registration_close_date AS `Registration Close Date`,
    event_location,
    event_location AS Location,
    event_events,
    event_link,
    event_contact,
    LENGTH(event_poster) > 0 AS has_poster,
    CRC32(event_poster) AS poster_version,
    CASE
      WHEN waiver_required = 1 AND LENGTH(TRIM(COALESCE(waiver_text, ''))) > 0 THEN 1
      ELSE 0
    END AS waiver_required,
    LENGTH(TRIM(COALESCE(waiver_text, ''))) > 0 AS has_waiver
  FROM events
  WHERE active = 1
  ORDER BY event_date_start ASC, event_name ASC;
END //

DELIMITER ;
