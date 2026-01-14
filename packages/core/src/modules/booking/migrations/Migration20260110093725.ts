import { Migration } from '@mikro-orm/migrations';

export class Migration20260110093725 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "booking_teams" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_teams_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_teams_tenant_org_idx" on "booking_teams" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "booking_availability_rules" add column "kind" text check ("kind" in ('availability', 'unavailability')) not null default 'availability', add column "note" text null;`);

    this.addSql(`alter table "booking_team_members" add column "team_id" uuid null;`);

    this.addSql(`alter table "booking_team_roles" add column "team_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "booking_availability_rules" drop column "kind", drop column "note";`);

    this.addSql(`alter table "booking_team_members" drop column "team_id";`);

    this.addSql(`alter table "booking_team_roles" drop column "team_id";`);
  }

}
