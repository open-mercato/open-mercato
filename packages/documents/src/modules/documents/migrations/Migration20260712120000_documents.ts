import { Migration } from '@mikro-orm/migrations';

export class Migration20260712120000_documents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create index "documents_list_sort_idx" on "documents" ("organization_id", "tenant_id", "updated_at") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "documents_list_sort_idx";`);
  }

}
