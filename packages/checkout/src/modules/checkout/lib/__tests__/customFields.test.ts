import type { EntityManager } from '@mikro-orm/postgresql'
import {
  decorateRecordWithCustomFields,
  loadCustomFieldDefinitionIndex,
} from '@open-mercato/shared/lib/crud/custom-fields'
import { loadEntityFieldsetConfigs } from '@open-mercato/core/modules/entities/lib/fieldsets'
import { CHECKOUT_LINK_CUSTOM_FIELDS, CHECKOUT_LINK_FIELDSETS, resolveCheckoutPublicCustomFields } from '../customFields'
import polishCheckout from '../../i18n/pl.json'
import englishCheckout from '../../i18n/en.json'

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  decorateRecordWithCustomFields: jest.fn(),
  loadCustomFieldDefinitionIndex: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/entities/lib/fieldsets', () => ({
  loadEntityFieldsetConfigs: jest.fn(),
}))

const mockDecorateRecordWithCustomFields = decorateRecordWithCustomFields as jest.MockedFunction<typeof decorateRecordWithCustomFields>
const mockLoadCustomFieldDefinitionIndex = loadCustomFieldDefinitionIndex as jest.MockedFunction<typeof loadCustomFieldDefinitionIndex>
const mockLoadEntityFieldsetConfigs = loadEntityFieldsetConfigs as jest.MockedFunction<typeof loadEntityFieldsetConfigs>

describe('resolveCheckoutPublicCustomFields', () => {
  const em = {} as EntityManager

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns no public custom fields when the public display toggle is disabled', async () => {
    await expect(resolveCheckoutPublicCustomFields({
      em,
      entityId: 'checkout:checkout_link',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      customFieldsetCode: 'service_package',
      customValues: { service_deliverables: 'Included' },
      displayCustomFieldsOnPage: false,
    })).resolves.toEqual([])

    expect(mockLoadEntityFieldsetConfigs).not.toHaveBeenCalled()
    expect(mockLoadCustomFieldDefinitionIndex).not.toHaveBeenCalled()
  })

  it('resolves only the selected fieldset definitions for public pay-page rendering', async () => {
    mockLoadEntityFieldsetConfigs.mockResolvedValue(new Map([
      ['checkout:checkout_link', { fieldsets: [{ code: 'service_package' }, { code: 'event_ticket' }] }],
    ]) as Awaited<ReturnType<typeof loadEntityFieldsetConfigs>>)
    mockLoadCustomFieldDefinitionIndex.mockResolvedValue(new Map([
      ['service_deliverables', [{ key: 'service_deliverables', label: 'What is included', kind: 'multiline', multi: false, priority: 0, updatedAt: 1 }]],
      ['support_contact', [{ key: 'support_contact', label: 'Support contact', kind: 'text', multi: false, priority: 0, updatedAt: 1 }]],
    ]))
    mockDecorateRecordWithCustomFields.mockReturnValue({
      customValues: {
        service_deliverables: 'Included',
        support_contact: 'team@example.com',
      },
      customFields: [
        { key: 'service_deliverables', label: 'What is included', value: 'Included', kind: 'multiline', multi: false },
        { key: 'support_contact', label: 'Support contact', value: 'team@example.com', kind: 'text', multi: false },
      ],
    })

    await expect(resolveCheckoutPublicCustomFields({
      em,
      entityId: 'checkout:checkout_link',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      customFieldsetCode: 'service_package',
      customValues: {
        service_deliverables: 'Included',
        support_contact: 'team@example.com',
        event_date: 'Ignored',
      },
      displayCustomFieldsOnPage: true,
    })).resolves.toEqual([
      { key: 'service_deliverables', label: 'What is included', value: 'Included', kind: 'multiline', multi: false },
      { key: 'support_contact', label: 'Support contact', value: 'team@example.com', kind: 'text', multi: false },
    ])

    expect(mockLoadCustomFieldDefinitionIndex).toHaveBeenCalledWith(expect.objectContaining({
      fieldset: 'service_package',
      entityIds: 'checkout:checkout_link',
      tenantId: 'tenant-1',
      organizationIds: ['org-1'],
    }))
    expect(mockDecorateRecordWithCustomFields).toHaveBeenCalledWith(
      {
        customFields: {
          service_deliverables: 'Included',
          support_contact: 'team@example.com',
        },
      },
      expect.any(Map),
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    )
  })
})

describe('service-package translations', () => {
  it('translates all existing seeded service-package labels, sections and help text into Polish', () => {
    const fieldset = CHECKOUT_LINK_FIELDSETS.find((entry) => entry.code === 'service_package')
    expect(fieldset).toBeDefined()
    if (!fieldset) throw new Error('[internal] Missing service-package fieldset')
    const fields = CHECKOUT_LINK_CUSTOM_FIELDS.filter((field) =>
      field.fieldset === 'service_package' || field.fieldsets?.includes('service_package'),
    )
    const entries = [
      ['fieldsets.service_package.label', fieldset.label],
      ['fieldsets.service_package.description', fieldset.description],
      ...(fieldset.groups ?? []).flatMap((group) => [
        [`fieldsets.service_package.groups.${group.code}.title`, group.title],
        [`fieldsets.service_package.groups.${group.code}.hint`, group.hint],
      ]),
      ...fields.flatMap((field) => [
        [`fields.${field.key}.label`, field.label],
        [`fields.${field.key}.description`, field.description],
        [`fields.${field.key}.group.title`, field.group?.title],
        [`fields.${field.key}.group.hint`, field.group?.hint],
      ]),
    ]
    const dictionary: Record<string, string> = polishCheckout
    const defaults: Record<string, string> = englishCheckout
    expect(fields.map((field) => field.key)).toEqual([
      'service_deliverables', 'delivery_timeline', 'session_format', 'support_contact',
    ])
    for (const [path, text] of entries) {
      if (typeof text !== 'string') continue
      const key = `checkout.customFields.${path}`
      expect(defaults[key]).toBe(text)
      expect(dictionary[key]).toEqual(expect.any(String))
      expect(dictionary[key]).not.toBe(text)
      expect(dictionary).not.toHaveProperty(text)
    }
  })
})
