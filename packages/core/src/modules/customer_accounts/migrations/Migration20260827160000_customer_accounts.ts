import { Migration } from '@mikro-orm/migrations';

export class Migration20260827160000_customer_accounts extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_users" drop constraint "customer_users_tenant_email_hash_uniq";`);
    this.addSql(`create unique index "customer_users_tenant_email_hash_uniq" on "customer_users" ("tenant_id", "email_hash") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "customer_users_tenant_email_hash_uniq";`);
    // Once the partial index has been live, a soft-deleted row legitimately shares
    // (tenant_id, email_hash) with a newer row — which is the point of this change —
    // so the full constraint cannot be restored while both exist. Purge the losing
    // soft-deleted duplicates first: this is destructive, but it only removes rows
    // that were already logically deleted, and without it `down()` fails on exactly
    // the data the migration enables. The surviving row is the active one, else the
    // most recently created.
    this.addSql(`delete from "customer_users" losing using "customer_users" winner where losing."deleted_at" is not null and losing."tenant_id" = winner."tenant_id" and losing."email_hash" = winner."email_hash" and losing."id" <> winner."id" and (winner."deleted_at" is null or winner."created_at" > losing."created_at" or (winner."created_at" = losing."created_at" and winner."id" > losing."id"));`);
    this.addSql(`alter table "customer_users" add constraint "customer_users_tenant_email_hash_uniq" unique ("tenant_id", "email_hash");`);
  }

}
