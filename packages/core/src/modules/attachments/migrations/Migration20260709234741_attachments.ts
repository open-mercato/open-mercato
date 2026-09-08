import { Migration } from '@mikro-orm/migrations';

export class Migration20260709234741_attachments extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "attachment_quota_reservations" ("id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "reserved_bytes" bigint not null, "actual_bytes" bigint null, "status" text not null default 'reserved', "source" text not null, "storage_driver" text not null, "partition_code" text null, "storage_path" text not null, "lease_token" uuid not null, "upload_token_hash" text null, "expires_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "attachment_quota_reservations_expires_idx" on "attachment_quota_reservations" ("expires_at");`);
    this.addSql(`create index "attachment_quota_reservations_tenant_status_idx" on "attachment_quota_reservations" ("tenant_id", "status");`);
    this.addSql(`alter table "attachment_quota_reservations" add constraint "attachment_quota_reservations_scope_path_unique" unique ("tenant_id", "storage_driver", "storage_path");`);
  }

}
