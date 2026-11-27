import { Migration } from '@mikro-orm/migrations';

export class Migration20261018124142_webhooks extends Migration {

  override name = 'Migration20261018124142';

  override up(): void | Promise<void> {
    this.addSql(`alter table "webhook_inbound_receipts" add "ingestion_id" uuid null, add "dispatch_queued" boolean not null default true, add "received_event_published" boolean not null default true;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "webhook_inbound_receipts" drop column "ingestion_id", drop column "dispatch_queued", drop column "received_event_published";`);
  }

}
