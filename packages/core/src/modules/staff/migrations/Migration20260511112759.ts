import { Migration } from '@mikro-orm/migrations';

export class Migration20260511112759 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index if exists "staff_time_projects_code_unique_idx";`);
    this.addSql(`create unique index "staff_time_projects_code_unique_idx" on "staff_time_projects" ("organization_id", "tenant_id", "code") where "deleted_at" is null;`);

    this.addSql(`drop index if exists "staff_time_project_members_unique_idx";`);
    this.addSql(`create unique index "staff_time_project_members_unique_idx" on "staff_time_project_members" ("organization_id", "tenant_id", "time_project_id", "staff_member_id") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "staff_time_project_members_unique_idx";`);
    this.addSql(`create index "staff_time_project_members_unique_idx" on "staff_time_project_members" ("organization_id", "tenant_id", "time_project_id", "staff_member_id");`);

    this.addSql(`drop index if exists "staff_time_projects_code_unique_idx";`);
    this.addSql(`create index "staff_time_projects_code_unique_idx" on "staff_time_projects" ("organization_id", "tenant_id", "code");`);
  }

}
