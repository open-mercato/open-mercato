import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTimeProjectMember, StaffTimesheetPreference } from '../../data/entities'

export type TimesheetPreferenceScope = {
  tenantId: string
  organizationId: string
}

export type TimesheetPreference = {
  lastProjectId: string | null
  updatedAt: string | null
}

const EMPTY_PREFERENCE: TimesheetPreference = { lastProjectId: null, updatedAt: null }

/**
 * True when the project is currently an active assignment for this member in this
 * organization. Guards both directions: a stored default that has gone stale is not
 * served, and a project the caller was never assigned to cannot be stored.
 */
export async function isProjectAssignedToMember(
  em: EntityManager,
  scope: TimesheetPreferenceScope,
  staffMemberId: string,
  projectId: string,
): Promise<boolean> {
  const membership = await findOneWithDecryption(
    em,
    StaffTimeProjectMember,
    {
      timeProjectId: projectId,
      staffMemberId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'active',
      deletedAt: null,
    },
    {},
    scope,
  )
  return membership != null
}

export async function loadTimesheetPreference(
  em: EntityManager,
  scope: TimesheetPreferenceScope,
  staffMemberId: string,
): Promise<TimesheetPreference> {
  const record = await findOneWithDecryption(
    em,
    StaffTimesheetPreference,
    {
      staffMemberId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )
  if (!record) return EMPTY_PREFERENCE

  const updatedAt = record.updatedAt ? record.updatedAt.toISOString() : null
  if (!record.lastProjectId) return { lastProjectId: null, updatedAt }

  // A project can be deleted, archived, or the assignment revoked after it was
  // stored. Serving it would offer the member a project they cannot book to.
  const stillAssigned = await isProjectAssignedToMember(em, scope, staffMemberId, record.lastProjectId)
  return { lastProjectId: stillAssigned ? record.lastProjectId : null, updatedAt }
}

/**
 * Upserts the single preference row for (organization, tenant, member).
 *
 * Deliberately one statement rather than load-then-branch: two timer starts fired
 * from two tabs both miss on a read, both insert, and the partial unique index
 * turns the loser into a unique-violation 500. The conflict target repeats the
 * index predicate (`WHERE deleted_at IS NULL`) because Postgres only infers a
 * partial unique index when the statement restates it.
 */
const UPSERT_SQL = `INSERT INTO staff_timesheet_preferences
       (tenant_id, organization_id, staff_member_id, last_project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, now(), now())
     ON CONFLICT (organization_id, tenant_id, staff_member_id) WHERE deleted_at IS NULL
     DO UPDATE SET last_project_id = EXCLUDED.last_project_id, updated_at = now()
     RETURNING last_project_id, updated_at`

const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown })?.code === UNIQUE_VIOLATION
}

export async function saveTimesheetPreference(
  em: EntityManager,
  scope: TimesheetPreferenceScope,
  staffMemberId: string,
  lastProjectId: string | null,
): Promise<TimesheetPreference> {
  type UpsertRow = { last_project_id: string | null; updated_at: Date | string }
  const params = [scope.tenantId, scope.organizationId, staffMemberId, lastProjectId]
  // Nothing wraps this route in a transaction today, so the context is
  // undefined and the behaviour is unchanged — but passing it means the upsert
  // joins the transaction rather than silently escaping it if one is ever added.

  let rows: UpsertRow[] | undefined
  try {
    rows = await em.getConnection().execute<UpsertRow[]>(UPSERT_SQL, params, 'all', em.getTransactionContext())
  } catch (err) {
    // Defensive only, with no known trigger. The conflict target infers the
    // partial unique index, so concurrent writers resolve inside the statement,
    // and a missing index would surface as 42P10 rather than 23505 — which this
    // check deliberately re-throws instead of retrying. Kept as the belt-and-
    // braces guard the spec asks for, and as the one place a 23505 on this table
    // would be attributable if the schema ever drifts.
    if (!isUniqueViolation(err)) throw err
    rows = await em.getConnection().execute<UpsertRow[]>(UPSERT_SQL, params, 'all', em.getTransactionContext())
  }

  const row = rows?.[0]
  if (!row) return { lastProjectId, updatedAt: null }

  const updatedAt =
    row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString()
  return { lastProjectId: row.last_project_id ?? null, updatedAt }
}
