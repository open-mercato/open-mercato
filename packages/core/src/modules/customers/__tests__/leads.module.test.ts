import { features as aclFeatures } from '../acl'
import { eventsConfig } from '../events'
import entities from '../ce'
import { defaultEncryptionMaps as DEFAULT_ENCRYPTION_MAPS } from '../encryption'

describe('customers leads module configuration', () => {
  describe('ACL features', () => {
    it('declares customers.leads.view', () => {
      expect(aclFeatures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'customers.leads.view',
            title: 'View leads',
            module: 'customers',
          }),
        ]),
      )
    })

    it('declares customers.leads.manage', () => {
      expect(aclFeatures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'customers.leads.manage',
            title: 'Manage leads',
            module: 'customers',
          }),
        ]),
      )
    })
  })

  describe('events', () => {
    const eventIds = eventsConfig.events.map((def) => def.id)

    it('declares customers.lead.created', () => {
      expect(eventIds).toContain('customers.lead.created')
    })

    it('declares customers.lead.updated', () => {
      expect(eventIds).toContain('customers.lead.updated')
    })

    it('declares customers.lead.status_changed', () => {
      expect(eventIds).toContain('customers.lead.status_changed')
    })

    it('declares customers.lead.converted', () => {
      expect(eventIds).toContain('customers.lead.converted')
    })

    it('declares customers.lead.deleted', () => {
      expect(eventIds).toContain('customers.lead.deleted')
    })
  })

  describe('custom entity registration', () => {
    it('registers customers:customer_lead with labelField title', () => {
      const leadEntity = entities.find((entity) => entity.id === 'customers:customer_lead')
      expect(leadEntity).toBeDefined()
      expect(leadEntity?.label).toBe('Customer Lead')
      expect(leadEntity?.labelField).toBe('title')
      expect(leadEntity?.showInSidebar).toBe(false)
    })
  })

  describe('encryption map', () => {
    it('registers customers:customer_lead with PII fields', () => {
      const leadMap = DEFAULT_ENCRYPTION_MAPS.find((entry) => entry.entityId === 'customers:customer_lead')
      expect(leadMap).toBeDefined()
      const fieldNames = leadMap!.fields.map((field) => field.field)
      expect(fieldNames).toEqual(
        expect.arrayContaining([
          'title',
          'description',
          'source',
          'company_name',
          'company_vat_id',
          'contact_first_name',
          'contact_last_name',
          'contact_phone',
          'contact_email',
        ]),
      )
    })
  })
})