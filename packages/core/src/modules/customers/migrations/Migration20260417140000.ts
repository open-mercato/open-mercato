import { Migration } from '@mikro-orm/migrations';

export class Migration20260417140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_person_company_links" drop constraint if exists "customer_person_company_links_unique";`);
    this.addSql(`create unique index "customer_person_company_links_active_unique" on "customer_person_company_links" ("person_entity_id", "company_entity_id") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "customer_person_company_links_active_unique";`);
    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_unique" unique ("person_entity_id", "company_entity_id");`);
  }

}
