import { Migration } from '@mikro-orm/migrations';

export class Migration20260109111659 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "booking_availability_rule_sets" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "timezone" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_availability_rule_sets_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_availability_rule_sets_tenant_org_idx" on "booking_availability_rule_sets" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "booking_availability_rules" drop constraint if exists "booking_availability_rules_subject_type_check";`);

    this.addSql(`alter table "booking_availability_rules" add constraint "booking_availability_rules_subject_type_check" check("subject_type" in ('member', 'resource', 'ruleset'));`);

    this.addSql(`alter table "booking_resources" add column "availability_rule_set_id" uuid null;`);

    this.addSql(`alter table "booking_team_members" add column "availability_rule_set_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "booking_availability_rules" drop constraint if exists "booking_availability_rules_subject_type_check";`);

    this.addSql(`alter table "booking_availability_rules" add constraint "booking_availability_rules_subject_type_check" check("subject_type" in ('member', 'resource'));`);

    this.addSql(`alter table "booking_resources" drop column "availability_rule_set_id";`);

    this.addSql(`alter table "booking_team_members" drop column "availability_rule_set_id";`);
  }

}
