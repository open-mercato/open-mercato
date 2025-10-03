import { Migration } from '@mikro-orm/migrations'

// Storage for user-defined entity records. Mirrors entity_indexes structure.
export class Migration20251003120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "custom_entities_storage" (
        "id" uuid not null default gen_random_uuid(),
        "entity_type" text not null,
        "entity_id" text not null,
        "organization_id" uuid null,
        "tenant_id" uuid null,
        "doc" jsonb not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "custom_entities_storage_pkey" primary key ("id")
      );
    `)
    this.addSql('create index if not exists "custom_entities_storage_type_idx" on "custom_entities_storage" ("entity_type");')
    this.addSql('create index if not exists "custom_entities_storage_entity_idx" on "custom_entities_storage" ("entity_id");')
    this.addSql('create index if not exists "custom_entities_storage_org_idx" on "custom_entities_storage" ("organization_id");')
    this.addSql('create index if not exists "custom_entities_storage_doc_gin" on "custom_entities_storage" using gin ("doc" jsonb_path_ops);')
    // Uniqueness: scoped-by-org vs global
    this.addSql('create unique index if not exists "custom_entities_storage_unique_scoped" on "custom_entities_storage" ("entity_type", "entity_id", "organization_id") where organization_id is not null;')
    this.addSql('create unique index if not exists "custom_entities_storage_unique_global" on "custom_entities_storage" ("entity_type", "entity_id") where organization_id is null;')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "custom_entities_storage" cascade;')
  }
}

