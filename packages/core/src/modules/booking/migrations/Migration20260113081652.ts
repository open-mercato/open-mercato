import { Migration } from '@mikro-orm/migrations';

export class Migration20260113081652 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "booking_service_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tag_id" uuid not null, "service_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "booking_service_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_service_tag_assignments_scope_idx" on "booking_service_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "booking_service_tag_assignments" add constraint "booking_service_tag_assignments_unique" unique ("tag_id", "service_id");`);

    this.addSql(`alter table "booking_service_tag_assignments" add constraint "booking_service_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "booking_resource_tags" ("id") on update cascade;`);
    this.addSql(`alter table "booking_service_tag_assignments" add constraint "booking_service_tag_assignments_service_id_foreign" foreign key ("service_id") references "booking_services" ("id") on update cascade;`);
  }

}
