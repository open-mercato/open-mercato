import { Migration } from '@mikro-orm/migrations';

export class Migration20260114184200 extends Migration {

  override async up(): Promise<void> {
    // Add client_id column as FK to contractors
    this.addSql(`alter table "fms_quotes" add column "client_id" uuid null;`);
    this.addSql(`alter table "fms_quotes" add constraint "fms_quotes_client_id_foreign" foreign key ("client_id") references "contractors" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "fms_quotes_client_idx" on "fms_quotes" ("client_id");`);

    // Create pivot table for origin ports (ManyToMany)
    this.addSql(`create table "fms_quote_origin_ports" ("quote_id" uuid not null, "location_id" uuid not null, constraint "fms_quote_origin_ports_pkey" primary key ("quote_id", "location_id"));`);
    this.addSql(`alter table "fms_quote_origin_ports" add constraint "fms_quote_origin_ports_quote_id_foreign" foreign key ("quote_id") references "fms_quotes" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "fms_quote_origin_ports" add constraint "fms_quote_origin_ports_location_id_foreign" foreign key ("location_id") references "fms_locations" ("id") on update cascade on delete cascade;`);

    // Create pivot table for destination ports (ManyToMany)
    this.addSql(`create table "fms_quote_destination_ports" ("quote_id" uuid not null, "location_id" uuid not null, constraint "fms_quote_destination_ports_pkey" primary key ("quote_id", "location_id"));`);
    this.addSql(`alter table "fms_quote_destination_ports" add constraint "fms_quote_destination_ports_quote_id_foreign" foreign key ("quote_id") references "fms_quotes" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "fms_quote_destination_ports" add constraint "fms_quote_destination_ports_location_id_foreign" foreign key ("location_id") references "fms_locations" ("id") on update cascade on delete cascade;`);

    // Drop old string columns (optional - keeping for now for data migration if needed)
    // this.addSql(`alter table "fms_quotes" drop column "client_name", drop column "origin_port_code", drop column "destination_port_code";`);
  }

  override async down(): Promise<void> {
    // Drop pivot tables
    this.addSql(`drop table if exists "fms_quote_origin_ports" cascade;`);
    this.addSql(`drop table if exists "fms_quote_destination_ports" cascade;`);

    // Drop client_id column and its constraints
    this.addSql(`alter table "fms_quotes" drop constraint if exists "fms_quotes_client_id_foreign";`);
    this.addSql(`drop index if exists "fms_quotes_client_idx";`);
    this.addSql(`alter table "fms_quotes" drop column if exists "client_id";`);
  }

}
