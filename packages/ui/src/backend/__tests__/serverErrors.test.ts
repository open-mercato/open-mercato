import { mapCrudServerErrorToFormErrors, raiseCrudError } from '../utils/serverErrors'

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

  it('raiseCrudError falls back to message when body is plain text', async () => {
    expect.assertions(1)
    const response = new Response('Something went wrong', { status: 500 })

    await expect(raiseCrudError(response, 'Fallback message')).rejects.toMatchObject({
      status: 500,
      message: 'Fallback message',
    })
  })
})
