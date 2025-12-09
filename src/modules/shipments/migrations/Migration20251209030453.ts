import { Migration } from '@mikro-orm/migrations';

export class Migration20251209030453 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "shipment_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "attachment_id" uuid not null, "extracted_data" jsonb null, "processed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "shipment_documents_pkey" primary key ("id"));`);
  }

}
