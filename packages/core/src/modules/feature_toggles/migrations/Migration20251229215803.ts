import { Migration } from '@mikro-orm/migrations';

export class Migration20251229215803 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "feature_toggles" ("id" uuid not null default gen_random_uuid(), "identifier" text not null, "name" text not null, "description" text null, "category" text null, "default_state" boolean not null, "fail_mode" text not null default 'fail_closed', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "feature_toggles_pkey" primary key ("id"));`);
    this.addSql(`create index "feature_toggles_name_idx" on "feature_toggles" ("name");`);
    this.addSql(`create index "feature_toggles_category_idx" on "feature_toggles" ("category");`);
    this.addSql(`alter table "feature_toggles" add constraint "feature_toggles_identifier_unique" unique ("identifier");`);

    this.addSql(`create table "feature_toggle_audit_logs" ("id" uuid not null default gen_random_uuid(), "toggle_id" uuid not null, "organization_id" uuid null, "actor_user_id" uuid null, "action" text not null, "previous_value" jsonb null, "new_value" jsonb null, "changed_fields" jsonb null, "created_at" timestamptz not null, constraint "feature_toggle_audit_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "feature_toggle_audit_action_idx" on "feature_toggle_audit_logs" ("action", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_actor_idx" on "feature_toggle_audit_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_org_idx" on "feature_toggle_audit_logs" ("organization_id", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_toggle_idx" on "feature_toggle_audit_logs" ("toggle_id", "created_at");`);

    this.addSql(`create table "feature_toggle_overrides" ("id" uuid not null default gen_random_uuid(), "toggle_id" uuid not null, "organization_id" uuid not null, "state" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "feature_toggle_overrides_pkey" primary key ("id"));`);
    this.addSql(`create index "feature_toggle_overrides_toggle_idx" on "feature_toggle_overrides" ("toggle_id");`);
    this.addSql(`create index "feature_toggle_overrides_org_idx" on "feature_toggle_overrides" ("organization_id");`);
    this.addSql(`alter table "feature_toggle_overrides" add constraint "feature_toggle_overrides_toggle_org_unique" unique ("toggle_id", "organization_id");`);

    this.addSql(`alter table "feature_toggle_audit_logs" add constraint "feature_toggle_audit_logs_toggle_id_foreign" foreign key ("toggle_id") references "feature_toggles" ("id") on update cascade;`);

    this.addSql(`alter table "feature_toggle_overrides" add constraint "feature_toggle_overrides_toggle_id_foreign" foreign key ("toggle_id") references "feature_toggles" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "feature_toggle_audit_logs" drop constraint "feature_toggle_audit_logs_toggle_id_foreign";`);

    this.addSql(`alter table "feature_toggle_overrides" drop constraint "feature_toggle_overrides_toggle_id_foreign";`);
  }

}
