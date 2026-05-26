import { Migration } from '@mikro-orm/migrations';

export class Migration20260415095203 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_person_company_links" add column "deleted_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_person_company_links" drop column "deleted_at";`);
  }

}
