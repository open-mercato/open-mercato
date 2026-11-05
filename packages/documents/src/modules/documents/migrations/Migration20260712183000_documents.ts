import { Migration } from '@mikro-orm/migrations'

export class Migration20260712183000_documents extends Migration {
  override up(): void {
    this.addSql('alter table "document_attachments" add column "updated_at" timestamptz not null default now();')
    this.addSql('alter table "document_attachments" alter column "updated_at" drop default;')
  }

  override down(): void {
    this.addSql('alter table "document_attachments" drop column "updated_at";')
  }
}
