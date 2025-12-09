import { Migration } from '@mikro-orm/migrations';

export class Migration20251207144211 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint "shipments_company_id_foreign";`);

    this.addSql(`alter table "shipments" rename column "company_id" to "client_id";`);
    this.addSql(`alter table "shipments" add constraint "shipments_client_id_foreign" foreign key ("client_id") references "customer_entities" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint "shipments_client_id_foreign";`);

    this.addSql(`alter table "shipments" rename column "client_id" to "company_id";`);
    this.addSql(`alter table "shipments" add constraint "shipments_company_id_foreign" foreign key ("company_id") references "customer_entities" ("id") on update cascade on delete set null;`);
  }

}
