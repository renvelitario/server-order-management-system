CREATE TABLE IF NOT EXISTS ims_revoked_device_sessions (
  revoked_session_id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES ims_users(user_id),
  device_id varchar(80) NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ims_revoked_device_sessions_user_device_unique
  ON ims_revoked_device_sessions (user_id, device_id);

CREATE INDEX IF NOT EXISTS ims_revoked_device_sessions_lookup_idx
  ON ims_revoked_device_sessions (user_id, device_id);
