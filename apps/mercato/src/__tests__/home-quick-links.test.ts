import { buildHomeQuickLinks } from '@/lib/homeQuickLinks'

describe('buildHomeQuickLinks', () => {
  it('keeps example links when the example module is enabled', () => {
    const links = buildHomeQuickLinks([{ id: 'auth' }, { id: 'example' }])

    expect(links.map((link) => link.href)).toEqual([
      '/login',
      '/example',
      '/backend/example',
      '/backend/todos',
      '/blog/123',
    ])
  })

  it('removes example links when the example module is disabled', () => {
    const links = buildHomeQuickLinks([{ id: 'auth' }, { id: 'customers' }])

    expect(links.map((link) => link.href)).toEqual(['/login'])
  })
})
