import { Migration } from '@mikro-orm/migrations';

export class Migration20260827160000_customer_accounts extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_users" drop constraint "customer_users_tenant_email_hash_uniq";`);
    this.addSql(`create unique index "customer_users_tenant_email_hash_uniq" on "customer_users" ("tenant_id", "email_hash") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "customer_users_tenant_email_hash_uniq";`);
    this.addSql(`alter table "customer_users" add constraint "customer_users_tenant_email_hash_uniq" unique ("tenant_id", "email_hash");`);
  }

}
