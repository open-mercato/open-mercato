import { NextResponse } from 'next/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ConflictRecheck = () => Promise<void>

const recheckByRequest = new WeakMap<Request, ConflictRecheck>()

export function registerCreateConflictRecheck(request: Request | undefined, recheck: ConflictRecheck): void {
  if (request) recheckByRequest.set(request, recheck)
}

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
