import { Migration } from '@mikro-orm/migrations';

export class Migration20260710071003_documents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "document_contents" add "collaboration_generation" int not null default 1;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "document_contents" drop column "collaboration_generation";`);
  }

}
