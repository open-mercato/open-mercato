import { Migration } from '@mikro-orm/migrations';

export class Migration20260710023607_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" add "sla_at_risk_notified_at" timestamptz null, add "sla_breached_notified_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" drop column "sla_at_risk_notified_at", drop column "sla_breached_notified_at";`);
  }

}
