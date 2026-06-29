import { Migration } from '@mikro-orm/migrations';

export class Migration20260529231848_communication_channels extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create index "communication_channels_provider_external_idx" on "communication_channels" ("provider_key", "external_identifier") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "communication_channels_provider_external_idx";`);
  }

}
