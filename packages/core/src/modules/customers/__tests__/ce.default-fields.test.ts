import entities from '../ce'

describe('customers ce defaults', () => {
  it('declares the shared leadership checkbox for canonical interactions', () => {
    const interactionEntity = entities.find((entity) => entity.id === 'customers:customer_interaction')

    expect(interactionEntity?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'shared_with_leadership',
          kind: 'boolean',
          defaultValue: false,
        }),
      ]),
    )
  })
})
