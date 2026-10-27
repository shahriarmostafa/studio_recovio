CREATE TABLE __SCHEMA__.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email=lower(email)),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','doctor')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE __SCHEMA__.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON __SCHEMA__.sessions(user_id);
CREATE INDEX sessions_expiry ON __SCHEMA__.sessions(expires_at);
CREATE TABLE __SCHEMA__.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_review','contacted','closed')),
  assigned_doctor_id uuid REFERENCES __SCHEMA__.users(id),
  version integer NOT NULL DEFAULT 1,
  idempotency_key uuid NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX applications_doctor_created ON __SCHEMA__.applications(assigned_doctor_id,created_at DESC,id DESC);
CREATE INDEX applications_created ON __SCHEMA__.applications(created_at DESC,id DESC);
CREATE TABLE __SCHEMA__.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created ON __SCHEMA__.audit_events(created_at DESC);
CREATE TABLE __SCHEMA__.login_attempts (
  identifier_hash text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  window_started timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);
