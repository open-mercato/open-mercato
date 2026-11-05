import { Migration } from '@mikro-orm/migrations';

export class Migration20260430120000_customer_accounts extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "domain_mappings" (
      "id" uuid not null default gen_random_uuid(),
      "hostname" text not null,
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "replaces_domain_id" uuid null,
      "provider" text not null default 'traefik',
      "status" text not null default 'pending',
      "verified_at" timestamptz null,
      "last_dns_check_at" timestamptz null,
      "dns_failure_reason" varchar(500) null,
      "tls_failure_reason" varchar(500) null,
      "tls_retry_count" int not null default 0,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz null,
      constraint "domain_mappings_pkey" primary key ("id"),
      constraint "domain_mappings_replaces_domain_id_foreign" foreign key ("replaces_domain_id") references "domain_mappings" ("id") on delete set null
    );`);

    this.addSql(`create unique index "domain_mappings_hostname_unique" on "domain_mappings" ("hostname");`);
    this.addSql(`create index "domain_mappings_organization_id_idx" on "domain_mappings" ("organization_id");`);
    this.addSql(`create index "domain_mappings_tenant_id_idx" on "domain_mappings" ("tenant_id");`);
    this.addSql(`create unique index "domain_mappings_replaces_domain_id_unique" on "domain_mappings" ("replaces_domain_id") where "replaces_domain_id" is not null;`);
    this.addSql(`create index "domain_mappings_pending_verification_idx" on "domain_mappings" ("status", "last_dns_check_at") where "status" in ('pending', 'dns_failed');`);
    this.addSql(`create index "domain_mappings_pending_tls_idx" on "domain_mappings" ("status", "updated_at") where "status" in ('verified', 'tls_failed');`);
    this.addSql(`alter table "domain_mappings" add constraint "domain_mappings_hostname_normalized_chk" check ("hostname" = lower("hostname") and "hostname" not like '%.');`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "domain_mappings" cascade;`);
  }

}
