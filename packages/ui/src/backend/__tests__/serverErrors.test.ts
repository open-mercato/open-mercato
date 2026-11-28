import { z as zodV3 } from 'zod/v3'
import { z as zodV4 } from 'zod/v4'
import {
  mapCrudServerErrorToFormErrors,
  normalizeCrudServerError,
  raiseCrudError,
  readJsonSafe,
  resolveFieldIssueTranslation,
} from '../utils/serverErrors'

describe('serverErrors helpers', () => {
  it('maps details array into field errors and message', () => {
    const error = {
      error: 'Invalid input',
      details: [
        {
          origin: 'string',
          code: 'too_small',
          minimum: 6,
          inclusive: true,
          path: ['password'],
          message: 'Too small: expected string to have >=6 characters',
        },
      ],
    }

    const result = mapCrudServerErrorToFormErrors(error, { customEntity: false })
    expect(result.fieldErrors).toEqual({
      password: 'Too small: expected string to have >=6 characters',
    })
    expect(result.message).toBe('Too small: expected string to have >=6 characters')
  })

  it('captures the Zod issue code and params alongside the field error message', () => {
    const error = {
      error: 'Invalid input',
      details: [
        {
          origin: 'string',
          code: 'too_big',
          maximum: 120,
          path: ['lastName'],
          message: 'Too big: expected string to have <=120 characters',
        },
      ],
    }

    const result = mapCrudServerErrorToFormErrors(error, { customEntity: false })
    expect(result.fieldErrors).toEqual({
      lastName: 'Too big: expected string to have <=120 characters',
    })
    expect(result.fieldIssues).toEqual({
      lastName: {
        code: 'too_big',
        message: 'Too big: expected string to have <=120 characters',
        params: { maximum: 120, origin: 'string' },
      },
    })
  })

  it('keeps provided fieldErrors when available', () => {
    const error = {
      message: 'Invalid input',
      fieldErrors: {
        cf_notes: 'Notes are required',
      },
    }

    const result = mapCrudServerErrorToFormErrors(error, { customEntity: false })
    expect(result.fieldErrors).toEqual({ cf_notes: 'Notes are required' })
    expect(result.message).toBe('Notes are required')
  })

  it('raiseCrudError throws structured object with parsed body', async () => {
    expect.assertions(2)
    const response = new Response(
      JSON.stringify({
        error: 'Invalid input',
        details: [
          {
            path: ['password'],
            message: 'Too small: expected string to have >=6 characters',
          },
        ],
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )

    try {
      await raiseCrudError(response, 'Fallback message')
    } catch (err) {
      expect(err).toMatchObject({ status: 400, message: 'Invalid input' })
      expect(err).toHaveProperty('details')
    }
  })

  it('raiseCrudError extracts message from structured { error: { code, message } } envelope', async () => {
    expect.assertions(4)
    const response = new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'invite_cooldown_active',
          message: 'A recent invite for this email is still pending — please wait before re-inviting.',
          details: { retryAfterSeconds: 60 },
        },
      }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    )

    try {
      await raiseCrudError(response, 'Fallback message')
    } catch (err) {
      expect(err).toMatchObject({
        status: 429,
        message:
          'A recent invite for this email is still pending — please wait before re-inviting.',
      })
      const errorField = (err as { error?: unknown }).error as
        | { code?: unknown; details?: unknown }
        | undefined
      expect(errorField?.code).toBe('invite_cooldown_active')
      expect(errorField?.details).toEqual({ retryAfterSeconds: 60 })
      expect((err as { ok?: unknown }).ok).toBe(false)
    }
  })

  it('normalizeCrudServerError reads message from nested { error: { message } } envelope', () => {
    const normalized = normalizeCrudServerError({
      ok: false,
      error: {
        code: 'invite_cooldown_active',
        message: 'A recent invite for this email is still pending — please wait before re-inviting.',
      },
    })
    expect(normalized.message).toBe(
      'A recent invite for this email is still pending — please wait before re-inviting.',
    )
  })

  it('raiseCrudError prefers top-level string error over nested error.message', async () => {
    expect.assertions(1)
    const response = new Response(
      JSON.stringify({
        error: 'Top-level message',
        message: 'Top-level message',
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )

    await expect(raiseCrudError(response, 'Fallback message')).rejects.toMatchObject({
      status: 400,
      message: 'Top-level message',
    })
  })

  it('raiseCrudError falls back when structured envelope has empty nested message', async () => {
    expect.assertions(1)
    const response = new Response(
      JSON.stringify({ ok: false, error: { code: 'oops', message: '   ' } }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )

    await expect(raiseCrudError(response, 'Fallback message')).rejects.toMatchObject({
      status: 500,
      message: 'Fallback message',
    })
  })

  it('raiseCrudError falls back to message when body is plain text', async () => {
    expect.assertions(1)
    const response = new Response('Something went wrong', { status: 500 })

    await expect(raiseCrudError(response, 'Fallback message')).rejects.toMatchObject({
      status: 500,
      message: 'Fallback message',
    })
  })

  it('readJsonSafe returns fallback when body empty', async () => {
    const response = new Response('', { status: 200 })
    const result = await readJsonSafe<{ ok: boolean }>(response, { ok: false })
    expect(result).toEqual({ ok: false })
  })

  it('readJsonSafe returns fallback when parsing fails', async () => {
    const response = new Response('not json', { status: 200 })
    const result = await readJsonSafe<{ ok: boolean }>(response, { ok: true })
    expect(result).toEqual({ ok: true })
  })

  it('resolveFieldIssueTranslation maps a known Zod code to a localizable key with params', () => {
    const translation = resolveFieldIssueTranslation(
      { code: 'too_big', message: 'Too big: expected string to have <=120 characters', params: { maximum: 120 } },
      'Too big: expected string to have <=120 characters',
    )
    expect(translation).toEqual({
      key: 'ui.forms.errors.tooBig',
      fallback: 'Too big: expected string to have <=120 characters',
      params: { maximum: 120 },
    })
  })

  it('resolveFieldIssueTranslation falls back to the raw message for an unmapped or missing code', () => {
    expect(resolveFieldIssueTranslation({ code: 'custom', message: 'Some custom check failed' }, 'Some custom check failed')).toEqual({
      key: '',
      fallback: 'Some custom check failed',
    })
    expect(resolveFieldIssueTranslation(undefined, 'stable.i18n.key')).toEqual({
      key: '',
      fallback: 'stable.i18n.key',
    })
  })

  it('resolveFieldIssueTranslation maps Zod v3 and v4 default messages for every known code', () => {
    const defaults: Array<[string, string]> = [
      ['too_big', 'Too big: expected number to be <=100'],
      ['too_big', 'Number must be less than or equal to 100'],
      ['too_big', 'String must contain at most 120 character(s)'],
      ['too_small', 'Too small: expected string to have >=1 characters'],
      ['too_small', 'Array must contain at least 1 element(s)'],
      ['invalid_type', 'Invalid input: expected string, received undefined'],
      ['invalid_type', 'Expected number, received string'],
      ['invalid_type', 'Required'],
    ]
    for (const [code, message] of defaults) {
      expect(resolveFieldIssueTranslation({ code, message }, message).key).not.toBe('')
    }
  })

  it('recognizes actual Zod v3 and v4 defaults across bounds and types', () => {
    for (const zod of [zodV3, zodV4]) {
      const cases = [
        zod.string().max(1).safeParse('long'),
        zod.string().min(4).safeParse('x'),
        zod.number().max(-0.5).safeParse(1),
        zod.number().min(1e21).safeParse(1),
        zod.array(zod.string()).max(0).safeParse(['x']),
        zod.array(zod.string()).min(1).safeParse([]),
        zod.bigint().max(BigInt(1)).safeParse(BigInt(2)),
        zod.bigint().min(BigInt(2)).safeParse(BigInt(1)),
        zod.date().max(new Date('2020-01-01')).safeParse(new Date('2021-01-01')),
        zod.date().min(new Date('2021-01-01')).safeParse(new Date('2020-01-01')),
        zod.string().safeParse(1),
        zod.number().safeParse(undefined),
      ]
      for (const result of cases) {
        expect(result.success).toBe(false)
        if (result.success) continue
        for (const issue of result.error.issues) {
          expect(resolveFieldIssueTranslation(issue, issue.message).key).not.toBe('')
        }
      }
    }
  })

  it.each([
    ['too_big', 'Too big: use a shorter person name'],
    ['too_small', 'Too small: select at least one warehouse'],
    ['invalid_type', 'Invalid input: expected a valid currency'],
    ['too_big', 'Number must be less than or equal to 100 for this policy'],
    ['too_small', 'Too small: expected string to have >=1 characters; enter a name'],
    ['invalid_type', 'Invalid input: expected string, received undefined; enter a name'],
  ])('preserves custom wording for %s even when it starts like a default', (code, message) => {
    expect(resolveFieldIssueTranslation({ code, message }, message)).toEqual({ key: '', fallback: message })
  })

  it('resolveFieldIssueTranslation preserves explicit validator messages on known Zod codes', () => {
    expect(
      resolveFieldIssueTranslation(
        { code: 'too_big', message: 'availability.policies.errors.integerTooLarge', params: { maximum: 2147483647 } },
        'availability.policies.errors.integerTooLarge',
      ),
    ).toEqual({ key: '', fallback: 'availability.policies.errors.integerTooLarge' })
    expect(
      resolveFieldIssueTranslation(
        { code: 'too_small', message: 'Pick at least one warehouse', params: { minimum: 1 } },
        'Pick at least one warehouse',
      ),
    ).toEqual({ key: '', fallback: 'Pick at least one warehouse' })
    expect(
      resolveFieldIssueTranslation(
        { code: 'invalid_type', message: 'Choose a valid currency' },
        'Choose a valid currency',
      ),
    ).toEqual({ key: '', fallback: 'Choose a valid currency' })
  })
})
