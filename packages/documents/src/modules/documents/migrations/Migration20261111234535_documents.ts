import { Migration } from '@mikro-orm/migrations';

export class Migration20261111234535_documents extends Migration {

  override name = 'Migration20261111234535';

  override up(): void | Promise<void> {
    this.addSql(`create table "document_review_playbooks" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" varchar(64) not null, "name" varchar(200) not null, "description" text null, "instructions" text null, "version" int not null default 1, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "document_review_playbooks_code_uq" on "document_review_playbooks" ("tenant_id", "organization_id", "code") where "deleted_at" is null;`);
    this.addSql(`create index "document_review_playbooks_scope_idx" on "document_review_playbooks" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "document_review_playbook_references" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "playbook_id" uuid not null, "document_id" uuid not null, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "document_review_playbook_references_uq" on "document_review_playbook_references" ("playbook_id", "document_id") where "deleted_at" is null;`);
    this.addSql(`create index "document_review_playbook_references_document_idx" on "document_review_playbook_references" ("document_id");`);
    this.addSql(`create index "document_review_playbook_references_scope_idx" on "document_review_playbook_references" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "document_review_rules" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "playbook_id" uuid not null, "code" varchar(64) not null, "title" varchar(200) not null, "topic" varchar(120) null, "position" text not null, "preferred_wording" text null, "severity" varchar(16) not null, "sort_order" int not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "document_review_rules_code_uq" on "document_review_rules" ("playbook_id", "code") where "deleted_at" is null;`);
    this.addSql(`create index "document_review_rules_playbook_idx" on "document_review_rules" ("playbook_id", "sort_order");`);
    this.addSql(`create index "document_review_rules_scope_idx" on "document_review_rules" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`alter table "document_findings" add "playbook_id" uuid null, add "playbook_version" int null, add "rule_id" uuid null;`);
    this.addSql(`alter table "document_findings" add constraint "document_findings_playbook_id_foreign" foreign key ("playbook_id") references "document_review_playbooks" ("id") on delete set null;`);
    this.addSql(`alter table "document_findings" add constraint "document_findings_rule_id_foreign" foreign key ("rule_id") references "document_review_rules" ("id") on delete set null;`);

    this.addSql(`alter table "document_review_playbook_references" add constraint "document_review_playbook_references_playbook_id_foreign" foreign key ("playbook_id") references "document_review_playbooks" ("id") on delete cascade;`);
    this.addSql(`alter table "document_review_playbook_references" add constraint "document_review_playbook_references_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`);

    this.addSql(`alter table "document_review_rules" add constraint "document_review_rules_playbook_id_foreign" foreign key ("playbook_id") references "document_review_playbooks" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "document_findings" drop constraint if exists "document_findings_playbook_id_foreign";`);
    this.addSql(`alter table "document_findings" drop constraint if exists "document_findings_rule_id_foreign";`);
    this.addSql(`alter table "document_findings" drop column if exists "playbook_id", drop column if exists "playbook_version", drop column if exists "rule_id";`);

    this.addSql(`drop table if exists "document_review_playbook_references" cascade;`);
    this.addSql(`drop table if exists "document_review_rules" cascade;`);
    this.addSql(`drop table if exists "document_review_playbooks" cascade;`);
  }

}
