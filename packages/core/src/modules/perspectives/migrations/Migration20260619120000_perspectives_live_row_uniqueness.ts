import { Migration } from '@mikro-orm/migrations';

export class Migration20260619120000_perspectives_live_row_uniqueness extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      with ranked as (
        select id,
               row_number() over (
                 partition by user_id, tenant_id, organization_id, table_id, name
                 order by coalesce(updated_at, created_at) desc, created_at desc, id desc
               ) as rn
        from perspectives
        where deleted_at is null
      )
      update perspectives
      set deleted_at = now(), is_default = false
      from ranked
      where perspectives.id = ranked.id and ranked.rn > 1;
    `);
    this.addSql(`alter table "perspectives" drop constraint if exists "perspectives_user_id_tenant_id_organization_id_ta_2d725_unique";`);
    this.addSql(`alter table "perspectives" drop constraint if exists "perspectives_user_id_tenant_id_organization_id_ta_0c702_unique";`);
    this.addSql(`create unique index if not exists "perspectives_live_user_org_uq" on "perspectives" ("user_id", "tenant_id", "organization_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is not null and "organization_id" is not null;`);
    this.addSql(`create unique index if not exists "perspectives_live_user_tenant_uq" on "perspectives" ("user_id", "tenant_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is not null and "organization_id" is null;`);
    this.addSql(`create unique index if not exists "perspectives_live_user_org_only_uq" on "perspectives" ("user_id", "organization_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is null and "organization_id" is not null;`);
    this.addSql(`create unique index if not exists "perspectives_live_user_global_uq" on "perspectives" ("user_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is null and "organization_id" is null;`);

    this.addSql(`
      with ranked as (
        select id,
               row_number() over (
                 partition by role_id, tenant_id, organization_id, table_id, name
                 order by coalesce(updated_at, created_at) desc, created_at desc, id desc
               ) as rn
        from role_perspectives
        where deleted_at is null
      )
      update role_perspectives
      set deleted_at = now(), is_default = false
      from ranked
      where role_perspectives.id = ranked.id and ranked.rn > 1;
    `);
    this.addSql(`alter table "role_perspectives" drop constraint if exists "role_perspectives_role_id_tenant_id_organization__c5467_unique";`);
    this.addSql(`alter table "role_perspectives" drop constraint if exists "role_perspectives_role_id_tenant_id_organization__f0fc6_unique";`);
    this.addSql(`create unique index if not exists "role_perspectives_live_role_org_uq" on "role_perspectives" ("role_id", "tenant_id", "organization_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is not null and "organization_id" is not null;`);
    this.addSql(`create unique index if not exists "role_perspectives_live_role_tenant_uq" on "role_perspectives" ("role_id", "tenant_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is not null and "organization_id" is null;`);
    this.addSql(`create unique index if not exists "role_perspectives_live_role_org_only_uq" on "role_perspectives" ("role_id", "organization_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is null and "organization_id" is not null;`);
    this.addSql(`create unique index if not exists "role_perspectives_live_role_global_uq" on "role_perspectives" ("role_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is null and "organization_id" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "perspectives_live_user_org_uq";`);
    this.addSql(`drop index if exists "perspectives_live_user_tenant_uq";`);
    this.addSql(`drop index if exists "perspectives_live_user_org_only_uq";`);
    this.addSql(`drop index if exists "perspectives_live_user_global_uq";`);
    this.addSql(`alter table "perspectives" add constraint "perspectives_user_id_tenant_id_organization_id_ta_2d725_unique" unique ("user_id", "tenant_id", "organization_id", "table_id", "name");`);

    this.addSql(`drop index if exists "role_perspectives_live_role_org_uq";`);
    this.addSql(`drop index if exists "role_perspectives_live_role_tenant_uq";`);
    this.addSql(`drop index if exists "role_perspectives_live_role_org_only_uq";`);
    this.addSql(`drop index if exists "role_perspectives_live_role_global_uq";`);
    this.addSql(`alter table "role_perspectives" add constraint "role_perspectives_role_id_tenant_id_organization__c5467_unique" unique ("role_id", "tenant_id", "organization_id", "table_id", "name");`);
  }

}
