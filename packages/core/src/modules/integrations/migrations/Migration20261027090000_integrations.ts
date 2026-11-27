import { Migration } from '@mikro-orm/migrations'

export const INTEGRATION_STATES_SCOPE_UNIQUE = 'integration_states_scope_unique_idx'

export class Migration20261027090000_integrations extends Migration {
  override async up(): Promise<void> {
    this.addSql(`lock table "integration_states" in share row exclusive mode;`)

    this.addSql(`
      update "integration_states" duplicate
      set "deleted_at" = now()
      from (
        select
          state."id",
          row_number() over (
            partition by state."integration_id", state."organization_id", state."tenant_id"
            order by state."updated_at" desc, state."created_at" desc, state."id" desc
          ) as keep_rank
        from "integration_states" state
        where state."deleted_at" is null
      ) ranked
      where duplicate."id" = ranked."id"
        and ranked.keep_rank > 1;
    `)

    this.addSql(
      `create unique index if not exists "${INTEGRATION_STATES_SCOPE_UNIQUE}" on "integration_states" ("integration_id", "organization_id", "tenant_id") where "deleted_at" is null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "${INTEGRATION_STATES_SCOPE_UNIQUE}";`)
  }
}
