import { Migration } from '@mikro-orm/migrations';

export class Migration20260923193330_customer_groups extends Migration {

  override name = 'Migration20260923193330';

  override up(): void | Promise<void> {
    // Same soft-delete fix as Migration20260922103033 applied to (tenant_id, code): the
    // plain table constraint kept a deleted group's code permanently reserved, so
    // recreating a group with that code failed with a raw unique violation.
    this.addSql(`alter table "customer_groups" drop constraint "customer_groups_tenant_code_unique";`);
    this.addSql(`create unique index "customer_groups_tenant_code_unique" on "customer_groups" ("tenant_id", "code") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "customer_groups_tenant_code_unique";`);
    this.addSql(`alter table "customer_groups" add constraint "customer_groups_tenant_code_unique" unique ("tenant_id", "code");`);
  }

}
