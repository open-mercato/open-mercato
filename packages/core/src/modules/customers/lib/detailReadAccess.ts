import { NextResponse } from 'next/server'
import {
  isOrganizationReadAccessAllowed,
  type OrganizationReadAccessInput,
} from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'

/**
 * Single-record customers detail routes (person / company / deal) must not leak
 * whether a record exists through the organization-scope check.
 *
 * The API dispatcher already enforces each route's `metadata.requireFeatures`
 * before the handler runs, returning a uniform `403` for callers who lack the
 * grant — so that path never distinguishes an existing id from a missing one.
 * The only remaining existence signal is the *post-load* organization guard: a
 * caller who holds the feature but whose scope excludes the record's
 * organization previously received `403` (record exists in another org) while a
 * non-existent id received `404`. That 403-vs-404 split is an existence oracle
 * (issue #5504).
 *
 * Collapse the organization-scope denial into the route's own not-found
 * response so an out-of-scope caller cannot tell "exists in an organization you
 * cannot see" from "does not exist" — the shape the api_keys hardening
 * (#4033 / PR-4051) established. Sharing this decision keeps the three customers
 * detail routes from drifting apart again.
 *
 * @returns the `404` response to return when read access is denied, or `null`
 * when the caller may read the record.
 */
export function denyCustomerDetailReadAsNotFound(
  input: OrganizationReadAccessInput,
  notFoundMessage: string,
): NextResponse | null {
  if (isOrganizationReadAccessAllowed(input)) return null
  return NextResponse.json({ error: notFoundMessage }, { status: 404 })
}
