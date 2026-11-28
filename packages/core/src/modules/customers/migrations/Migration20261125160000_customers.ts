import { Migration } from '@mikro-orm/migrations'

export class Migration20261125160000_customers extends Migration {
  override up(): void {
    this.addSql(`alter table "customer_person_company_links" add column "employment_ended_on" date null, add column "employment_status" text not null default 'active';`)
  }

  override down(): void {
    this.addSql(`alter table "customer_person_company_links" drop column "employment_ended_on", drop column "employment_status";`)
  }
}
