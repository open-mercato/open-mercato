import { Migration } from '@mikro-orm/migrations';

export class Migration20260723120000_customer_accounts extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_user_invitations" add column "person_entity_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_user_invitations" drop column "person_entity_id";`);
  }

}
