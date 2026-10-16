import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

export class Migration20261009180543_staff extends Migration {

  override name = 'Migration20261009180543';

  override up(): void | Promise<void> {
    this.addSql(`create table "staff_support_routing_rules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "category_value" text null, "time_project_id" uuid not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "staff_support_routing_rules_tenant_org_idx" on "staff_support_routing_rules" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "staff_support_routing_rules_category_unique_idx" on "staff_support_routing_rules" ("tenant_id", "organization_id", coalesce("category_value", '')) where "deleted_at" is null;`);

    this.addSql(`create table "staff_support_tickets" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "customer_snapshot" jsonb null, "reported_by_customer_user_id" uuid null, "support_reference" text not null, "support_sequence_number" int not null, "category_value" text not null, "category_snapshot" jsonb not null, "routed_via" text not null, "customer_request_snapshot" jsonb not null, "unnotified_at" timestamptz null, "portal_status_published" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "staff_support_tickets_reference_unique_idx" on "staff_support_tickets" ("tenant_id", "organization_id", "support_reference") where "deleted_at" is null;`);
    this.addSql(`create index "staff_support_tickets_sequence_idx" on "staff_support_tickets" ("tenant_id", "organization_id", "support_sequence_number");`);
    this.addSql(`create unique index "staff_support_tickets_task_unique_idx" on "staff_support_tickets" ("tenant_id", "organization_id", "task_id") where "deleted_at" is null;`);
    this.addSql(`create index "staff_support_tickets_tenant_org_idx" on "staff_support_tickets" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "staff_time_projects" add "default_assignee_staff_member_id" uuid null;`);

    this.addSql(`alter table "staff_time_project_members" add "is_assigner" boolean not null default false;`);
    this.addSql(`create index "staff_time_project_members_assigner_idx" on "staff_time_project_members" ("tenant_id", "organization_id", "time_project_id") where "is_assigner" = true and "status" = 'active' and "deleted_at" is null;`);

    this.addSql(`alter table "staff_time_tasks" add "source" text not null default 'internal', add "customer_id" uuid null;`);
    this.addSql(`create index "staff_time_tasks_portal_customer_idx" on "staff_time_tasks" ("tenant_id", "organization_id", "customer_id", "updated_at") where "source" = 'portal' and "deleted_at" is null;`);

    this.addSql(`alter table "staff_time_task_comments" add "visibility" text not null default 'internal', add "author_kind" text not null default 'staff', add "author_customer_user_id" uuid null, add "author_display_snapshot" jsonb null;`);

    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'staff:staff_support_ticket',
      fields: [{ field: 'customer_request_snapshot' }],
    }));
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "staff_support_tickets";`);
    this.addSql(`drop table if exists "staff_support_routing_rules";`);

    this.addSql(`drop index "staff_time_project_members_assigner_idx";`);
    this.addSql(`alter table "staff_time_project_members" drop column "is_assigner";`);

    this.addSql(`alter table "staff_time_projects" drop column "default_assignee_staff_member_id";`);

    this.addSql(`alter table "staff_time_task_comments" drop column "visibility", drop column "author_kind", drop column "author_customer_user_id", drop column "author_display_snapshot";`);

    this.addSql(`drop index "staff_time_tasks_portal_customer_idx";`);
    this.addSql(`alter table "staff_time_tasks" drop column "source", drop column "customer_id";`);
  }

}
