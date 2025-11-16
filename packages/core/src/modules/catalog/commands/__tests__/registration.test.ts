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
      expected: ['catalog.products.create', 'catalog.products.update', 'catalog.products.delete'],
    },
    {
      path: '../variants',
      expected: ['catalog.variants.create', 'catalog.variants.update', 'catalog.variants.delete'],
    },
    {
      path: '../options',
      expected: [
        'catalog.options.create',
        'catalog.options.update',
        'catalog.options.delete',
        'catalog.option-values.create',
        'catalog.option-values.update',
        'catalog.option-values.delete',
      ],
    },
    {
      path: '../prices',
      expected: ['catalog.prices.create', 'catalog.prices.update', 'catalog.prices.delete'],
    },
    {
      path: '../priceKinds',
      expected: ['catalog.priceKinds.create', 'catalog.priceKinds.update', 'catalog.priceKinds.delete'],
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
