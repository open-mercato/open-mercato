import { Migration } from '@mikro-orm/migrations'

export class Migration20261018180000_payment_gateways extends Migration {
  override isTransactional(): boolean {
    return false
  }

  override up(): void | Promise<void> {
    this.addSql('drop index concurrently if exists "gateway_session_initializations_retention_idx";')
    this.addSql(
      'create index concurrently "gateway_session_initializations_retention_idx" on "gateway_session_initializations" ("tenant_id", "organization_id", "updated_at", "id");',
    )
  }

  override down(): void | Promise<void> {
    this.addSql('drop index concurrently if exists "gateway_session_initializations_retention_idx";')
  }
}
