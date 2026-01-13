import { Migration } from '@mikro-orm/migrations';

export class Migration20260110103647 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "booking_event_attendees" add column "customer_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "booking_event_attendees" drop column "customer_id";`);
  }

}
