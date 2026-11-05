import { Migration } from '@mikro-orm/migrations';

export class Migration20260121140429 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "planner_availability_rules" add column "unavailability_reason_entry_id" uuid null, add column "unavailability_reason_value" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "planner_availability_rules" drop column "unavailability_reason_entry_id", drop column "unavailability_reason_value";`);
  }

}
