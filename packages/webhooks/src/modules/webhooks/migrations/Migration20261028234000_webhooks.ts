import { Migration } from '@mikro-orm/migrations'

export class Migration20261028234000_webhooks extends Migration {
  override name = 'Migration20261028234000'

  override up(): void {
    this.addSql('alter table "webhook_inbound_receipts" add "delivery_claim_token" uuid null, add "delivery_claim_stage" text null, add "delivery_claim_expires_at" timestamptz null;')
  }

  override down(): void {
    this.addSql('alter table "webhook_inbound_receipts" drop column "delivery_claim_token", drop column "delivery_claim_stage", drop column "delivery_claim_expires_at";')
  }
}
