import { Migration } from '@mikro-orm/migrations';

export class Migration20260408225345 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_person_company_links" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "is_primary" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "person_entity_id" uuid not null, "company_entity_id" uuid not null, constraint "customer_person_company_links_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_person_company_links_scope_idx" on "customer_person_company_links" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_person_company_links_company_idx" on "customer_person_company_links" ("company_entity_id");`);
    this.addSql(`create index "customer_person_company_links_person_idx" on "customer_person_company_links" ("person_entity_id");`);
    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_unique" unique ("person_entity_id", "company_entity_id");`);

    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade;`);
    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_deals" add column "closure_outcome" text null, add column "loss_reason_id" uuid null, add column "loss_notes" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_deals" drop column "closure_outcome", drop column "loss_reason_id", drop column "loss_notes";`);
    this.addSql(`drop table if exists "customer_person_company_links" cascade;`);
  }

}
