import { Migration } from '@mikro-orm/migrations';

export class Migration20260606205453_query_index extends Migration {

  override up(): void | Promise<void> {
    // De-duplicate scope rows that the pre-#2739 read-then-write prepareJob could
    // create when two schedulers raced. Keep the most relevant per coalesced scope
    // (still-running first, then most recently started). Required before the unique
    // index can be created.
    this.addSql(`
      delete from "entity_index_jobs" loser
      using (
        select "id"
        from (
          select
            "id",
            row_number() over (
              partition by
                "entity_type",
                coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid),
                coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),
                coalesce("partition_index", -1),
                coalesce("partition_count", -1)
              order by ("finished_at" is null) desc, "started_at" desc, "id" desc
            ) as row_number
          from "entity_index_jobs"
        ) ranked
        where ranked.row_number > 1
      ) duplicates
      where loser."id" = duplicates."id";
    `);
    this.addSql(`create unique index if not exists "entity_index_jobs_scope_unique" on "entity_index_jobs" ("entity_type", coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid), coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), coalesce("partition_index", -1), coalesce("partition_count", -1));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "entity_index_jobs_scope_unique";`);
  }

}
