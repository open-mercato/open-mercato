-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- Drop dependent tables first due to references/user id usage
DROP TABLE IF EXISTS "user_roles";
DROP TABLE IF EXISTS "users";
DROP TABLE IF EXISTS "organizations";

-- Recreate organizations with UUID PK
CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Recreate users with UUID PK and org FK (not enforced here; relations handled at app level)
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "organization_id" uuid NOT NULL,
  "password_hash" text,
  "is_confirmed" boolean DEFAULT false NOT NULL,
  "last_login_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);

-- Recreate user_roles with UUID user_id and integer role_id
CREATE TABLE "user_roles" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "role_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

