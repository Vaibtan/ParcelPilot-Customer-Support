-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  csm TEXT,
  contract_file TEXT,
  premium_support INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  carrier TEXT,
  status TEXT NOT NULL,
  booked_at TEXT,
  pickup_window_start TEXT,
  pickup_window_end TEXT,
  pickup_actual_at TEXT,
  shipment_fee_inr INTEGER,
  carrier_fault INTEGER DEFAULT 0,
  customer_fault INTEGER DEFAULT 0,
  cancellation_requested_at TEXT,
  notes TEXT
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  ticket_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  created_at TEXT,
  status TEXT NOT NULL,
  subject TEXT,
  description TEXT,
  channel TEXT,
  assigned_to TEXT,
  last_customer_message_at TEXT,
  historical_resolution TEXT
);

-- Conversations / messages (for agent traces later)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  principal_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Runs / traces
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  principal_json TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  total_latency_ms INTEGER,
  total_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL, -- llm | tool
  name TEXT,
  args_json TEXT,
  result_json TEXT,
  latency_ms INTEGER,
  tokens INTEGER
);

-- Pending actions + action log (ticket 07 but schema now)
CREATE TABLE IF NOT EXISTS pending_actions (
  nonce TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  principal_json TEXT NOT NULL,
  conversation_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS action_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  principal_json TEXT NOT NULL,
  nonce TEXT,
  executed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Document chunks (ticket 06)
CREATE TABLE IF NOT EXISTS doc_chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL,
  section TEXT,
  content TEXT NOT NULL,
  authority_tier INTEGER NOT NULL,
  status TEXT NOT NULL, -- current | deprecated | context_only
  account_scope TEXT, -- NULL = general, or ACCT-xxx
  effective_date TEXT,
  embedding BLOB
);

CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
  content, title, section, doc_id, content='doc_chunks', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(rowid, content, title, section, doc_id) VALUES (new.rowid, new.content, new.title, new.section, new.doc_id);
END;
CREATE TRIGGER IF NOT EXISTS doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, content, title, section, doc_id) VALUES('delete', old.rowid, old.content, old.title, old.section, old.doc_id);
END;

-- Insights (ticket 09)
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  evidence_json TEXT NOT NULL,
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
