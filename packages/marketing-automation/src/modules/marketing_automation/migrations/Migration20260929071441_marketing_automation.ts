import { Migration } from '@mikro-orm/migrations';

export class Migration20260929071441_marketing_automation extends Migration {

  override name = 'Migration20260929071441';

  override up(): void | Promise<void> {
    this.addSql(`alter table "marketing_referral_codes" alter column "referrer_entity_id" drop not null;`);

    this.addSql(`alter table "marketing_referral_redemptions" alter column "referred_entity_id" drop not null;`);
    this.addSql(`alter table "marketing_referral_redemptions" alter column "referrer_entity_id" drop not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "marketing_referral_codes" alter column "referrer_entity_id" set not null;`);

    this.addSql(`alter table "marketing_referral_redemptions" alter column "referrer_entity_id" set not null;`);
    this.addSql(`alter table "marketing_referral_redemptions" alter column "referred_entity_id" set not null;`);
  }

}
