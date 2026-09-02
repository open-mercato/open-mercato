/** @jest-environment node */
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { mapEnforcementError } from '../enforcement/_shared'
import { mapMfaError } from '../mfa/_shared'
import { mapSudoError } from '../sudo/_shared'
import { mapSecurityUsersError } from '../users/_shared'

const mappers = [
  ['mapEnforcementError', mapEnforcementError, 'Failed to process enforcement request.'],
  ['mapMfaError', mapMfaError, 'Failed to process MFA request.'],
  ['mapSudoError', mapSudoError, 'Failed to process sudo request.'],
  ['mapSecurityUsersError', mapSecurityUsersError, 'Failed to process user security request.'],
] as const

describe('security route error mappers and command interceptor rejections', () => {
  it.each(mappers)('%s surfaces the status and body of a status-carrying rejection', async (_name, mapper) => {
    const response = await mapper(
      new CommandInterceptorError('Missing required fields', {
        status: 422,
        body: { error: 'Missing required fields', missingFields: ['scope'] },
      }),
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing required fields',
      missingFields: ['scope'],
    })
  })

  it.each(mappers)('%s keeps its generic 500 when the rejection carries no status', async (_name, mapper, fallback) => {
    const response = await mapper(new CommandInterceptorError('Blocked without a status'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: fallback })
  })

  it.each(mappers)('%s keeps mapping CrudHttpError ahead of the interceptor branch', async (_name, mapper) => {
    const response = await mapper(new CrudHttpError(403, { error: 'Forbidden' }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
  })
})
