import { Migration } from '@mikro-orm/migrations';

export class Migration20260804163220_example extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "example_todo_bulk_operations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "idempotency_key" text not null, "todo_ids" jsonb not null, "progress_job_id" uuid not null, "status" text not null default 'pending', "published_at" timestamptz null, "publish_attempts" int not null default 0, "last_publish_attempt_at" timestamptz null, "lease_owner" text null, "lease_expires_at" timestamptz null, "next_item_index" int not null default 0, "succeeded_count" int not null default 0, "failed_count" int not null default 0, "failed_items" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "example_todo_bulk_operations" add constraint "example_todo_bulk_operations_tenant_id_organizati_e950a_unique" unique ("tenant_id", "organization_id", "user_id", "idempotency_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "example_todo_bulk_operations" cascade;`);
  }

}
