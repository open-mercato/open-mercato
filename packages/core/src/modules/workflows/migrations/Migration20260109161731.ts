import { Migration } from '@mikro-orm/migrations';

export class Migration20260109161731 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "workflow_instances" add column "pending_transition" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "workflow_instances" drop column "pending_transition";`);
  }

}
