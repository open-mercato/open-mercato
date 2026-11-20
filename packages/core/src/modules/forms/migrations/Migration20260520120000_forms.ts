import { Migration } from '@mikro-orm/migrations';

export class Migration20260520120000_forms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "forms_distribution" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "form_id" uuid not null, "pinned_version_id" uuid null, "mode" text not null, "public_slug" text null, "status" text not null default 'active', "title" text null, "default_locale" text not null, "require_customer_auth" boolean not null default false, "allow_multiple_submissions" boolean not null default false, "max_responses" int null, "response_count" int not null default 0, "opens_at" timestamptz null, "closes_at" timestamptz null, "redirect_url" text null, "settings" jsonb null, "created_by" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "forms_distribution_org_public_slug_idx" on "forms_distribution" ("organization_id", "public_slug");`);
    this.addSql(`create index "forms_distribution_org_form_idx" on "forms_distribution" ("organization_id", "form_id");`);
    this.addSql(`create index "forms_distribution_org_status_idx" on "forms_distribution" ("organization_id", "status");`);
    // Partial-unique: one public slug per organization, only where a slug is set.
    this.addSql(`create unique index "forms_distribution_org_public_slug_unique" on "forms_distribution" ("organization_id", "public_slug") where "public_slug" is not null;`);

    this.addSql(`create table "forms_invitation" ("id" uuid not null default gen_random_uuid(), "distribution_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "recipient_email" text null, "recipient_name" text null, "recipient_ref" text null, "role" text null, "token_hash" text null, "status" text not null default 'pending', "submission_id" uuid null, "locale" text null, "expires_at" timestamptz null, "sent_at" timestamptz null, "opened_at" timestamptz null, "started_at" timestamptz null, "submitted_at" timestamptz null, "send_count" int not null default 0, "last_error" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "forms_invitation_distribution_status_idx" on "forms_invitation" ("distribution_id", "status");`);
    this.addSql(`create index "forms_invitation_org_submission_idx" on "forms_invitation" ("organization_id", "submission_id");`);
    this.addSql(`create index "forms_invitation_token_hash_idx" on "forms_invitation" ("token_hash");`);
    // Partial-unique: token hashes are globally unique, only where a token is set.
    this.addSql(`create unique index "forms_invitation_token_hash_unique" on "forms_invitation" ("token_hash") where "token_hash" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "forms_invitation" cascade;`);
    this.addSql(`drop table if exists "forms_distribution" cascade;`);
  }

}
