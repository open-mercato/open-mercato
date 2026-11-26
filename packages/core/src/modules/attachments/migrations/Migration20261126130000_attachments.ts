import { Migration } from '@mikro-orm/migrations'

export class Migration20261126130000_attachments extends Migration {
  override name = 'Migration20261126130000'

  override up(): void {
    this.addSql('create unique index "attachment_partitions_scope_code_unique" on "attachment_partitions" ("code", "tenant_id", "organization_id") nulls not distinct;')
    this.addSql('alter table "attachment_partitions" drop constraint "attachment_partitions_code_unique";')
  }

  override down(): void {
    this.addSql('alter table "attachment_partitions" add constraint "attachment_partitions_code_unique" unique ("code");')
    this.addSql('drop index "attachment_partitions_scope_code_unique";')
  }
}
