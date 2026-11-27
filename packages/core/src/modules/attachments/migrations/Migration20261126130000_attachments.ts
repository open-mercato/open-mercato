import { Migration } from '@mikro-orm/migrations'

export class Migration20261126130000_attachments extends Migration {
  override name = 'Migration20261126130000'

  override up(): void {
    this.addSql(`
      do $$
      begin
        if exists (
          select 1
          from "attachments" as attachment
          join "attachment_partitions" as partition on partition."code" = attachment."partition_code"
          where not (
            (partition."tenant_id" is null and partition."organization_id" is null)
            or (
              partition."tenant_id" is not null
              and partition."tenant_id" is not distinct from attachment."tenant_id"
              and (
                partition."organization_id" is null
                or partition."organization_id" is not distinct from attachment."organization_id"
              )
            )
          )
        ) then
          raise exception 'Attachment partition ownership preflight failed'
            using hint = 'Rehome affected attachments before retrying. See the organization and attachment partition ownership section of UPGRADE_NOTES.md.';
        end if;
      end
      $$;
    `)
    this.addSql('create unique index "attachment_partitions_scope_code_unique" on "attachment_partitions" ("code", "tenant_id", "organization_id") nulls not distinct;')
    this.addSql('alter table "attachment_partitions" drop constraint "attachment_partitions_code_unique";')
  }

  override down(): void {
    this.addSql('alter table "attachment_partitions" add constraint "attachment_partitions_code_unique" unique ("code");')
    this.addSql('drop index "attachment_partitions_scope_code_unique";')
  }
}
