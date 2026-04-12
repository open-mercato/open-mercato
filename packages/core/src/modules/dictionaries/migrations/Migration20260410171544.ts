import { Migration } from '@mikro-orm/migrations';

export class Migration20260410171544 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "dictionary_entries" add column "position" int not null default 0, add column "is_default" boolean not null default false;`);
    this.addSql(`
      with ranked_entries as (
        select
          "id",
          row_number() over (
            partition by "dictionary_id", "organization_id", "tenant_id"
            order by lower("label"), lower("value"), "id"
          ) - 1 as "rank"
        from "dictionary_entries"
      )
      update "dictionary_entries" as "entries"
      set "position" = ranked_entries."rank"
      from ranked_entries
      where ranked_entries."id" = "entries"."id";
    `);
    this.addSql(`create unique index "dictionary_entries_one_default_per_dict" on "dictionary_entries" ("dictionary_id", "organization_id", "tenant_id") where "is_default" = true;`);
    this.addSql(`
      update "dictionary_entries" as "entries"
      set "is_default" = true
      from "dictionaries" as "dictionaries"
      where "entries"."dictionary_id" = "dictionaries"."id"
        and "dictionaries"."key" = 'customers.status'
        and "entries"."normalized_value" = 'active';
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "dictionary_entries_one_default_per_dict";`);
    this.addSql(`alter table "dictionary_entries" drop column "position", drop column "is_default";`);
  }

}
