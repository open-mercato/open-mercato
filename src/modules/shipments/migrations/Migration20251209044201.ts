import { Migration } from '@mikro-orm/migrations';

export class Migration20251209044201 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "shipment_tasks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "title" text not null, "description" text null, "status" text check ("status" in ('TODO', 'IN_PROGRESS', 'DONE')) not null default 'TODO', "assigned_to_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "shipment_tasks_pkey" primary key ("id"));`);

    this.addSql(`alter table "shipment_tasks" add constraint "shipment_tasks_assigned_to_id_foreign" foreign key ("assigned_to_id") references "users" ("id") on update cascade on delete set null;`);
  }

}
