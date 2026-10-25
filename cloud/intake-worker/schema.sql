-- Reports wait here until the operator's PC imports and deletes them.
CREATE TABLE IF NOT EXISTS reports (
  receipt_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  digest TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- Salted hashes of client addresses for rate limiting; pruned after a day.
CREATE TABLE IF NOT EXISTS submissions (
  client TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_client_at ON submissions (client, at);
