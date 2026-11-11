import { Migration } from '@mikro-orm/migrations';

export class Migration20261111231158_documents extends Migration {

  override name = 'Migration20261111231158';

  override up(): void | Promise<void> {
    this.addSql(`create table "document_findings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "review_id" uuid not null, "source" varchar(16) not null, "source_workflow_instance_id" varchar(64) null, "source_agent_run_id" varchar(64) null, "rule_code" varchar(64) null, "severity" varchar(16) not null, "title" varchar(200) not null, "explanation" text not null, "section_label" varchar(256) null, "quote" text not null, "occurrence" smallint not null default 1, "suggested_text" text null, "anchor" jsonb null, "anchor_status" varchar(16) not null, "status" varchar(16) not null, "applied_text" text null, "decision_note" text null, "decided_by_user_id" uuid null, "decided_at" timestamptz null, "created_by_user_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "document_findings_review_idx" on "document_findings" ("review_id");`);
    this.addSql(`create index "document_findings_scope_idx" on "document_findings" ("organization_id", "tenant_id", "deleted_at");`);
    this.addSql(`create index "document_findings_document_status_idx" on "document_findings" ("document_id", "status", "severity") where "deleted_at" is null;`);

    this.addSql(`alter table "document_findings" add constraint "document_findings_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "document_findings" cascade;`);
  }

}
