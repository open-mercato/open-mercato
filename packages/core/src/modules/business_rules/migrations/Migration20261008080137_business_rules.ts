import { Migration } from '@mikro-orm/migrations';

export class Migration20261008080137_business_rules extends Migration {

  override name = 'Migration20261008080137';

  override up(): void | Promise<void> {
    this.addSql(`set local lock_timeout = '5s';`);
    this.addSql(`alter table "rule_execution_logs" add "run_id" uuid null, add "rule_version" int null, add "rule_definition_hash" text null, add "causation_json" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "rule_execution_logs" drop column "run_id", drop column "rule_version", drop column "rule_definition_hash", drop column "causation_json";`);
  }

}
