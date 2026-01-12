import { Migration } from '@mikro-orm/migrations';

export class Migration20260112110000_contractor_contacts_optional_names extends Migration {

  override async up(): Promise<void> {
    // Make firstName and lastName nullable
    this.addSql(`alter table "contractor_contacts" alter column "first_name" drop not null;`);
    this.addSql(`alter table "contractor_contacts" alter column "last_name" drop not null;`);
  }

  override async down(): Promise<void> {
    // Make firstName and lastName required again
    this.addSql(`alter table "contractor_contacts" alter column "first_name" set not null;`);
    this.addSql(`alter table "contractor_contacts" alter column "last_name" set not null;`);
  }
}
