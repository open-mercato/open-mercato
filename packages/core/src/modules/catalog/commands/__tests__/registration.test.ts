export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog command registration', () => {
  const cases = [
    {
      path: '../products',
      expected: ['catalog.product.create', 'catalog.product.update', 'catalog.product.delete'],
    },
    {
      path: '../variants',
      expected: ['catalog.variant.create', 'catalog.variant.update', 'catalog.variant.delete'],
    },
    {
      path: '../prices',
      expected: ['catalog.price.create', 'catalog.price.update', 'catalog.price.delete'],
    },
    {
      path: '../priceKinds',
      expected: ['catalog.price-kind.create', 'catalog.price-kind.update', 'catalog.price-kind.delete'],
    },
    {
      path: '../categories',
      expected: ['catalog.category.create', 'catalog.category.update', 'catalog.category.delete'],
    },
  ]

  beforeEach(() => {
    registerCommand.mockClear()
    jest.resetModules()
  })

  for (const testCase of cases) {
    it(`registers commands for ${testCase.path}`, () => {
      jest.isolateModules(() => {
        require(testCase.path)
      })

      const ids = registerCommand.mock.calls.map(([cmd]) => cmd.id)
      expect(ids).toEqual(testCase.expected)
    })
  }
})
