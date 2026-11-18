import { Migration } from '@mikro-orm/migrations';

export class Migration20261111231316_property_management extends Migration {

  override name = 'Migration20261111231316';

  override up(): void | Promise<void> {
    this.addSql(`alter table "property_management_unavailabilities" add "apply_heartbeat_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "property_management_unavailabilities" drop column "apply_heartbeat_at";`);
  }

}
