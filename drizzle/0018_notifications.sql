CREATE TABLE IF NOT EXISTS ims_notifications (
  notification_id serial PRIMARY KEY,
  recipient_user_id integer NOT NULL REFERENCES ims_users(user_id),
  event_type varchar(80) NOT NULL,
  title varchar(200) NOT NULL,
  message text NOT NULL,
  order_id integer REFERENCES ims_orders(order_id),
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ims_notifications_recipient_read_idx
  ON ims_notifications (recipient_user_id, is_read, notification_id DESC);

CREATE INDEX IF NOT EXISTS ims_notifications_recipient_created_idx
  ON ims_notifications (recipient_user_id, notification_id DESC);
