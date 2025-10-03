import { Migration } from '@mikro-orm/migrations'

export class Migration20251001120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "entity_indexes" (
        "id" uuid not null default gen_random_uuid(),
        "entity_type" text not null,
        "entity_id" text not null,
        "organization_id" uuid null,
        "tenant_id" uuid null,
        "doc" jsonb not null,
        "index_version" int not null default 1,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "entity_indexes_pkey" primary key ("id")
      );
    `)
    this.addSql('create index if not exists "entity_indexes_type_idx" on "entity_indexes" ("entity_type");')
    this.addSql('create index if not exists "entity_indexes_entity_idx" on "entity_indexes" ("entity_id");')
    this.addSql('create index if not exists "entity_indexes_org_idx" on "entity_indexes" ("organization_id");')
    this.addSql('create index if not exists "entity_indexes_doc_gin" on "entity_indexes" using gin ("doc" jsonb_path_ops);')
    // Uniqueness:
    // - For scoped rows (organization_id IS NOT NULL): unique on (entity_type, entity_id, organization_id)
    // - For global rows (organization_id IS NULL): unique on (entity_type, entity_id)
    this.addSql('create unique index if not exists "entity_indexes_unique_scoped" on "entity_indexes" ("entity_type", "entity_id", "organization_id") where organization_id is not null;')
    this.addSql('create unique index if not exists "entity_indexes_unique_global" on "entity_indexes" ("entity_type", "entity_id") where organization_id is null;')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "entity_indexes" cascade;')
  }
}
