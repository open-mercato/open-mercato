import { Migration } from '@mikro-orm/migrations';

/**
 * Hand-written data migration: no schema change, so the generator cannot emit it
 * and the ORM snapshot is unaffected.
 *
 * Soft-deleting a time entry never cascaded to its work segments, so every entry
 * deleted before that fix left segments with `deleted_at = NULL` pointing at a
 * deleted parent — some of them still open (`ended_at = NULL`). This adopts the
 * parent's `deleted_at` rather than `now()` so the timestamps stay coherent, and
 * deliberately does not collide with the recorded-instant restore path, since no
 * action log written before the fix carries `segmentsDeletedAt`.
 *
 * An open segment is closed at the parent's `deleted_at`, matching exactly what the
 * runtime cascade does. The entry's own `ended_at` is deliberately NOT consulted,
 * because a row in the population this repairs can carry an end that predates its
 * newest segment's `started_at`. `staffTimeEntryCreateSchema` accepts `startedAt` and
 * `endedAt` independently, so a manual create could record an end with no start, and a
 * later `POST .../timer-start` then gave that entry a `startedAt` and a fresh segment
 * while leaving the stale `ended_at` in place. Adopting it for such a row would write a
 * negative-duration segment that this migration's no-op `down()` could never take back.
 *
 * That producer is fixed in the same change — `startTimerExistingCommand.execute` now
 * clears `endedAt` when it opens a segment — so no row written from here on acquires the
 * shape. The two-term form is still the rule rather than a leftover: this migration
 * exists precisely for rows written before that fix, and adding the entry's `ended_at`
 * back as a third COALESCE term would corrupt exactly the rows it is here to repair.
 *
 * (`start_timer_existing` never produced the same shape by restarting a stopped entry:
 * it re-reads the row under `LockMode.PESSIMISTIC_WRITE` and rejects any entry that
 * already has a `started_at` with 409 `timerAlreadyStarted`.)
 *
 * Size the affected rows before applying:
 *
 *   select count(*) from staff_time_entry_segments s
 *   join staff_time_entries e on e.id = s.time_entry_id
 *   where e.deleted_at is not null and s.deleted_at is null;
 */
export class Migration20260826193000_staff_segment_orphan_backfill extends Migration {

  override async up(): Promise<void> {
    this.addSql(`update "staff_time_entry_segments" s
      set "deleted_at" = e."deleted_at",
          "ended_at"   = coalesce(s."ended_at", e."deleted_at"),
          "updated_at" = now()
      from "staff_time_entries" e
      where s."time_entry_id" = e."id"
        and e."deleted_at" is not null
        and s."deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    // Not reversible: a rolled-back backfill cannot tell the rows it stamped from
    // the ones the cascade has since stamped legitimately, and both carry their
    // parent's timestamp. Leaving it applied is safe — every row it touched has a
    // parent that is already soft-deleted, so no scoped read returns them.
  }

}
