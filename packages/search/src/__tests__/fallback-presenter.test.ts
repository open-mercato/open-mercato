import { extractFallbackPresenter } from '../lib/fallback-presenter'

describe('extractFallbackPresenter', () => {
  it('prefers higher-priority title fields', () => {
    const presenter = extractFallbackPresenter(
      {
        display_name: 'Display Name',
        name: 'Name Value',
        title: 'Title Value',
      },
      'customers:person',
      'record-1',
    )

    expect(presenter.title).toBe('Display Name')
    expect(presenter.badge).toBe('Person')
  })

  it('builds title from first_name and last_name when no higher-priority title exists', () => {
    const presenter = extractFallbackPresenter(
      {
        first_name: 'Jan',
        last_name: 'Kowalski',
      },
      'customers:person',
      'record-2',
    )

    expect(presenter.title).toBe('Jan Kowalski')
  })

  it('builds title from firstName and lastName for camelCase records', () => {
    const presenter = extractFallbackPresenter(
      {
        firstName: 'Anna',
        lastName: 'Nowak',
      },
      'customers:person',
      'record-3',
    )

    expect(presenter.title).toBe('Anna Nowak')
  })

  it('uses available single name part when only first_name exists', () => {
    const presenter = extractFallbackPresenter(
      {
        first_name: 'Monika',
      },
      'customers:person',
      'record-4',
    )

    expect(presenter.title).toBe('Monika')
  })

  it('prefers composed name from parts before email fallback', () => {
    const presenter = extractFallbackPresenter(
      {
        first_name: 'Tomasz',
        last_name: 'Brzęczyszczykiewicz',
        email: 'tomasz@example.com',
      },
      'customers:person',
      'record-5',
    )

    expect(presenter.title).toBe('Tomasz Brzęczyszczykiewicz')
  })

  it('truncates subtitle to at most 120 characters', () => {
    const longDescription = 'A'.repeat(90)
    const longSummary = 'B'.repeat(90)

    const presenter = extractFallbackPresenter(
      {
        name: 'Long Subtitle Record',
        description: longDescription,
        summary: longSummary,
      },
      'search:document',
      'record-6',
    )

    expect(presenter.subtitle).toBeDefined()
    expect((presenter.subtitle ?? '').length).toBeLessThanOrEqual(120)
    expect(presenter.subtitle).toContain('A')
  })

  it('does not duplicate title as subtitle part', () => {
    const presenter = extractFallbackPresenter(
      {
        name: 'Acme Corp',
        description: 'Acme Corp',
        summary: 'Important customer',
      },
      'customers:company',
      'record-7',
    )

    expect(presenter.title).toBe('Acme Corp')
    expect(presenter.subtitle).toBe('Important customer')
  })

  it('falls back to entity label and short id when no string fields are available', () => {
    const presenter = extractFallbackPresenter(
      {
        id: 'ignored',
        created_at: '2026-01-01',
      },
      'catalog:product_variant',
      '1234567890abcdef',
    )

    expect(presenter.title).toBe('Product Variant 12345678...')
    expect(presenter.badge).toBe('Product Variant')
  })

  it('excludes technical tenant/organization/timestamp fields from generic fallback title selection', () => {
    const presenter = extractFallbackPresenter(
      {
        tenant_id: 'Tenant Name Should Not Be Used',
        organizationId: 'Org Name Should Not Be Used',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      'customers:company',
      'abcdef1234567890',
    )

    expect(presenter.title).toBe('Company abcdef12...')
  })

  it('does not use cf:* or cf_* values as generic fallback title', () => {
    const presenter = extractFallbackPresenter(
      {
        'cf:custom_display_name': 'Custom Field Value',
        cf_custom_name: 'Another Custom Field Value',
      },
      'catalog:product',
      'fedcba9876543210',
    )

    expect(presenter.title).toBe('Product fedcba98...')
  })
})
