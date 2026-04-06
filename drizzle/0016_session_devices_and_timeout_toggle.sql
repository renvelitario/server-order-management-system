ALTER TABLE ims_users
ADD COLUMN IF NOT EXISTS session_timeout_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS ims_user_devices (
  device_id varchar(80) PRIMARY KEY,
  user_id integer NOT NULL REFERENCES ims_users(user_id),
  device_label varchar(200),
  user_agent text NOT NULL DEFAULT 'Unknown device',
  timezone varchar(80),
  last_ip varchar(80),
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ims_user_devices_user_device_unique
  ON ims_user_devices(user_id, device_id);

CREATE INDEX IF NOT EXISTS ims_user_devices_user_last_seen_idx
  ON ims_user_devices(user_id, last_seen_at DESC);
