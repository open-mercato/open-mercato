import { Migration } from '@mikro-orm/migrations';

export class Migration20260319061242 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "gateway_transaction_assignments" drop constraint "gateway_transaction_assignments_unique";`);

    this.addSql(`
      insert into "gateway_transaction_assignments" (
        "id",
        "transaction_id",
        "entity_type",
        "entity_id",
        "organization_id",
        "tenant_id",
        "created_at",
        "updated_at"
      )
      select
        gen_random_uuid(),
        gt."id",
        gt."document_type",
        gt."document_id",
        gt."organization_id",
        gt."tenant_id",
        gt."created_at",
        gt."updated_at"
      from "gateway_transactions" gt
      where gt."document_type" is not null
        and gt."document_id" is not null
        and not exists (
          select 1
          from "gateway_transaction_assignments" gta
          where gta."transaction_id" = gt."id"
            and gta."entity_type" = gt."document_type"
            and gta."entity_id" = gt."document_id"
            and gta."organization_id" = gt."organization_id"
            and gta."tenant_id" = gt."tenant_id"
        );
    `);

    this.addSql(`alter table "gateway_transaction_assignments" add constraint "gateway_transaction_assignments_unique" unique ("transaction_id", "entity_type", "entity_id", "organization_id", "tenant_id");`);

    this.addSql(`drop index "gateway_transactions_document_type_document_id_org_b1ff6_index";`);
    this.addSql(`alter table "gateway_transactions" drop column "document_type", drop column "document_id";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "gateway_transactions" add column "document_type" text null, add column "document_id" text null;`);
    this.addSql(`create index "gateway_transactions_document_type_document_id_org_b1ff6_index" on "gateway_transactions" ("document_type", "document_id", "organization_id", "tenant_id");`);

    this.addSql(`
      update "gateway_transactions" gt
      set
        "document_type" = src."entity_type",
        "document_id" = src."entity_id"
      from (
        select distinct on ("transaction_id")
          "transaction_id",
          "entity_type",
          "entity_id"
        from "gateway_transaction_assignments"
        order by "transaction_id", "created_at" asc, "id" asc
      ) as src
      where src."transaction_id" = gt."id";
    `);

    this.addSql(`drop index "gateway_transaction_assignments_unique";`);

    this.addSql(`create index "gateway_transaction_assignments_unique" on "gateway_transaction_assignments" ("transaction_id", "entity_type", "entity_id", "organization_id", "tenant_id");`);
  }

}
