import { Migration } from '@mikro-orm/migrations';

export class Migration20260324100000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "user_consents" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "consent_type" text not null, "is_granted" boolean not null default false, "granted_at" timestamptz null, "withdrawn_at" timestamptz null, "source" text null, "ip_address" text null, "integrity_hash" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "user_consents_pkey" primary key ("id"));`);
    this.addSql(`alter table "user_consents" add constraint "user_consents_user_id_tenant_id_consent_type_unique" unique ("user_id", "tenant_id", "consent_type");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "user_consents" cascade;`);
  }

}
