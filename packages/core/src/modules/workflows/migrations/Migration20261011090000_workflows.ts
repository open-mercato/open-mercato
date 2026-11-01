import { Migration } from '@mikro-orm/migrations';

export class Migration20261011090000_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "workflow_instances" add "business_key" varchar(255) null;`);
    this.addSql(`create unique index "workflow_instances_business_key_open_uq" on "workflow_instances" ("tenant_id", "organization_id", "workflow_id", "business_key") where "business_key" is not null and "deleted_at" is null and "status" not in ('COMPLETED', 'FAILED', 'CANCELLED', 'COMPENSATED');`);
    this.addSql(`create index "workflow_instances_business_key_idx" on "workflow_instances" ("tenant_id", "organization_id", "workflow_id", "business_key", "created_at") where "business_key" is not null;`);
    this.addSql(`create index "workflow_instances_metadata_gin_idx" on "workflow_instances" using gin ("metadata" jsonb_path_ops);`);
    this.addSql(`create index "user_tasks_entity_bindings_gin_idx" on "user_tasks" using gin ("entity_bindings" jsonb_path_ops);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "user_tasks_entity_bindings_gin_idx";`);
    this.addSql(`drop index if exists "workflow_instances_metadata_gin_idx";`);
    this.addSql(`drop index if exists "workflow_instances_business_key_idx";`);
    this.addSql(`drop index if exists "workflow_instances_business_key_open_uq";`);
    this.addSql(`alter table "workflow_instances" drop column "business_key";`);
  }

}
