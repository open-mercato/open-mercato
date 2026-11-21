import { Migration } from '@mikro-orm/migrations'

export class Migration20261120120000_auth extends Migration {
  override up(): void {
    this.addSql('alter table "sessions" add column "sso_provenance" jsonb null;')
  }

  override down(): void {
    this.addSql('alter table "sessions" drop column "sso_provenance";')
  }
}
