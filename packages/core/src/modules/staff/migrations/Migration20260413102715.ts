import { Migration } from '@mikro-orm/migrations';

export class Migration20260413102715 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "staff_time_project_members" add column "show_in_grid" boolean not null default false;`);
    // Backfill: preserve grid visibility for memberships that already have time entries,
    // so existing users don't lose rows the first time the new visibility filter is applied.
    this.addSql(`
      update "staff_time_project_members" m
      set "show_in_grid" = true
      where exists (
        select 1 from "staff_time_entries" e
        where e."time_project_id" = m."time_project_id"
          and e."staff_member_id" = m."staff_member_id"
          and e."deleted_at" is null
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "staff_time_project_members" drop column "show_in_grid";`);
  }

}
