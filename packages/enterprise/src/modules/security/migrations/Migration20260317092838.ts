import { Migration } from '@mikro-orm/migrations';

export class Migration20260317092838 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sudo_challenge_configs" drop column "target_type";`);

    this.addSql(`alter table "sudo_challenge_configs" add column "label" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sudo_challenge_configs" drop column "label";`);

    this.addSql(`alter table "sudo_challenge_configs" add column "target_type" text null default 'feature';`);
  }

}
