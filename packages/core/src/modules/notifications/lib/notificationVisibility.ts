import { sql, type RawBuilder } from 'kysely'
import { IN_APP_CHANNEL } from './strategies/in-app-delivery-strategy'

/**
 * MikroORM filter fragment selecting notifications that should be VISIBLE in the in-app surfaces
 * (bell, inbox list, unread count, poll). A row is visible when the `in_app` channel survived the
 * create-time delivery gate — i.e. `in_app ∈ channels` — or when `channels` is NULL (legacy rows
 * and any environment without the seam wired, which behave as "all channels" for backward
 * compatibility). Rows targeted away from in-app (e.g. a push-only send, or a type/preference that
 * excluded in_app) still exist as durable records but are hidden here.
 *
 * AND-composed with the caller's other conditions when merged into a filter object.
 *
 * `channels` is a JSONB column (`data/entities.ts`); MikroORM's `$contains` maps to the Postgres
 * `@>` containment operator with a JSON-encoded operand — i.e. `channels @> '["in_app"]'` — so a row
 * with `["in_app","email"]` matches and one with `["push"]` does not. Same operator MikroORM emits for
 * the JSONB `$contains` filters already in production on `staff.role_ids` and `workflows.metadata`.
 */
export function inAppVisibleFilter(): { $or: Array<Record<string, unknown>> } {
  return {
    $or: [
      { channels: null },
      { channels: { $contains: [IN_APP_CHANNEL] } },
    ],
  }
}

/**
 * In-memory counterpart of {@link inAppVisibleFilter} for a single row's resolved channel set. Used
 * to gate the live bell SSE emit so a notification suppressed from the in-app channel does not push a
 * real-time badge/inbox update. `null`/`undefined` channels ⇒ visible (legacy / all-channels).
 */
export function isInAppVisible(channels: string[] | null | undefined): boolean {
  return channels == null || channels.includes(IN_APP_CHANNEL)
}

/**
 * Raw-SQL counterpart of {@link inAppVisibleFilter} for queries built with Kysely
 * (which cannot consume MikroORM's `$contains` fragment). Emits
 * `(<column> IS NULL OR <column> @> '["in_app"]'::jsonb)` — the exact predicate
 * MikroORM produces — so raw and ORM paths stay in lock-step. `columnRef` MUST be
 * a trusted, code-controlled column identifier (never user input).
 */
export function inAppVisibleSql(columnRef = 'channels'): RawBuilder<boolean> {
  return sql<boolean>`(${sql.ref(columnRef)} is null or ${sql.ref(columnRef)} @> ${sql.val(
    JSON.stringify([IN_APP_CHANNEL]),
  )}::jsonb)`
}
