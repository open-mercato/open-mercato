/** @jest-environment node */
import { guards } from '../data/guards'

describe('example Todo mutation guard', () => {
  it('refuses an unscoped create in the guard own wording', async () => {
    const result = await guards[0].validate({ operation: 'create' } as never)

    expect(result).toEqual({
      ok: false,
      message: 'Organization is required to create todos',
      status: 422,
    })
  })
})
