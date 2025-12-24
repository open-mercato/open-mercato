import { Migration } from '@mikro-orm/migrations';

export class Migration20251219000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table "webhooks" (
        "id" uuid not null default gen_random_uuid(),
        "tenant_id" uuid not null,
        "name" varchar(255) not null,
        "description" text null,
        "delivery_type" varchar(50) not null,
        "config" jsonb not null,
        "secret" varchar(255) not null,
        "old_secret" varchar(255) null,
        "old_secret_expires_at" timestamptz null,
        "events" text[] not null,
        "active" boolean not null default true,
        "retry_config" jsonb not null default '{"maxRetries": 3, "retryBackoff": "exponential", "retryDelay": 1000}'::jsonb,
        "timeout" integer not null default 10000,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "last_triggered_at" timestamptz null,
        constraint "webhooks_pkey" primary key ("id"),
        constraint "webhooks_delivery_type_check" check ("delivery_type" in ('http', 'sqs', 'sns'))
      );
    `);

    this.addSql(`create index "idx_webhooks_tenant" on "webhooks" ("tenant_id");`);
    this.addSql(`create index "idx_webhooks_active" on "webhooks" ("active") where "active" = true;`);
    this.addSql(`create index "idx_webhooks_delivery_type" on "webhooks" ("delivery_type");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "webhooks" cascade;`);
  }

}
