import {
  mapCrudServerErrorToFormErrors,
  normalizeCrudServerError,
  raiseCrudError,
  readJsonSafe,
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
})
