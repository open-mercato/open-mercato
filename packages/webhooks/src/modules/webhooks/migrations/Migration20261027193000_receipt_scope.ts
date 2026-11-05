import { Migration } from '@mikro-orm/migrations'

export class Migration20261027193000_receipt_scope extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "webhook_inbound_receipts" drop constraint "webhook_inbound_receipts_endpoint_message_unique";')
    this.addSql('alter table "webhook_inbound_receipts" add constraint "webhook_inbound_receipts_endpoint_message_unique" unique nulls not distinct ("endpoint_id", "message_id", "tenant_id", "organization_id");')
  }
}
