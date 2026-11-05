import { Migration } from '@mikro-orm/migrations'

export class Migration20260221113000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('drop index if exists "record_locks_active_scope_tenant_unique";')
    this.addSql('drop index if exists "record_locks_active_scope_org_unique";')
    this.addSql('create unique index if not exists "record_locks_active_scope_user_tenant_unique" on "record_locks" ("tenant_id", "resource_kind", "resource_id", "locked_by_user_id") where deleted_at is null and status = \'active\' and organization_id is null;')
    this.addSql('create unique index if not exists "record_locks_active_scope_user_org_unique" on "record_locks" ("tenant_id", "organization_id", "resource_kind", "resource_id", "locked_by_user_id") where deleted_at is null and status = \'active\' and organization_id is not null;')
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "record_locks_active_scope_user_tenant_unique";')
    this.addSql('drop index if exists "record_locks_active_scope_user_org_unique";')
    this.addSql('create unique index if not exists "record_locks_active_scope_tenant_unique" on "record_locks" ("tenant_id", "resource_kind", "resource_id") where deleted_at is null and status = \'active\' and organization_id is null;')
    this.addSql('create unique index if not exists "record_locks_active_scope_org_unique" on "record_locks" ("tenant_id", "organization_id", "resource_kind", "resource_id") where deleted_at is null and status = \'active\' and organization_id is not null;')
  }
}
