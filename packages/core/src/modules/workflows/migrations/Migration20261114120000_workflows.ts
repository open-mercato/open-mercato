import { Migration } from '@mikro-orm/migrations'

export class Migration20261114120000_workflows extends Migration {
  override up(): void {
    this.addSql(`alter table "workflow_definitions" drop constraint "workflow_definitions_workflow_id_version_tenant_id_unique";`)
    this.addSql(`alter table "workflow_definitions" add constraint "workflow_definitions_workflow_version_tenant_org_unique" unique ("workflow_id", "version", "tenant_id", "organization_id");`)
  }

  override down(): void {
    this.addSql(`alter table "workflow_definitions" drop constraint "workflow_definitions_workflow_version_tenant_org_unique";`)
    this.addSql(`alter table "workflow_definitions" add constraint "workflow_definitions_workflow_id_version_tenant_id_unique" unique ("workflow_id", "version", "tenant_id");`)
  }
}
