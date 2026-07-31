import { Migration } from '@mikro-orm/migrations'

/**
 * Human label for an eval case, surfaced as the first column of the eval-cases
 * list and editable from the drawer. Plaintext (not PII), so it stays out of the
 * module's encryption map. Nullable — existing rows carry no name until one is set.
 */
export class Migration20260801000000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_eval_cases" add "name" varchar(200) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_eval_cases" drop column "name";`);
  }

}
