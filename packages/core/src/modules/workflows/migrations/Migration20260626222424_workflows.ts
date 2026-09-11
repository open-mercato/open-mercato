import { Migration } from '@mikro-orm/migrations';

export class Migration20260626222424_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "workflow_definitions" drop constraint if exists "workflow_definitions_workflow_id_tenant_id_unique";`);
    this.addSql(`create index "workflow_definitions_definition_gin_idx" on "workflow_definitions" using gin ("definition");`);
    this.addSql(`alter table "workflow_definitions" add constraint "workflow_definitions_workflow_id_version_tenant_id_unique" unique ("workflow_id", "version", "tenant_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "workflow_definitions_definition_gin_idx";`);
    this.addSql(`alter table "workflow_definitions" drop constraint if exists "workflow_definitions_workflow_id_version_tenant_id_unique";`);
    this.addSql(`alter table "workflow_definitions" add constraint "workflow_definitions_workflow_id_tenant_id_unique" unique ("workflow_id", "tenant_id");`);
  }

}
