import { Migration } from '@mikro-orm/migrations';

export class Migration20260713092156_documents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "document_folders" add constraint "document_folders_parent_folder_id_foreign" foreign key ("parent_folder_id") references "document_folders" ("id") on delete set null;`);

    this.addSql(`alter table "documents" add constraint "documents_folder_id_foreign" foreign key ("folder_id") references "document_folders" ("id") on delete set null;`);

    this.addSql(`alter table "document_entity_links" add constraint "document_entity_links_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`);

    this.addSql(`alter table "document_contents" add constraint "document_contents_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`);

    this.addSql(`alter table "document_comments" add constraint "document_comments_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`);
    this.addSql(`alter table "document_comments" add constraint "document_comments_parent_comment_id_foreign" foreign key ("parent_comment_id") references "document_comments" ("id") on delete set null;`);

    this.addSql(`alter table "document_attachments" add constraint "document_attachments_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`);

    this.addSql(`alter table "document_shares" add constraint "document_shares_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`);

    this.addSql(`alter table "document_versions" add constraint "document_versions_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "document_attachments" drop constraint if exists "document_attachments_document_id_foreign";`);

    this.addSql(`alter table "document_comments" drop constraint if exists "document_comments_document_id_foreign";`);
    this.addSql(`alter table "document_comments" drop constraint if exists "document_comments_parent_comment_id_foreign";`);

    this.addSql(`alter table "document_contents" drop constraint if exists "document_contents_document_id_foreign";`);

    this.addSql(`alter table "document_entity_links" drop constraint if exists "document_entity_links_document_id_foreign";`);

    this.addSql(`alter table "document_folders" drop constraint if exists "document_folders_parent_folder_id_foreign";`);

    this.addSql(`alter table "document_shares" drop constraint if exists "document_shares_document_id_foreign";`);

    this.addSql(`alter table "document_versions" drop constraint if exists "document_versions_document_id_foreign";`);

    this.addSql(`alter table "documents" drop constraint if exists "documents_folder_id_foreign";`);
  }

}
