-- Transactional Outbox, Kill Switch, and supporting tables for RepoFinisher

CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_created ON outbox (status, created_at);

CREATE TABLE IF NOT EXISTS kill_switch_status (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  engaged BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  engaged_by TEXT,
  engaged_at TIMESTAMPTZ,
  disengaged_by TEXT,
  disengaged_at TIMESTAMPTZ
);

INSERT INTO kill_switch_status (id, engaged) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS data_governance_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  user_id UUID,
  reason TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS examples (adjust policies as needed)
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_switch_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_governance_audit ENABLE ROW LEVEL SECURITY;
