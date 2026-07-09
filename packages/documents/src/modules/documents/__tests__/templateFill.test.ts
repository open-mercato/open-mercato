import { fillTemplateTokens, type TemplateFillSlot } from '../lib/templateFill'

const DEAL_ID = '11111111-1111-4111-8111-111111111111'

describe('fillTemplateTokens', () => {
  it('escapes substituted field values', () => {
    const html = '<p>Hello {{customer.name}} at {{customer.email}}</p>'
    const slots: TemplateFillSlot[] = [
      {
        slot: 'customer',
        entityType: 'customer-person',
        rawItem: {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Ada & <Grace> "Q" \'L\'',
          email: 'ada@example.test',
        },
      },
    ]

    expect(fillTemplateTokens(html, slots)).toBe(
      '<p>Hello Ada &amp; &lt;Grace&gt; &quot;Q&quot; &#39;L&#39; at ada@example.test</p>',
    )
  })

  it('substitutes entity chips with escaped attributes and label text', () => {
    const html = '<p>Deal: {{deal.chip}}</p>'
    const slots: TemplateFillSlot[] = [
      {
        slot: 'deal',
        entityType: 'deal',
        rawItem: {
          id: DEAL_ID,
          title: 'Acme & Sons <Deal>',
          status: 'open',
        },
      },
    ]

    const filled = fillTemplateTokens(html, slots)

    expect(filled).toContain('data-entity-ref')
    expect(filled).toContain('data-entity-type="deal"')
    expect(filled).toContain(`data-entity-id="${DEAL_ID}"`)
    expect(filled).toContain(`data-href="/backend/customers/deals/${DEAL_ID}"`)
    expect(filled).toContain('Acme &amp; Sons &lt;Deal&gt;')
  })

  it('strips unresolved tokens and collapses doubled spaces', () => {
    const html = '<p>Product {{product.sku}}  {{product.chip}} ready</p>'
    const slots: TemplateFillSlot[] = [
      {
        slot: 'product',
        entityType: 'product',
        rawItem: null,
      },
    ]

    expect(fillTemplateTokens(html, slots)).toBe('<p>Product ready</p>')
  })

  it('replaces date tokens with the localized date', () => {
    const html = '<p>{{date}}</p>'
    const now = new Date('2026-01-02T12:00:00.000Z')

    expect(fillTemplateTokens(html, [], { locale: 'en-US', now })).toBe('<p>1/2/2026</p>')
  })
})
