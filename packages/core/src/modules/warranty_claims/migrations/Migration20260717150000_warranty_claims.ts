import { Migration } from '@mikro-orm/migrations';

export class Migration20260717150000_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" add column "credit_memo_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" drop column "credit_memo_id";`);
  }

}
