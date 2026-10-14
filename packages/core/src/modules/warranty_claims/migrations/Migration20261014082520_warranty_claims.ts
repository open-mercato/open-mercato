import { Migration } from '@mikro-orm/migrations';

export class Migration20261014082520_warranty_claims extends Migration {

  override name = 'Migration20261014082520';

  override up(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" alter column "total_approved_amount" type numeric using ("total_approved_amount"::numeric);`);
    this.addSql(`alter table "warranty_claims" alter column "total_claimed_amount" type numeric using ("total_claimed_amount"::numeric);`);
    this.addSql(`alter table "warranty_claims" alter column "total_recovered_amount" type numeric using ("total_recovered_amount"::numeric);`);

    this.addSql(`alter table "warranty_claim_lines" alter column "core_charge_amount" type numeric using ("core_charge_amount"::numeric);`);
    this.addSql(`alter table "warranty_claim_lines" alter column "core_credit_amount" type numeric using ("core_credit_amount"::numeric);`);
    this.addSql(`alter table "warranty_claim_lines" alter column "credit_amount" type numeric using ("credit_amount"::numeric);`);
    this.addSql(`alter table "warranty_claim_lines" alter column "restocking_fee" type numeric using ("restocking_fee"::numeric);`);

    this.addSql(`alter table "warranty_claim_settings" alter column "auto_approve_max_amount" type numeric using ("auto_approve_max_amount"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "warranty_claim_lines" alter column "credit_amount" type numeric(18,4) using ("credit_amount"::numeric(18,4));`);
    this.addSql(`alter table "warranty_claim_lines" alter column "restocking_fee" type numeric(18,4) using ("restocking_fee"::numeric(18,4));`);
    this.addSql(`alter table "warranty_claim_lines" alter column "core_charge_amount" type numeric(18,4) using ("core_charge_amount"::numeric(18,4));`);
    this.addSql(`alter table "warranty_claim_lines" alter column "core_credit_amount" type numeric(18,4) using ("core_credit_amount"::numeric(18,4));`);

    this.addSql(`alter table "warranty_claim_settings" alter column "auto_approve_max_amount" type numeric(18,4) using ("auto_approve_max_amount"::numeric(18,4));`);

    this.addSql(`alter table "warranty_claims" alter column "total_claimed_amount" type numeric(18,4) using ("total_claimed_amount"::numeric(18,4));`);
    this.addSql(`alter table "warranty_claims" alter column "total_approved_amount" type numeric(18,4) using ("total_approved_amount"::numeric(18,4));`);
    this.addSql(`alter table "warranty_claims" alter column "total_recovered_amount" type numeric(18,4) using ("total_recovered_amount"::numeric(18,4));`);
  }

}
