import { Migration } from '@mikro-orm/migrations';

export class Migration20261026161603_promotions extends Migration {

  override name = 'Migration20261026161603';

  override up(): void | Promise<void> {
    this.addSql(`alter table "promotion_code_usages" add "cart_id" uuid null, add "order_id" text null, add "generated_code_id" uuid null, add "reverted_at" timestamptz null;`);
    this.addSql(`alter table "promotion_code_usages" add constraint "promotion_code_usages_generated_code_id_foreign" foreign key ("generated_code_id") references "promotion_generated_codes" ("id") on delete set null;`);
    this.addSql(`create index "promotion_code_usages_order_idx" on "promotion_code_usages" ("order_id");`);
    this.addSql(`create index "promotion_code_usages_cart_idx" on "promotion_code_usages" ("cart_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "promotion_code_usages" drop constraint if exists "promotion_code_usages_generated_code_id_foreign";`);

    this.addSql(`drop index "promotion_code_usages_order_idx";`);
    this.addSql(`drop index "promotion_code_usages_cart_idx";`);
    this.addSql(`alter table "promotion_code_usages" drop column "cart_id", drop column "order_id", drop column "generated_code_id", drop column "reverted_at";`);
  }

}
