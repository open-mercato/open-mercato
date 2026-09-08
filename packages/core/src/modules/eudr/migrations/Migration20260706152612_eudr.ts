import { Migration } from '@mikro-orm/migrations';

export class Migration20260706152612_eudr extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "eudr_mitigation_actions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "risk_assessment_id" uuid not null, "action_type" text not null default 'other', "title" text not null, "description" text null, "status" text not null default 'planned', "due_date" timestamptz null, "completed_at" timestamptz null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "idx_eudr_mitigation_actions_risk_assessment" on "eudr_mitigation_actions" ("risk_assessment_id");`);

    this.addSql(`create table "eudr_plots" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "supplier_entity_id" uuid not null, "supplier_snapshot" jsonb null, "name" text not null, "external_id" text null, "description" text null, "origin_country" text not null, "plot_type" text not null default 'point', "geometry" jsonb not null, "area_ha" numeric(12,4) null, "validation_warnings" jsonb not null default '[]', "producer_name" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "idx_eudr_plots_supplier" on "eudr_plots" ("supplier_entity_id");`);

    this.addSql(`create table "eudr_risk_assessments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "statement_id" uuid not null, "country_risks" jsonb not null default '[]', "overall_tier" text not null default 'unknown', "criteria" jsonb not null default '{}', "conclusion" text not null default 'non_negligible', "is_simplified" boolean not null default false, "assessed_at" timestamptz not null, "assessed_by_name" text null, "review_due_at" timestamptz null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "idx_eudr_risk_assessments_statement" on "eudr_risk_assessments" ("statement_id");`);

    this.addSql(`alter table "eudr_due_diligence_statements" add "activity_type" text null, add "actor_role" text null, add "referenced_statements" jsonb not null default '[]', add "supplementary_unit" text null, add "supplementary_quantity" numeric(14,3) null, add "submitted_at" timestamptz null, add "reference_issued_at" timestamptz null, add "order_snapshot" jsonb null;`);

    this.addSql(`alter table "eudr_evidence_submissions" add "plot_ids" jsonb not null default '[]';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "eudr_due_diligence_statements" drop column "activity_type", drop column "actor_role", drop column "referenced_statements", drop column "supplementary_unit", drop column "supplementary_quantity", drop column "submitted_at", drop column "reference_issued_at", drop column "order_snapshot";`);

    this.addSql(`alter table "eudr_evidence_submissions" drop column "plot_ids";`);

    this.addSql(`drop table if exists "eudr_mitigation_actions" cascade;`);
    this.addSql(`drop table if exists "eudr_risk_assessments" cascade;`);
    this.addSql(`drop table if exists "eudr_plots" cascade;`);
  }

}
