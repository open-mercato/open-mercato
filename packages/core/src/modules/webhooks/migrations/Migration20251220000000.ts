import { Migration } from '@mikro-orm/migrations';

export class Migration20251220000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table "webhook_deliveries" (
        "id" varchar(255) not null,
        "webhook_id" uuid not null,
        "tenant_id" uuid not null,
        "event" varchar(100) not null,
        "delivery_type" varchar(50) not null,
        "status" varchar(20) not null default 'pending',
        "timestamp" bigint not null,
        "status_code" integer null,
        "response" text null,
        "error" text null,
        "attempt_number" integer not null default 1,
        "next_retry_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "completed_at" timestamptz null,
        constraint "webhook_deliveries_pkey" primary key ("id"),
        constraint "webhook_deliveries_webhook_id_fkey" foreign key ("webhook_id") references "webhooks" ("id") on delete cascade,
        constraint "webhook_deliveries_status_check" check ("status" in ('pending', 'success', 'failed', 'retrying'))
      );
    `);

    this.addSql(`create index "idx_webhook_deliveries_webhook" on "webhook_deliveries" ("webhook_id");`);
    this.addSql(`create index "idx_webhook_deliveries_tenant" on "webhook_deliveries" ("tenant_id");`);
    this.addSql(`create index "idx_webhook_deliveries_status" on "webhook_deliveries" ("status");`);
    this.addSql(`create index "idx_webhook_deliveries_event" on "webhook_deliveries" ("event");`);
    this.addSql(`create index "idx_webhook_deliveries_timestamp" on "webhook_deliveries" ("timestamp" desc);`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "webhook_deliveries" cascade;`);
  }

}
