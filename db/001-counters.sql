CREATE TABLE IF NOT EXISTS tg_example_counters (
  user_id Utf8 NOT NULL,
  value Int64,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS tg_example_operations (
  user_id Utf8 NOT NULL,
  operation_id Utf8 NOT NULL,
  delta Int64,
  PRIMARY KEY (user_id, operation_id)
);
