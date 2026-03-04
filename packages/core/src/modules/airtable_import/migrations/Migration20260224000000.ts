import { Migration } from "@mikro-orm/migrations";

export class Migration20260224000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "import_sessions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "status" text not null default 'draft', "current_step" int not null default 1, "airtable_token" text not null, "airtable_base_id" text not null, "airtable_base_name" text null, "schema_json" jsonb null, "mapping_json" jsonb null, "config_json" jsonb null, "plan_json" jsonb null, "progress_json" jsonb null, "report_json" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "import_sessions_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "import_sessions_tenant_org_idx" on "import_sessions" ("tenant_id", "organization_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "import_sessions";`);
  }
}
