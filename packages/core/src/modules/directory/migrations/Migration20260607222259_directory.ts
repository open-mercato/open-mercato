import { Migration } from '@mikro-orm/migrations';

export class Migration20260607222259_directory extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "organizations" add "logo_url" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "organizations" drop column "logo_url";`);
  }

}
