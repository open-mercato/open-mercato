import { Migration } from '@mikro-orm/migrations';

export class Migration20260121142334 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "resources_resource_activities" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "activity_type" text not null, "subject" text null, "body" text null, "occurred_at" timestamptz null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "resource_id" uuid not null, constraint "resources_resource_activities_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_activities_resource_occurred_created_idx" on "resources_resource_activities" ("resource_id", "occurred_at", "created_at");`);
    this.addSql(`create index "resources_resource_activities_tenant_org_idx" on "resources_resource_activities" ("tenant_id", "organization_id");`);
    this.addSql(`create index "resources_resource_activities_resource_idx" on "resources_resource_activities" ("resource_id");`);

    this.addSql(`create table "resources_resource_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "body" text not null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "resource_id" uuid not null, constraint "resources_resource_comments_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_comments_tenant_org_idx" on "resources_resource_comments" ("tenant_id", "organization_id");`);
    this.addSql(`create index "resources_resource_comments_resource_idx" on "resources_resource_comments" ("resource_id");`);

    this.addSql(`alter table "resources_resource_activities" add constraint "resources_resource_activities_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade;`);

    this.addSql(`alter table "resources_resource_comments" add constraint "resources_resource_comments_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade;`);
  }

}
