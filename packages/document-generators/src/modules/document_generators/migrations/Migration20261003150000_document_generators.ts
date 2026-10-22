import { Migration } from '@mikro-orm/migrations';

export class Migration20261003150000_document_generators extends Migration {

  override name = 'Migration20261003150000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "document_generators_generated_documents" add column "template_version" text not null default '1';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "document_generators_generated_documents" drop column "template_version";`);
  }

}
