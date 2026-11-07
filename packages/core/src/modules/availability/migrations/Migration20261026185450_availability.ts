import { Migration } from '@mikro-orm/migrations';

export class Migration20261026185450_availability extends Migration {

  override name = 'Migration20261026185450';

  override up(): void | Promise<void> {
    this.addSql(`create table "availability_reservations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "idempotency_key" text not null, "source_type" text not null, "source_id" text not null, "status" text not null default 'active', "expires_at" timestamptz null, "items" jsonb not null, "wms_reservation_ids" jsonb not null default '[]', "order_id" uuid null, "status_reason" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "availability_reservations_source_idx" on "availability_reservations" ("tenant_id", "organization_id", "source_type", "source_id");`);
    this.addSql(`create index "availability_reservations_active_expiry_idx" on "availability_reservations" ("expires_at") where "status" = 'active';`);
    this.addSql(`create index "availability_reservations_scope_idx" on "availability_reservations" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "availability_reservations" add constraint "availability_reservations_tenant_org_idempotency_unique" unique ("tenant_id", "organization_id", "idempotency_key");`);
  }

}
