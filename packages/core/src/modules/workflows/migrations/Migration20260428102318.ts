import { Migration } from '@mikro-orm/migrations';

const RENAMES: Array<{ from: string; to: string }> = [
  { from: 'checkout_simple_v1', to: 'workflows.checkout-demo' },
  { from: 'sales_order_approval_v1', to: 'sales.order-approval' },
  { from: 'simple_approval_v1', to: 'workflows.simple-approval' },
];

export class Migration20260428102318 extends Migration {

  override async up(): Promise<void> {
    for (const { from, to } of RENAMES) {
      this.addSql(
        `update "workflow_definitions" ` +
        `set "workflow_id" = '${to}' ` +
        `where "workflow_id" = '${from}' ` +
        `and not exists (` +
          `select 1 from "workflow_definitions" d2 ` +
          `where d2."workflow_id" = '${to}' and d2."tenant_id" = "workflow_definitions"."tenant_id"` +
        `);`
      );
      this.addSql(
        `update "workflow_instances" ` +
        `set "workflow_id" = '${to}' ` +
        `where "workflow_id" = '${from}' ` +
        `and exists (` +
          `select 1 from "workflow_definitions" d ` +
          `where d."id" = "workflow_instances"."definition_id" and d."workflow_id" = '${to}'` +
        `);`
      );
    }
  }

  override async down(): Promise<void> {
    for (const { from, to } of RENAMES) {
      this.addSql(
        `update "workflow_definitions" ` +
        `set "workflow_id" = '${from}' ` +
        `where "workflow_id" = '${to}' ` +
        `and not exists (` +
          `select 1 from "workflow_definitions" d2 ` +
          `where d2."workflow_id" = '${from}' and d2."tenant_id" = "workflow_definitions"."tenant_id"` +
        `);`
      );
      this.addSql(
        `update "workflow_instances" ` +
        `set "workflow_id" = '${from}' ` +
        `where "workflow_id" = '${to}' ` +
        `and exists (` +
          `select 1 from "workflow_definitions" d ` +
          `where d."id" = "workflow_instances"."definition_id" and d."workflow_id" = '${from}'` +
        `);`
      );
    }
  }

}
