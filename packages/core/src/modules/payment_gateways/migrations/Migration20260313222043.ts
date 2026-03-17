import { Migration } from '@mikro-orm/migrations';

export class Migration20260313222043 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index "gateway_webhook_events_idempotency_unique";`);

    this.addSql(`create index "gateway_webhook_events_idempotency_unique" on "gateway_webhook_events" ("idempotency_key", "provider_key", "organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "gateway_webhook_events_idempotency_unique";`);

    this.addSql(`alter table "gateway_webhook_events" add constraint "gateway_webhook_events_idempotency_unique" unique ("idempotency_key", "provider_key", "organization_id", "tenant_id");`);
  }

}
