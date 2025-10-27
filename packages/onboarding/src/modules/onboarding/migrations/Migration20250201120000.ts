import { Migration } from '@mikro-orm/migrations'

export class Migration20250201120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "onboarding_requests" (
      "id" uuid not null default gen_random_uuid(),
      "email" text not null,
      "token_hash" text not null,
      "status" text not null default 'pending',
      "first_name" text not null,
      "last_name" text not null,
      "organization_name" text not null,
      "locale" text null,
      "terms_accepted" boolean not null default false,
      "expires_at" timestamptz not null,
      "completed_at" timestamptz null,
      "tenant_id" uuid null,
      "organization_id" uuid null,
      "user_id" uuid null,
      "last_email_sent_at" timestamptz null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz null,
      "deleted_at" timestamptz null,
      constraint "onboarding_requests_pkey" primary key ("id")
    );`)

    this.addSql('create unique index "onboarding_requests_email_unique" on "onboarding_requests" ("email");')
    this.addSql('create unique index "onboarding_requests_token_hash_unique" on "onboarding_requests" ("token_hash");')
    this.addSql('create index "onboarding_requests_status_index" on "onboarding_requests" ("status");')
    this.addSql('create index "onboarding_requests_expires_at_index" on "onboarding_requests" ("expires_at");')
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "onboarding_requests" cascade;')
  }
}
