import { Migration } from '@mikro-orm/migrations';

export class Migration20260821091117_sso extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "sso_configs" add "required_acr_values" jsonb not null default '[]', add "required_amr_values" jsonb not null default '[]';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sso_configs" drop column "required_acr_values", drop column "required_amr_values";`);
  }

}
