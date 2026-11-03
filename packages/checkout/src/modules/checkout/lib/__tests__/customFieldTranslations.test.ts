import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { createCheckoutCustomFieldTextResolver } from '../customFieldTranslations'
import { CHECKOUT_ENTITY_IDS } from '../constants'
import polishCheckout from '../../i18n/pl.json'

describe('checkout custom-field text resolver', () => {
  const context = { entityId: CHECKOUT_ENTITY_IDS.link, path: 'fields.support_contact.label' }

  it.each([CHECKOUT_ENTITY_IDS.link, CHECKOUT_ENTITY_IDS.template])('translates only opted-in seeded metadata on %s', (entityId) => {
    const resolveText = createCheckoutCustomFieldTextResolver(createTranslator(polishCheckout))
    expect(resolveText('Support contact', { ...context, entityId })).toBe('Kontakt w sprawie pomocy')
    expect(resolveText('Service package', { entityId, path: 'fieldsets.service_package.label' })).toBe('Pakiet usług')
    expect(resolveText('Before you pay', {
      entityId, path: 'fieldsets.service_package.groups.details.title',
    })).toBe('Przed płatnością')
  })

  it('preserves unrelated entities and tenant fields even when their text matches a dictionary key', () => {
    const translate = jest.fn(createTranslator({ ...polishCheckout, 'common.save': 'Zapisz', 'Support contact': 'Changed' }))
    const resolveText = createCheckoutCustomFieldTextResolver(translate)
    expect(resolveText('Support contact', { ...context, entityId: 'customers:customer_company_profile' })).toBe('Support contact')
    expect(resolveText('Support contact', { ...context, path: 'fields.tenant_note.label' })).toBe('Support contact')
    expect(resolveText('common.save', { ...context, path: 'fields.tenant_note.label' })).toBe('common.save')
    expect(resolveText('Service package', { ...context, path: 'fieldsets.tenant_fields.label' })).toBe('Service package')
    expect(translate).not.toHaveBeenCalled()
  })

  it('preserves customized seed copy and falls back to stored text for missing translations', () => {
    const translate = jest.fn(createTranslator({}))
    const resolveText = createCheckoutCustomFieldTextResolver(translate)
    expect(resolveText('Our support team', context)).toBe('Our support team')
    expect(translate).not.toHaveBeenCalled()
    expect(resolveText('Support contact', context)).toBe('Support contact')
    expect(translate).toHaveBeenCalledWith('checkout.customFields.fields.support_contact.label', 'Support contact')
    expect(resolveText('Our service bundle', { ...context, path: 'fieldsets.service_package.label' })).toBe('Our service bundle')
    expect(resolveText('Our next steps', { ...context, path: 'fields.delivery_timeline.group.title' })).toBe('Our next steps')
  })
})
