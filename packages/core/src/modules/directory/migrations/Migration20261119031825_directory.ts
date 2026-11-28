import { Migration } from '@mikro-orm/migrations'
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex'

export const queryIndexReindexEntityTypes = declareQueryIndexReindex(['directory:organization'])

export class Migration20261119031825_directory extends Migration {

  override name = 'Migration20261119031825'

  override up(): void {
    this.addSql('lock table "organizations" in share row exclusive mode;')
    this.addSql(`
      do $repair_portal_slugs$
      declare
        duplicate record;
        suffix_number bigint;
        suffix text;
        candidate text;
      begin
        for duplicate in
          select ranked.*
          from (
            select id, tenant_id, slug, created_at,
              row_number() over (partition by lower(slug) order by created_at, id) as slug_rank
            from organizations
            where deleted_at is null and slug is not null
          ) ranked
          where ranked.slug_rank > 1
          order by ranked.created_at, ranked.id
        loop
          suffix_number := duplicate.slug_rank - 1;
          loop
            suffix := '-' || suffix_number;
            candidate := left(duplicate.slug, 150 - length(suffix)) || suffix;
            exit when not exists (
              select 1
              from organizations existing
              where lower(existing.slug) = lower(candidate)
                and (existing.deleted_at is null or existing.tenant_id = duplicate.tenant_id)
            );
            suffix_number := suffix_number + 1;
          end loop;
          update organizations
          set slug = candidate, updated_at = current_timestamp
          where id = duplicate.id;
        end loop;
      end;
      $repair_portal_slugs$;
    `)
    this.addSql(`create unique index "organizations_live_slug_uniq" on "organizations" (lower("slug")) where "deleted_at" is null;`)
  }

  override down(): void {
    this.addSql(`drop index "organizations_live_slug_uniq";`)
  }

}
