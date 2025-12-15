import { Migration } from '@mikro-orm/migrations';

export class Migration20251202212842 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint if exists "shipments_container_type_check";`);

    this.addSql(`alter table "shipments" alter column "container_type" type varchar(255) using ("container_type"::varchar(255));`);
    this.addSql(`alter table "shipments" alter column "container_type" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipments" alter column "container_type" type text using ("container_type"::text);`);
    this.addSql(`alter table "shipments" alter column "container_type" set not null;`);
    this.addSql(`alter table "shipments" add constraint "shipments_container_type_check" check("container_type" in ('20FT', '40FT', '40FT_HC', '45FT'));`);
  }

}
