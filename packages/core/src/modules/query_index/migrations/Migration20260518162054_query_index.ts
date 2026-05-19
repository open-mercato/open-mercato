import { Migration } from '@mikro-orm/migrations';

export class Migration20260518162054_query_index extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "entity_indexes" add column if not exists "organization_id_coalesced" uuid generated always as (coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid)) stored not null;`);
    this.addSql(`
      delete from "entity_indexes" loser
      using (
        select "id"
        from (
          select
            "id",
            row_number() over (
              partition by "entity_type", "entity_id", "organization_id_coalesced"
              order by ("deleted_at" is null) desc, "updated_at" desc, "id" desc
            ) as row_number
          from "entity_indexes"
        ) ranked
        where ranked.row_number > 1
      ) duplicates
      where loser."id" = duplicates."id";
    `);
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'entity_indexes_type_entity_org_coalesced_unique'
        ) then
          alter table "entity_indexes" add constraint "entity_indexes_type_entity_org_coalesced_unique" unique ("entity_type", "entity_id", "organization_id_coalesced");
        end if;
      end $$;
    `);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "entity_indexes" drop constraint if exists "entity_indexes_type_entity_org_coalesced_unique";`);
    this.addSql(`alter table "entity_indexes" drop column "organization_id_coalesced";`);
  }

}
