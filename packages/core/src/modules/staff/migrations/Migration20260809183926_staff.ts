import { Migration } from '@mikro-orm/migrations';

export class Migration20260809183926_staff extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "staff_timesheet_preferences" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "staff_member_id" uuid not null, "last_project_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);

    // Hand-written: the generator emits this as a plain non-unique index, dropping
    // both `unique` and the partial predicate declared on the entity. The same
    // limitation was corrected for the sibling timesheet tables in
    // Migration20260511112759. The predicate is load-bearing here — the preference
    // upsert uses `on conflict (organization_id, tenant_id, staff_member_id)
    // where deleted_at is null`, and Postgres only infers a partial unique index
    // when the statement restates the predicate. Without it the upsert fails with
    // "no unique or exclusion constraint matching the ON CONFLICT specification".
    this.addSql(`create unique index "staff_timesheet_preferences_unique_idx" on "staff_timesheet_preferences" ("organization_id", "tenant_id", "staff_member_id") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "staff_timesheet_preferences" cascade;`);
  }

}
