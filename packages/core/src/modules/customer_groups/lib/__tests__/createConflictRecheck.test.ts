import { conflict } from '@open-mercato/shared/lib/crud/errors'
import { clearCreateConflictRecheck, registerCreateConflictRecheck, withCreateConflictRecheck } from '../createConflictRecheck'

function request(): Request {
  return new Request('http://localhost/api/customer_groups/customer-groups', { method: 'POST' })
}

describe('withCreateConflictRecheck', () => {
  it('turns a failed create into the pre-check 409 once the conflicting row is committed', async () => {
    const recheck = jest.fn(async () => {
      throw conflict('A customer group with this code already exists.')
    })
    const handler = withCreateConflictRecheck(async (req) => {
      registerCreateConflictRecheck(req, recheck)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    })

    const response = await handler(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'A customer group with this code already exists.' })
    expect(recheck).toHaveBeenCalledTimes(1)
  })

  it('keeps the 500 when the re-check finds no conflict or fails otherwise', async () => {
    for (const recheck of [jest.fn(async () => {}), jest.fn(async () => { throw new Error('db down') })]) {
      const failure = Response.json({ error: 'Internal server error' }, { status: 500 })
      const handler = withCreateConflictRecheck(async (req) => {
        registerCreateConflictRecheck(req, recheck)
        return failure
      })

      await expect(handler(request())).resolves.toBe(failure)
    }
  })

  it('never re-checks a create that did not fail', async () => {
    const recheck = jest.fn(async () => {})
    const created = Response.json({ id: 'x' }, { status: 201 })
    const handler = withCreateConflictRecheck(async (req) => {
      registerCreateConflictRecheck(req, recheck)
      return created
    })

    await expect(handler(request())).resolves.toBe(created)
    expect(recheck).not.toHaveBeenCalled()
  })

  it('passes a 500 through when no pre-check ran', async () => {
    const failure = Response.json({ error: 'Internal server error' }, { status: 500 })
    await expect(withCreateConflictRecheck(async () => failure)(request())).resolves.toBe(failure)
  })

  it('keeps the 500 when the insert committed and a later side effect failed', async () => {
    const recheck = jest.fn(async () => {
      throw conflict('A customer group with this code already exists.')
    })
    const failure = Response.json({ error: 'Internal server error' }, { status: 500 })
    const handler = withCreateConflictRecheck(async (req) => {
      registerCreateConflictRecheck(req, recheck)
      clearCreateConflictRecheck(req)
      return failure
    })

    await expect(handler(request())).resolves.toBe(failure)
    expect(recheck).not.toHaveBeenCalled()
  })
})
