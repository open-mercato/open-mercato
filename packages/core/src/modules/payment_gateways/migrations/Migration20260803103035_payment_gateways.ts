import { Migration } from '@mikro-orm/migrations'

export class Migration20260803103035_payment_gateways extends Migration {
  override isTransactional(): boolean {
    return false
  }

  override up(): void | Promise<void> {
    this.addSql(
      'create index concurrently if not exists "gateway_session_initializations_prune_idx" on "gateway_session_initializations" ("tenant_id", "organization_id", "updated_at") where "gateway_transaction_id" is not null;',
    )
  }

  override down(): void | Promise<void> {
    this.addSql('drop index concurrently if exists "gateway_session_initializations_prune_idx";')
  }
}
