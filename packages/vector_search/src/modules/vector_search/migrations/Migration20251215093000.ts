import { Migration } from '@mikro-orm/migrations'

export class Migration20251215093000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('create extension if not exists "vector";')

    this.addSql(`
      create table "vector_search_records" (
        "id" uuid not null default gen_random_uuid(),
        "entity_type" text not null,
        "record_id" text not null,
        "module_id" text not null,
        "organization_id" uuid null,
        "tenant_id" uuid null,
        "title" text not null,
        "lead" text null,
        "icon" text null,
        "primary_url" text not null,
        "links" jsonb null,
        "search_terms" jsonb null,
        "payload" jsonb null,
        "combined_text" text not null,
        "embedding" vector(1536) null,
        "embedding_model" text null,
        "embedding_dimensions" int null,
        "checksum" text not null,
        "last_indexed_at" timestamptz not null default now(),
        "embedding_error" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "vector_search_records_pkey" primary key ("id")
      );
    `)

    this.addSql('create index "vector_search_records_entity_idx" on "vector_search_records" ("entity_type", "record_id");')
    this.addSql('create index "vector_search_records_module_idx" on "vector_search_records" ("module_id");')
    this.addSql('create index "vector_search_records_org_idx" on "vector_search_records" ("organization_id");')
    this.addSql('create index "vector_search_records_tenant_idx" on "vector_search_records" ("tenant_id");')
    this.addSql('create unique index "vector_search_records_scope_unique" on "vector_search_records" ("entity_type", "record_id", coalesce("organization_id", \'00000000-0000-0000-0000-000000000000\'::uuid), coalesce("tenant_id", \'00000000-0000-0000-0000-000000000000\'::uuid));')
    this.addSql('create index "vector_search_records_embedding_idx" on "vector_search_records" using ivfflat ("embedding" vector_cosine_ops) with (lists = 100);')
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "vector_search_records_embedding_idx";')
    this.addSql('drop table if exists "vector_search_records" cascade;')
  }
}
