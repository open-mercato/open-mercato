import { Migration } from '@mikro-orm/migrations'

export class Migration20261115020000_sso_authority extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "sso_configs" add column "authorization_user_id" uuid null;')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "sso_configs" drop column "authorization_user_id";')
  }
}
