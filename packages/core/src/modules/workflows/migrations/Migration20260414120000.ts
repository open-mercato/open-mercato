import { Migration } from '@mikro-orm/migrations';

export class Migration20260414120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "workflow_definitions" add column if not exists "code_workflow_id" varchar(100) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "workflow_definitions" drop column if exists "code_workflow_id";`);
  }

}
