import { Migration } from '@mikro-orm/migrations'

export class Migration20260110120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "customer_comments" add column "appearance_icon" text null;`)
    this.addSql(`alter table "customer_comments" add column "appearance_color" text null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "customer_comments" drop column if exists "appearance_color";`)
    this.addSql(`alter table "customer_comments" drop column if exists "appearance_icon";`)
  }
}
