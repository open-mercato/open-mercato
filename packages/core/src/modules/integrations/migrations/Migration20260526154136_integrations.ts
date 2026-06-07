import { Migration } from '@mikro-orm/migrations';

export class Migration20260526154136_integrations extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "integration_credentials" add "user_id" uuid null;`);
    this.addSql(`create unique index "integration_credentials_user_lookup_idx" on "integration_credentials" ("integration_id", "organization_id", "tenant_id", "user_id") where "user_id" is not null and "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "integration_credentials_user_lookup_idx";`);
    this.addSql(`alter table "integration_credentials" drop column "user_id";`);
  }

}
