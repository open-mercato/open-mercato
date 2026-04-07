import { Migration } from '@mikro-orm/migrations';

export class Migration20260406214502 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_quotes" add column "closure_outcome" text null, add column "loss_reason_id" uuid null, add column "loss_notes" text null;`);

    this.addSql(`alter table "sales_orders" add column "closure_outcome" text null, add column "loss_reason_id" uuid null, add column "loss_notes" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_quotes" drop column "closure_outcome", drop column "loss_reason_id", drop column "loss_notes";`);

    this.addSql(`alter table "sales_orders" drop column "closure_outcome", drop column "loss_reason_id", drop column "loss_notes";`);
  }

}
