CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "token" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp
);
CREATE INDEX IF NOT EXISTS auth_sessions_token_idx ON "auth_sessions" ("token");

