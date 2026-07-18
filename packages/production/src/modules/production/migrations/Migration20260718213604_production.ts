import { Migration } from '@mikro-orm/migrations';

export class Migration20260718213604_production extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "production_reports" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_operation_id" uuid not null, "reporter_user_id" uuid not null, "qty_good" numeric(18,6) not null default 0, "qty_scrap" numeric(18,6) not null default 0, "scrap_reason_entry_id" uuid null, "started_at" timestamptz null, "finished_at" timestamptz null, "report_type" text not null, "reverses_report_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "production_reports_tenant_org_idx" on "production_reports" ("tenant_id", "organization_id");`);
    this.addSql(`create index "production_reports_operation_idx" on "production_reports" ("order_operation_id");`);
    this.addSql(`alter table "production_reports" add constraint "production_reports_reverses_unique" unique ("reverses_report_id");`);
    this.addSql(`alter table "production_reports" add constraint "production_reports_report_type_check" check ("report_type" in ('partial', 'final'));`);
  }

}
