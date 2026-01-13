import { Migration } from '@mikro-orm/migrations';

export class Migration20260104181357 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index "feature_toggle_overrides_org_idx";`);
    this.addSql(`alter table "feature_toggle_overrides" drop constraint "feature_toggle_overrides_toggle_org_unique";`);

    this.addSql(`alter table "feature_toggle_overrides" rename column "organization_id" to "tenant_id";`);
    this.addSql(`create index "feature_toggle_overrides_tenant_idx" on "feature_toggle_overrides" ("tenant_id");`);
    this.addSql(`alter table "feature_toggle_overrides" add constraint "feature_toggle_overrides_toggle_tenant_unique" unique ("toggle_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "feature_toggle_audit_logs" ("id" uuid not null default gen_random_uuid(), "toggle_id" uuid not null, "organization_id" uuid null, "actor_user_id" uuid null, "action" text not null, "previous_value" jsonb null, "new_value" jsonb null, "changed_fields" jsonb null, "created_at" timestamptz not null, constraint "feature_toggle_audit_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "feature_toggle_audit_action_idx" on "feature_toggle_audit_logs" ("action", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_actor_idx" on "feature_toggle_audit_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_org_idx" on "feature_toggle_audit_logs" ("organization_id", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_toggle_idx" on "feature_toggle_audit_logs" ("toggle_id", "created_at");`);

    this.addSql(`alter table "feature_toggle_audit_logs" add constraint "feature_toggle_audit_logs_toggle_id_foreign" foreign key ("toggle_id") references "feature_toggles" ("id") on update cascade;`);

    this.addSql(`drop index "feature_toggle_overrides_tenant_idx";`);
    this.addSql(`alter table "feature_toggle_overrides" drop constraint "feature_toggle_overrides_toggle_tenant_unique";`);

    this.addSql(`alter table "feature_toggle_overrides" rename column "tenant_id" to "organization_id";`);
    this.addSql(`create index "feature_toggle_overrides_org_idx" on "feature_toggle_overrides" ("organization_id");`);
    this.addSql(`alter table "feature_toggle_overrides" add constraint "feature_toggle_overrides_toggle_org_unique" unique ("toggle_id", "organization_id");`);
  }

}
