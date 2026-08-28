import { Migration } from '@mikro-orm/migrations';

export class Migration20260821091117_security extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "user_mfa_methods" add "secret_hash" text null;`);
    this.addSql(`create index "idx_user_mfa_methods_secret_hash" on "user_mfa_methods" ("secret_hash");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "idx_user_mfa_methods_secret_hash";`);
    this.addSql(`alter table "user_mfa_methods" drop column "secret_hash";`);
  }

}
