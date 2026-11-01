import { Migration } from '@mikro-orm/migrations';

export class Migration20261026201625_customer_groups extends Migration {

  override name = 'Migration20261026201625';

  override up(): void | Promise<void> {
    this.addSql(`create table "customer_purchase_approvals" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "customer_id" uuid not null, "requested_by_actor_type" text not null, "requested_by_actor_id" uuid not null, "subject_type" text not null, "subject_id" uuid not null, "amount_gross" numeric(16,2) not null, "currency_code" text not null, "approval_policy" text not null, "status" text not null, "buyer_decision" text not null, "buyer_decided_by_actor_type" text null, "buyer_decided_by_actor_id" uuid null, "buyer_decided_at" timestamptz null, "buyer_decision_note" text null, "merchant_decision" text not null, "merchant_decided_by_actor_type" text null, "merchant_decided_by_actor_id" uuid null, "merchant_decided_at" timestamptz null, "merchant_decision_note" text null, "decided_at" timestamptz null, "withdrawn_reason" text null, "expires_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "customer_purchase_approvals_pending_subject_unique" on "customer_purchase_approvals" ("tenant_id", "subject_type", "subject_id") where "status" = 'pending';`);
    this.addSql(`create index "customer_purchase_approvals_tenant_status_expires_idx" on "customer_purchase_approvals" ("tenant_id", "status", "expires_at");`);
    this.addSql(`create index "customer_purchase_approvals_tenant_org_customer_status_idx" on "customer_purchase_approvals" ("tenant_id", "organization_id", "customer_id", "status");`);

    this.addSql(`alter table "customer_purchase_approvals" add constraint "customer_purchase_approvals_merchant_decider_actor_type_chk" check ("merchant_decided_by_actor_type" is null or "merchant_decided_by_actor_type" = 'staff_user');`);
    this.addSql(`alter table "customer_purchase_approvals" add constraint "customer_purchase_approvals_buyer_decider_actor_type_chk" check ("buyer_decided_by_actor_type" is null or "buyer_decided_by_actor_type" = 'customer_user');`);
  }

}
