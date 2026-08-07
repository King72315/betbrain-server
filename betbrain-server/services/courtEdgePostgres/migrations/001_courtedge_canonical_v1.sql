-- COURTEDGE canonical Postgres schema v1
-- courteedge-render-postgres-production-durability-v1

CREATE TABLE IF NOT EXISTS courtedge_schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courtedge_slates (
  id BIGSERIAL PRIMARY KEY,
  league TEXT NOT NULL DEFAULT 'WNBA',
  slate_date_ct TEXT NOT NULL,
  day_bucket TEXT NOT NULL DEFAULT 'TODAY',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  canonical_board_version TEXT,
  selection_mode TEXT,
  model_version TEXT,
  calibration_version TEXT,
  calibration_hash TEXT,
  membership_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sealed_at TIMESTAMPTZ,
  official_count INTEGER NOT NULL DEFAULT 0,
  research_count INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  lock_reason TEXT,
  source_build TEXT,
  source_commit TEXT,
  classification TEXT NOT NULL DEFAULT 'CANONICAL',
  payload_json JSONB,
  UNIQUE (league, slate_date_ct, day_bucket)
);

CREATE INDEX IF NOT EXISTS idx_courtedge_slates_date ON courtedge_slates (slate_date_ct);
CREATE INDEX IF NOT EXISTS idx_courtedge_slates_status ON courtedge_slates (status);
CREATE INDEX IF NOT EXISTS idx_courtedge_slates_calib ON courtedge_slates (calibration_hash);

CREATE TABLE IF NOT EXISTS courtedge_official_props (
  id BIGSERIAL PRIMARY KEY,
  slate_id BIGINT NOT NULL REFERENCES courtedge_slates(id) ON DELETE CASCADE,
  event_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  opponent TEXT,
  market_type TEXT NOT NULL DEFAULT 'player_points',
  side TEXT NOT NULL,
  line DOUBLE PRECISION NOT NULL,
  raw_probability DOUBLE PRECISION,
  reliability_probability DOUBLE PRECISION,
  trust_score DOUBLE PRECISION,
  safety_score DOUBLE PRECISION,
  risk TEXT,
  safe_pathway TEXT,
  projection DOUBLE PRECISION,
  fair_line DOUBLE PRECISION,
  projection_edge DOUBLE PRECISION,
  minutes_stability DOUBLE PRECISION,
  role_stability DOUBLE PRECISION,
  market_quality DOUBLE PRECISION,
  availability_certainty DOUBLE PRECISION,
  conflict_index DOUBLE PRECISION,
  failure_paths_json JSONB,
  evidence_json JSONB,
  v1_risk TEXT,
  v2_risk TEXT,
  model_version TEXT,
  calibration_hash TEXT,
  prediction_created_at TIMESTAMPTZ,
  market_timestamp TIMESTAMPTZ,
  sealed_at TIMESTAMPTZ,
  actual_points DOUBLE PRECISION,
  grade TEXT,
  margin_to_line DOUBLE PRECISION,
  graded_at TIMESTAMPTZ,
  tracked_id TEXT,
  prop_identity TEXT NOT NULL,
  UNIQUE (slate_id, prop_identity)
);

CREATE INDEX IF NOT EXISTS idx_courtedge_official_slate ON courtedge_official_props (slate_id);
CREATE INDEX IF NOT EXISTS idx_courtedge_official_event ON courtedge_official_props (event_id);
CREATE INDEX IF NOT EXISTS idx_courtedge_official_player ON courtedge_official_props (player_id);
CREATE INDEX IF NOT EXISTS idx_courtedge_official_grade ON courtedge_official_props (grade);
CREATE INDEX IF NOT EXISTS idx_courtedge_official_risk ON courtedge_official_props (risk);

CREATE TABLE IF NOT EXISTS courtedge_research_props (
  id BIGSERIAL PRIMARY KEY,
  slate_id BIGINT NOT NULL REFERENCES courtedge_slates(id) ON DELETE CASCADE,
  event_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  opponent TEXT,
  market_type TEXT NOT NULL DEFAULT 'player_points',
  side TEXT NOT NULL,
  line DOUBLE PRECISION NOT NULL,
  raw_probability DOUBLE PRECISION,
  reliability_probability DOUBLE PRECISION,
  trust_score DOUBLE PRECISION,
  safety_score DOUBLE PRECISION,
  risk TEXT,
  safe_pathway TEXT,
  projection DOUBLE PRECISION,
  fair_line DOUBLE PRECISION,
  projection_edge DOUBLE PRECISION,
  failure_paths_json JSONB,
  evidence_json JSONB,
  v1_risk TEXT,
  v2_risk TEXT,
  model_version TEXT,
  calibration_hash TEXT,
  official_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  official_selected BOOLEAN NOT NULL DEFAULT FALSE,
  official_rejection_reasons JSONB,
  shadow_side TEXT,
  shadow_probability DOUBLE PRECISION,
  research_grade TEXT,
  shadow_grade TEXT,
  actual_points DOUBLE PRECISION,
  margin_to_line DOUBLE PRECISION,
  graded_at TIMESTAMPTZ,
  prop_identity TEXT NOT NULL,
  UNIQUE (slate_id, prop_identity)
);

CREATE INDEX IF NOT EXISTS idx_courtedge_research_slate ON courtedge_research_props (slate_id);
CREATE INDEX IF NOT EXISTS idx_courtedge_research_risk ON courtedge_research_props (risk);

CREATE TABLE IF NOT EXISTS courtedge_results (
  id BIGSERIAL PRIMARY KEY,
  slate_id BIGINT NOT NULL REFERENCES courtedge_slates(id) ON DELETE CASCADE,
  official_prop_id BIGINT NOT NULL REFERENCES courtedge_official_props(id) ON DELETE CASCADE,
  cohort_status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slate_id, official_prop_id)
);

CREATE INDEX IF NOT EXISTS idx_courtedge_results_slate ON courtedge_results (slate_id);

CREATE TABLE IF NOT EXISTS courtedge_slate_locks (
  id BIGSERIAL PRIMARY KEY,
  slate_date_ct TEXT NOT NULL,
  lock_type TEXT NOT NULL,
  league TEXT NOT NULL DEFAULT 'WNBA',
  canonical_membership_hash TEXT,
  source_slate_id BIGINT REFERENCES courtedge_slates(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT,
  UNIQUE (league, slate_date_ct, lock_type)
);

CREATE TABLE IF NOT EXISTS courtedge_model_freezes (
  id BIGSERIAL PRIMARY KEY,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  calibration_name TEXT NOT NULL,
  calibration_hash TEXT NOT NULL,
  coefficients_hash TEXT,
  trust_hash TEXT,
  pathway_hash TEXT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ,
  is_champion BOOLEAN NOT NULL DEFAULT FALSE,
  meta_json JSONB,
  UNIQUE (calibration_name, calibration_hash)
);

CREATE TABLE IF NOT EXISTS courtedge_research_freezes (
  id BIGSERIAL PRIMARY KEY,
  slate_date_ct TEXT NOT NULL,
  freeze_timestamp TIMESTAMPTZ NOT NULL,
  freeze_hash TEXT,
  classification_counts JSONB,
  freeze_json JSONB NOT NULL,
  official_record_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  freeze_type TEXT NOT NULL DEFAULT 'PROSPECTIVE_RESEARCH_FREEZE',
  calibration_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slate_date_ct, freeze_timestamp, freeze_type)
);

CREATE INDEX IF NOT EXISTS idx_courtedge_research_freezes_date
  ON courtedge_research_freezes (slate_date_ct);
