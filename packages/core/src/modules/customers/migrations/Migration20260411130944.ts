import { Migration } from '@mikro-orm/migrations';

export class Migration20260411130944 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_company_billing" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "entity_id" uuid not null, "bank_name" text null, "bank_account_masked" text null, "payment_terms" text null, "preferred_currency" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_company_billing_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_company_billing_scope_idx" on "customer_company_billing" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "customer_company_billing" add constraint "customer_company_billing_entity_unique" unique ("entity_id");`);

    this.addSql(`create table "customer_person_company_roles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "person_entity_id" uuid not null, "company_entity_id" uuid not null, "role_value" text not null, "created_at" timestamptz not null, constraint "customer_person_company_roles_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_pcr_person_company_idx" on "customer_person_company_roles" ("person_entity_id", "company_entity_id");`);
    this.addSql(`create index "customer_pcr_scope_idx" on "customer_person_company_roles" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_pcr_unique" unique ("person_entity_id", "company_entity_id", "role_value");`);

    this.addSql(`alter table "customer_company_billing" add constraint "customer_company_billing_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_person_company_roles_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade;`);
    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_person_company_roles_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_person_company_roles" drop constraint if exists "customer_person_company_roles_company_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_roles" drop constraint if exists "customer_person_company_roles_person_entity_id_foreign";`);
    this.addSql(`alter table "customer_company_billing" drop constraint if exists "customer_company_billing_entity_id_foreign";`);

    this.addSql(`drop table if exists "customer_person_company_roles";`);
    this.addSql(`drop table if exists "customer_company_billing";`);
  }

}
