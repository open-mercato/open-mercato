import { Migration } from '@mikro-orm/migrations';

export class Migration20260109163700 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "workflow_instances" alter column "status" type varchar(30) using ("status"::varchar(30));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "workflow_instances" alter column "status" type varchar(20) using ("status"::varchar(20));`);
  }

}
