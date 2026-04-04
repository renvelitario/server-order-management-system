ALTER TABLE "ims_users" ADD COLUMN "name" varchar(200) NOT NULL DEFAULT 'User';
CREATE UNIQUE INDEX "ims_users_username_unique" ON "ims_users" ("username");
