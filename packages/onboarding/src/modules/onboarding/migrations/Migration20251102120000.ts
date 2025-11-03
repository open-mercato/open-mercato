import { Migration } from '@mikro-orm/migrations'

export class Migration20251102120000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "onboarding_requests" add column "password_hash" text null;')
  }

  async down(): Promise<void> {
    this.addSql('alter table "onboarding_requests" drop column "password_hash";')
  }
}
