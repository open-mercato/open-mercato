import { NextResponse } from 'next/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ConflictRecheck = () => Promise<void>

// `makeCrudRoute` inserts in its own transaction with no hook around the flush, so a
// unique violation from a concurrent create reaches the factory's generic 500 branch.
// A create's `beforeCreate` pre-check registers itself here, keyed by the request, and
// the wrapped handler re-runs it when the create answered 500: a violated unique index
// means the conflicting row is committed, so the re-run now finds it and the caller
// gets the same translated 409 a sequential duplicate gets.
const recheckByRequest = new WeakMap<Request, ConflictRecheck>()

export function registerCreateConflictRecheck(request: Request | undefined, recheck: ConflictRecheck): void {
  if (request) recheckByRequest.set(request, recheck)
}

// Reaching `afterCreate` means the insert committed, so a later 500 (a side effect
// failing) is not a unique violation — the re-run would only find this request's own row.
export function clearCreateConflictRecheck(request: Request | undefined): void {
  if (request) recheckByRequest.delete(request)
}

export function withCreateConflictRecheck(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const response = await handler(request)
    const recheck = recheckByRequest.get(request)
    recheckByRequest.delete(request)
    if (!recheck || response.status !== 500) return response
    try {
      await recheck()
    } catch (err) {
      if (isCrudHttpError(err) && err.status === 409) return NextResponse.json(err.body, { status: 409 })
    }
    return response
  }
}
