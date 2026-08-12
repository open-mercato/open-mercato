import { Migration } from '@mikro-orm/migrations'

/**
 * External agent invocation, task 2.11: carry the parked `INVOKE_AGENT` step's
 * `outputMapping` onto the correlation row, so an answer that arrives minutes
 * later in another process lands in the context keys the workflow author declared
 * instead of the legacy fixed ones (`disposition`, `agentId`, `<stepId>_agent`).
 *
 * A sixth file rather than an edit of `Migration20260812100000` (which created the
 * table): that migration has shipped and is untouched.
 *
 * Purely additive and nullable, with nothing to backfill. A row written before
 * this column existed reads `null`, which is exactly the "no mapping declared"
 * case the resume already handles by falling back to the legacy keys — so an
 * in-flight external run started before the deploy still settles correctly.
 *
 * Deliberately NOT added to `defaultEncryptionMaps`: the column holds context key
 * names and dot-paths authored in the Studio, which `workflow_definitions.definition`
 * already stores in plaintext. See the entity docstring.
 *
 * SQL and snapshot are the generator's own output (`yarn db:generate` with
 * `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`);
 * only the file name and this comment are hand-written. `db:migrate` was never run.
 */
export class Migration20260812110000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_external_runs" add "output_mapping" jsonb null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_external_runs" drop column "output_mapping";`)
  }

}
