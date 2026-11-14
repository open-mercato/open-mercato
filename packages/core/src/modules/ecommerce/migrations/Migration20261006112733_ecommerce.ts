import { Migration } from '@mikro-orm/migrations';

export class Migration20261006112733_ecommerce extends Migration {

  override name = 'Migration20261006112733';

  override up(): void | Promise<void> {
    this.addSql(`alter table "ecommerce_store_channel_bindings" add "require_authentication" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "ecommerce_store_channel_bindings" drop column "require_authentication";`);
  }

}
