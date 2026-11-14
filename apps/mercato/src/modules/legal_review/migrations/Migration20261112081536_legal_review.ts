import { Migration } from '@mikro-orm/migrations';

export class Migration20261112081536_legal_review extends Migration {

  override name = 'Migration20261112081536';

  override up(): void | Promise<void> {
    this.addSql(`create table "legal_review_matters" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "reference" text not null, "counterparty" text not null, "purpose" text null, "jurisdiction" text null, "agreement_type" text not null default 'mutual_nda', "paper" text not null default 'counterparty', "requested_by_user_id" uuid null, "assignee_user_id" uuid null, "stage" text not null default 'requested', "due_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "legal_review_matters_document_idx" on "legal_review_matters" ("tenant_id", "organization_id", "document_id");`);
    this.addSql(`create index "legal_review_matters_scope_idx" on "legal_review_matters" ("tenant_id", "organization_id", "deleted_at");`);
  }

}
