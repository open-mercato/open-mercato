import { Migration } from '@mikro-orm/migrations'

/**
 * Disposition contract (spec 2026-07-26-workflows-ux-redesign §7.5 / A7):
 * - `agent_proposals.user_task_id` — the workflows `UserTask` raised for this
 *   proposal's human review, so a disposition can close the task it created.
 *   FK-by-id across a module boundary, so no constraint; null for every
 *   auto-approved proposal and every row written before this column existed.
 */
export class Migration20260729120000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_proposals" add "user_task_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_proposals" drop column "user_task_id";`);
  }

}
