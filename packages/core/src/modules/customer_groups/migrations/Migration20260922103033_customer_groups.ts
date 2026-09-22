import { Migration } from '@mikro-orm/migrations';

export class Migration20260922103033_customer_groups extends Migration {

  override name = 'Migration20260922103033';

  override up(): void | Promise<void> {
    // The (tenant_id, priority) uniqueness was originally a plain table constraint,
    // which does not exclude soft-deleted rows: a deleted group's priority stayed
    // permanently reserved and could collide with a value the drag-reorder command
    // (gaps of 10) later tried to assign to a live group. Replace it with a partial
    // unique index scoped to deleted_at IS NULL, matching customer_groups_tenant_default_unique.
    this.addSql(`alter table "customer_groups" drop constraint "customer_groups_tenant_priority_unique";`);
    this.addSql(`create unique index "customer_groups_tenant_priority_unique" on "customer_groups" ("tenant_id", "priority") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "customer_groups_tenant_priority_unique";`);
    this.addSql(`alter table "customer_groups" add constraint "customer_groups_tenant_priority_unique" unique ("tenant_id", "priority");`);
  }

}
