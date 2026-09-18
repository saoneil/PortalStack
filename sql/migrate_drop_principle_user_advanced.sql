-- Pricing / auth simplification: collapse principle_user_advanced into principle_user
-- Run on staging first. Deploy app that no longer reads principle_user_advanced BEFORE DROP COLUMN.

-- 1) Report (save counts)
SELECT
  SUM(CASE WHEN principle_user_advanced = 1 AND principle_user = 0 THEN 1 ELSE 0 END) AS advanced_only,
  SUM(CASE WHEN principle_user = 1 AND principle_user_advanced = 0 THEN 1 ELSE 0 END) AS principle_only,
  SUM(CASE WHEN principle_user = 1 AND principle_user_advanced = 1 THEN 1 ELSE 0 END) AS both_flags,
  COUNT(*) AS total_users
FROM users;

SELECT username, client_id, COUNT(*) AS row_count
FROM users
GROUP BY username, client_id
HAVING COUNT(*) > 1;

-- 2) Data migration: anyone with advanced gets principle_user
UPDATE users
SET principle_user = 1
WHERE principle_user_advanced = 1;

-- 3) Deploy portal code that no longer SELECT/INSERT principle_user_advanced, then:

-- ALTER TABLE users DROP COLUMN principle_user_advanced;

-- 4) Update stored procedures outside this repo if they reference the column:
--    sp_admin_register_user, sp_auth_login (and any admin user procs).
