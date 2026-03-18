import { Migration } from '@mikro-orm/migrations';

export class Migration20260318190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "gateway_transactions" add column "document_type" text null, add column "document_id" text null;`);

    this.addSql(`create index "gateway_transactions_document_type_document_id_org_b1ff6_index" on "gateway_transactions" ("document_type", "document_id", "organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "gateway_transactions_document_type_document_id_org_b1ff6_index";`);

    this.addSql(`alter table "gateway_transactions" drop column "document_type", drop column "document_id";`);
  }

}
