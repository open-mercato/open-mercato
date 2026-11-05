import { Migration } from '@mikro-orm/migrations'

export class Migration20260308113000MfaChallengeMethodBinding extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "mfa_challenges" add column "method_id" uuid null;`)
    this.addSql(`alter table "mfa_challenges" add column "provider_challenge" jsonb null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "mfa_challenges" drop column if exists "provider_challenge";`)
    this.addSql(`alter table "mfa_challenges" drop column if exists "method_id";`)
  }
}
