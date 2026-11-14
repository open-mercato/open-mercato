import { Migration } from '@mikro-orm/migrations'

export class Migration20261029160000_scim_token_lookup_hash extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "scim_tokens" add column "token_lookup_hash" text null;')
    this.addSql('create index "scim_tokens_token_lookup_hash_idx" on "scim_tokens" ("token_lookup_hash");')
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "scim_tokens_token_lookup_hash_idx";')
    this.addSql('alter table "scim_tokens" drop column "token_lookup_hash";')
  }
}
