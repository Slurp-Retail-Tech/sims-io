DROP PROCEDURE IF EXISTS migrate_csat_request_columns;

DELIMITER $$

CREATE PROCEDURE migrate_csat_request_columns()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens'
      AND COLUMN_NAME = 'request_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_tokens'
      AND COLUMN_NAME = 'ticket_id'
  ) THEN
    ALTER TABLE csat_tokens
      CHANGE COLUMN request_id ticket_id BIGINT NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND COLUMN_NAME = 'request_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'csat_responses'
      AND COLUMN_NAME = 'ticket_id'
  ) THEN
    ALTER TABLE csat_responses
      CHANGE COLUMN request_id ticket_id BIGINT NOT NULL;
  END IF;
END$$

DELIMITER ;

CALL migrate_csat_request_columns();

DROP PROCEDURE IF EXISTS migrate_csat_request_columns;
