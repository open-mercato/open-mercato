import { Migration } from '@mikro-orm/migrations';

export class Migration20260728104038_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "user_tasks" add "entity_bindings" jsonb null, add "priority" varchar(20) null, add "reassigned_by" varchar(255) null, add "reassigned_at" timestamptz null, add "reassign_reason" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "user_tasks" drop column "entity_bindings", drop column "priority", drop column "reassigned_by", drop column "reassigned_at", drop column "reassign_reason";`);
  }

}
