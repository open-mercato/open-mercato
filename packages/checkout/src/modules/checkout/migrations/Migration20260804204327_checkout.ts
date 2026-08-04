import { Migration } from '@mikro-orm/migrations';

export class Migration20260804204327_checkout extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`drop index "checkout_links_slug_index";`);
    this.addSql(`create unique index "checkout_links_slug_unique" on "checkout_links" ("organization_id", "tenant_id", "slug") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "checkout_links_slug_unique";`);
    this.addSql(`create index "checkout_links_slug_index" on "checkout_links" ("slug");`);
  }

}
