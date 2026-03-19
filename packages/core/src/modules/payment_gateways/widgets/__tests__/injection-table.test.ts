/**
 * @jest-environment node
 */

describe('payment_gateways injection table', () => {
  it('registers the payment providers shortcut in the settings sidebar', async () => {
    const mod = await import('../injection-table')
    const table = mod.injectionTable

    expect(table['menu:sidebar:settings']).toEqual({
      widgetId: 'payment_gateways.injection.payments-providers-menu',
      priority: 50,
    })
    expect(table['menu:sidebar:main']).toBeUndefined()
  })
})
