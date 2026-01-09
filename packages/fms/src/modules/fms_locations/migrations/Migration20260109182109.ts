import { Migration } from '@mikro-orm/migrations';

export class Migration20260109182109 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "fms_locations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "quadrant" text not null, "created_at" timestamptz not null, "created_by" uuid null, "updated_at" timestamptz not null, "updated_by" uuid null, "deleted_at" timestamptz null, "product_type" text check ("product_type" in ('port', 'terminal')) not null, "locode" text null, "port_id" uuid null, constraint "fms_locations_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_locations_product_type_index" on "fms_locations" ("product_type");`);
    this.addSql(`create index "fms_locations_scope_idx" on "fms_locations" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "fms_locations" add constraint "fms_locations_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`alter table "fms_locations" add constraint "fms_locations_port_id_foreign" foreign key ("port_id") references "fms_locations" ("id") on update cascade on delete restrict;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "fms_locations" drop constraint "fms_locations_port_id_foreign";`);
  }

}
