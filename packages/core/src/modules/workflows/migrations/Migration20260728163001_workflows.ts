import { Migration } from '@mikro-orm/migrations';

/**
 * Task visibility gate columns (spec §6.4, design §2.6 / §7.1).
 *
 * Both additive, per BACKWARD_COMPATIBILITY.md §8: a NOT NULL column with a
 * default and a nullable column. Nothing renamed, nothing dropped.
 *
 * - `assignee_kind` discriminates a backoffice user id from a portal principal
 *   id in `assigned_to`. Existing rows backfill to `'user'` from the default,
 *   which is correct: every `assigned_to` written before this column existed is
 *   a backoffice user id.
 * - `entity_types` denormalizes the distinct authored binding types so the
 *   entity gate is a `WHERE`, not a JS post-filter — post-filtering makes
 *   `pagination.total` a lie and returns short pages. Existing rows stay NULL,
 *   which the predicate reads as "no bindings" and passes vacuously; that is
 *   what keeps the entire pre-Phase-4 corpus visible to its own assignees.
 *
 * The GIN clause is written by hand: `@Index({ type: 'gin' })` is recorded in
 * the snapshot, but the schema generator emits a plain btree here, and btree
 * cannot serve the array containment/overlap operators the gate is built from.
 * Same correction as `workflow_definitions_definition_gin_idx`.
 */
export class Migration20260728163001_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "user_tasks" add "assignee_kind" varchar(20) not null default 'user', add "entity_types" text[] null;`);
    this.addSql(`create index "user_tasks_entity_types_gin_idx" on "user_tasks" using gin ("entity_types");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "user_tasks_entity_types_gin_idx";`);
    this.addSql(`alter table "user_tasks" drop column "assignee_kind", drop column "entity_types";`);
  }

}
