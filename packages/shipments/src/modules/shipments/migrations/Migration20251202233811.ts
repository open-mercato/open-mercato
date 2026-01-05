import { Migration } from '@mikro-orm/migrations';

export class Migration20251202233811 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipments" add column "company_id" uuid null, add column "created_by_id" uuid null, add column "assigned_to_id" uuid null;`);

    this.addSql(`alter table "shipments" add constraint "shipments_company_id_foreign" foreign key ("company_id") references "customer_entities" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "shipments" add constraint "shipments_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "shipments" add constraint "shipments_assigned_to_id_foreign" foreign key ("assigned_to_id") references "users" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint "shipments_company_id_foreign";`);
    this.addSql(`alter table "shipments" drop constraint "shipments_created_by_id_foreign";`);
    this.addSql(`alter table "shipments" drop constraint "shipments_assigned_to_id_foreign";`);
    this.addSql(`alter table "shipments" drop column "company_id", drop column "created_by_id", drop column "assigned_to_id";`);
  }
}