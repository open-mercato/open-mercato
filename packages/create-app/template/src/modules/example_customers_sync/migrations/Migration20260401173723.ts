import { Migration } from '@mikro-orm/migrations';

export class Migration20260401173723 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "example_customer_interaction_mappings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "interaction_id" uuid not null, "todo_id" uuid not null, "sync_status" text not null default 'pending', "last_synced_at" timestamptz null, "last_error" text null, "source_updated_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "example_customer_interaction_mappings_pkey" primary key ("id"));`);
    this.addSql(`create index "example_customer_interaction_mappings_status_idx" on "example_customer_interaction_mappings" ("organization_id", "tenant_id", "sync_status", "updated_at");`);
    this.addSql(`alter table "example_customer_interaction_mappings" add constraint "example_customer_interaction_mappings_todo_unique" unique ("organization_id", "tenant_id", "todo_id");`);
    this.addSql(`alter table "example_customer_interaction_mappings" add constraint "example_customer_interaction_mappings_interaction_unique" unique ("organization_id", "tenant_id", "interaction_id");`);
    this.addSql(`
      do $$
      begin
        if exists (
          select 1
          from information_schema.tables
          where table_schema = current_schema()
            and table_name = 'feature_toggles'
        ) then
          insert into "feature_toggles" ("identifier", "name", "description", "category", "default_value", "type", "created_at", "updated_at")
          select 'example.customers_sync.enabled', 'Example Customers Sync Enabled', 'When enabled, canonical customer tasks are synced to the example todo module.', 'example', 'false'::jsonb, 'boolean', now(), now()
          where not exists (
            select 1
            from "feature_toggles"
            where "identifier" = 'example.customers_sync.enabled'
              and "deleted_at" is null
          );

          insert into "feature_toggles" ("identifier", "name", "description", "category", "default_value", "type", "created_at", "updated_at")
          select 'example.customers_sync.bidirectional', 'Example Customers Sync Bidirectional', 'When enabled, updates from the example todo module sync back to canonical customer tasks.', 'example', 'false'::jsonb, 'boolean', now(), now()
          where not exists (
            select 1
            from "feature_toggles"
            where "identifier" = 'example.customers_sync.bidirectional'
              and "deleted_at" is null
          );
        end if;
      end
      $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if exists (
          select 1
          from information_schema.tables
          where table_schema = current_schema()
            and table_name = 'feature_toggles'
        ) then
          if exists (
            select 1
            from information_schema.tables
            where table_schema = current_schema()
              and table_name = 'feature_toggle_overrides'
          ) then
            delete from "feature_toggle_overrides"
            where "toggle_id" in (
              select "id"
              from "feature_toggles"
              where "identifier" in ('example.customers_sync.enabled', 'example.customers_sync.bidirectional')
            );
          end if;

          if exists (
            select 1
            from information_schema.tables
            where table_schema = current_schema()
              and table_name = 'feature_toggle_audit_logs'
          ) then
            delete from "feature_toggle_audit_logs"
            where "toggle_id" in (
              select "id"
              from "feature_toggles"
              where "identifier" in ('example.customers_sync.enabled', 'example.customers_sync.bidirectional')
            );
          end if;

          delete from "feature_toggles"
          where "identifier" in ('example.customers_sync.enabled', 'example.customers_sync.bidirectional');
        end if;
      end
      $$;
    `);
    this.addSql(`drop table if exists "example_customer_interaction_mappings" cascade;`);
  }

}
