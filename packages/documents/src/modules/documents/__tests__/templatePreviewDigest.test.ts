import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  canonicalizeTemplatePreviewInput,
  computeTemplatePreviewDigest,
  type TemplatePreviewDigestInput,
} from '../lib/templatePreviewDigest'
import { dedupeTemplateLinkSlots } from '../lib/templateInstantiation'

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COMPANY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function vector(): TemplatePreviewDigestInput {
  return {
    templateId: TEMPLATE_ID,
    templateUpdatedAt: '2026-07-09T12:00:00+02:00',
    title: ' Re\u0301sume\u0301 ',
    locale: 'EN-us',
    effectiveDate: '2026-12-01T09:30:00-05:00',
    slots: [
      {
        slot: 'deal',
        entityType: 'deal',
        entityId: DEAL_ID,
        label: 'Deal',
        href: `/backend/customers/deals/${DEAL_ID}`,
        values: { title: 'Launch' },
      },
      {
        slot: 'company',
        entityType: 'customer-company',
        entityId: COMPANY_ID,
        label: 'Cafe\u0301',
        href: `/backend/customers/companies/${COMPANY_ID}`,
        values: { zeta: 'e\u0301', alpha: 1 },
      },
    ],
  }
}

describe('template preview digest', () => {
  it('matches the canonical SHA-256 golden vector', () => {
    expect(computeTemplatePreviewDigest(vector())).toBe(
      'sha256:0528871918df56f5e37fdab7161ab6b27d67f05130d5b7bf608e17d0d1ae054b',
    )
    expect(canonicalizeTemplatePreviewInput(vector())).toMatchObject({
      title: 'Résumé',
      locale: 'en-US',
      templateUpdatedAt: '2026-07-09T10:00:00.000Z',
      effectiveDate: '2026-12-01T14:30:00.000Z',
      slots: [
        { slot: 'company', label: 'Café', values: { alpha: 1, zeta: 'é' } },
        { slot: 'deal' },
      ],
    })
  })

  it('is invariant to slot and value-key insertion order', () => {
    const reordered = vector()
    reordered.slots.reverse()
    reordered.slots[0]!.values = { alpha: 1, zeta: 'é' }
    expect(computeTemplatePreviewDigest(reordered)).toBe(computeTemplatePreviewDigest(vector()))
  })

  it('changes for one semantic value or preserved internal whitespace', () => {
    const changed = vector()
    changed.slots[0]!.values.title = 'Launch 2'
    expect(computeTemplatePreviewDigest(changed)).not.toBe(computeTemplatePreviewDigest(vector()))

    const whitespace = vector()
    whitespace.title = 'Re  sume'
    expect(computeTemplatePreviewDigest(whitespace)).not.toBe(computeTemplatePreviewDigest(vector()))
  })

  it('rejects duplicate slots and non-finite numbers instead of coercing', () => {
    const duplicate = vector()
    duplicate.slots.push({ ...duplicate.slots[0]! })
    expect(() => computeTemplatePreviewDigest(duplicate)).toThrow(CrudHttpError)

    const invalid = vector()
    invalid.slots[0]!.values.title = Number.POSITIVE_INFINITY
    expect(() => computeTemplatePreviewDigest(invalid)).toThrow()
  })

  it('keeps repeated semantic slots for rendering but deduplicates relation identities', () => {
    const first = vector().slots[0]!
    const repeated = [
      { ...first, slot: 'primary' },
      { ...first, slot: 'secondary' },
    ]
    expect(repeated).toHaveLength(2)
    expect(dedupeTemplateLinkSlots(repeated)).toHaveLength(1)
  })
})
