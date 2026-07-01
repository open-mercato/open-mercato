import { Migration } from '@mikro-orm/migrations';

export class Migration20260701205012_incidents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "incidents" add "revenue_at_risk_minor" bigint null, add "revenue_at_risk_currency" text null;`);

    this.addSql(`alter table "incident_impacts" add "revenue_refreshed_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "incident_impacts" drop column "revenue_refreshed_at";`);

    this.addSql(`alter table "incidents" drop column "revenue_at_risk_minor", drop column "revenue_at_risk_currency";`);
  }

}
