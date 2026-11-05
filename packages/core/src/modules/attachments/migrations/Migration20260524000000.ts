import { Migration } from '@mikro-orm/migrations'

export class Migration20260524000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "attachment_partitions" add column "organization_id" uuid null;`,
    )
    this.addSql(
      `alter table "attachment_partitions" add column "tenant_id" uuid null;`,
    )
    this.addSql(
      `create index "attachment_partitions_tenant_idx" on "attachment_partitions" ("tenant_id");`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "attachment_partitions_tenant_idx";`)
    this.addSql(
      `alter table "attachment_partitions" drop column "tenant_id";`,
    )
    this.addSql(
      `alter table "attachment_partitions" drop column "organization_id";`,
    )
  }
}
