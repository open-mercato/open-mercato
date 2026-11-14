import { Migration } from '@mikro-orm/migrations';

// Release 5, Step 3.5 (D-R5-19, cart §6a.4 rev 10). Additive column: the trusted pay-link
// seeding path's per-line fixed-price override, written only by `cart.lines.add` under a
// `systemActor` context creating/extending a `pay_link` cart.
export class Migration20261027210000_cart extends Migration {

  override name = 'Migration20261027210000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cart_lines" add column "unit_price_override" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cart_lines" drop column "unit_price_override";`);
  }

}
