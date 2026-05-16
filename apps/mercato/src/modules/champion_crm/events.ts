import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'champion_crm.lead.created', label: 'Champion Lead Created', entity: 'lead', category: 'crud' },
  { id: 'champion_crm.lead.updated', label: 'Champion Lead Updated', entity: 'lead', category: 'crud' },
  { id: 'champion_crm.lead.deleted', label: 'Champion Lead Deleted', entity: 'lead', category: 'crud' },
  { id: 'champion_crm.lead.received', label: 'Champion Lead Received', entity: 'lead', category: 'lifecycle' },
  { id: 'champion_crm.lead.matched_contact', label: 'Champion Lead Matched Contact', entity: 'lead', category: 'lifecycle' },
  { id: 'champion_crm.lead.manual_review_required', label: 'Champion Lead Manual Review Required', entity: 'lead', category: 'lifecycle' },
  { id: 'champion_crm.lead.qualified', label: 'Champion Lead Qualified', entity: 'lead', category: 'lifecycle' },
  { id: 'champion_crm.contact.created', label: 'Champion Contact Created', entity: 'contact', category: 'crud' },
  { id: 'champion_crm.deal.created', label: 'Champion Deal Created', entity: 'deal', category: 'crud' },
  { id: 'champion_crm.investment.created', label: 'Champion Investment Created', entity: 'investment', category: 'crud' },
  { id: 'champion_crm.apartment.reserved', label: 'Champion Apartment Reserved', entity: 'apartment', category: 'lifecycle' },
  { id: 'champion_crm.activity.created', label: 'Champion Activity Created', entity: 'activity', category: 'crud' },
  { id: 'champion_crm.consent.captured', label: 'Champion Consent Captured', entity: 'consent', category: 'lifecycle' },
  { id: 'champion_crm.audit.created', label: 'Champion Audit Event Created', entity: 'audit', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'champion_crm', events })
export const emitChampionCrmEvent = eventsConfig.emit
export type ChampionCrmEventId = typeof events[number]['id']
export default eventsConfig

