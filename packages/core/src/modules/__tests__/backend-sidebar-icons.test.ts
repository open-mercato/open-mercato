/** @jest-environment node */

import { metadata as attachmentsMetadata } from '../attachments/backend/storage/attachments/page.meta'
import { metadata as rulesLogsMetadata } from '../business_rules/backend/logs/page.meta'
import { metadata as rulesMetadata } from '../business_rules/backend/rules/page.meta'
import { metadata as ruleSetsMetadata } from '../business_rules/backend/sets/page.meta'
import { metadata as categoriesMetadata } from '../catalog/backend/catalog/categories/page.meta'
import { metadata as productsMetadata } from '../catalog/backend/catalog/products/page.meta'
import { metadata as communicationChannelsMetadata } from '../communication_channels/backend/communication_channels/channels/page.meta'
import { metadata as currenciesMetadata } from '../currencies/backend/currencies/page.meta'
import { metadata as exchangeRatesMetadata } from '../currencies/backend/exchange-rates/page.meta'
import { metadata as calendarMetadata } from '../customers/backend/calendar/page.meta'
import { metadata as companiesMetadata } from '../customers/backend/customers/companies/page.meta'
import { metadata as dealsMetadata } from '../customers/backend/customers/deals/page.meta'
import { metadata as peopleMetadata } from '../customers/backend/customers/people/page.meta'
import { metadata as customerTasksMetadata } from '../customers/backend/customer-tasks/page.meta'
import { metadata as inboxOpsMetadata } from '../inbox_ops/backend/inbox-ops/page.meta'
import { metadata as messagesMetadata } from '../messages/backend/page.meta'
import { metadata as resourceTypesMetadata } from '../resources/backend/resources/resource-types/page.meta'
import { metadata as resourcesMetadata } from '../resources/backend/resources/resources/page.meta'
import { metadata as salesChannelsMetadata } from '../sales/backend/sales/channels/page.meta'
import { metadata as createSalesDocumentMetadata } from '../sales/backend/sales/documents/create/page.meta'
import { metadata as ordersMetadata } from '../sales/backend/sales/orders/page.meta'
import { metadata as quotesMetadata } from '../sales/backend/sales/quotes/page.meta'
import { metadata as leaveRequestsMetadata } from '../staff/backend/staff/leave-requests/page.meta'
import { metadata as myAvailabilityMetadata } from '../staff/backend/staff/my-availability/page.meta'
import { metadata as myLeaveRequestsMetadata } from '../staff/backend/staff/my-leave-requests/page.meta'
import { metadata as teamMembersMetadata } from '../staff/backend/staff/team-members/page.meta'
import { metadata as teamRolesMetadata } from '../staff/backend/staff/team-roles/page.meta'
import { metadata as teamsMetadata } from '../staff/backend/staff/teams/page.meta'
import { metadata as timesheetsMetadata } from '../staff/backend/staff/timesheets/page.meta'
import { metadata as workflowDefinitionsMetadata } from '../workflows/backend/definitions/page.meta'
import { metadata as workflowEventsMetadata } from '../workflows/backend/events/page.meta'
import { metadata as workflowInstancesMetadata } from '../workflows/backend/instances/page.meta'
import { metadata as workflowTasksMetadata } from '../workflows/backend/tasks/page.meta'

const mainSidebarMetadata = [
  ['attachments', attachmentsMetadata],
  ['rules logs', rulesLogsMetadata],
  ['rules', rulesMetadata],
  ['rule sets', ruleSetsMetadata],
  ['categories', categoriesMetadata],
  ['products', productsMetadata],
  ['communication channels', communicationChannelsMetadata],
  ['currencies', currenciesMetadata],
  ['exchange rates', exchangeRatesMetadata],
  ['calendar', calendarMetadata],
  ['companies', companiesMetadata],
  ['deals', dealsMetadata],
  ['people', peopleMetadata],
  ['customer tasks', customerTasksMetadata],
  ['inbox ops', inboxOpsMetadata],
  ['messages', messagesMetadata],
  ['resource types', resourceTypesMetadata],
  ['resources', resourcesMetadata],
  ['sales channels', salesChannelsMetadata],
  ['create sales document', createSalesDocumentMetadata],
  ['orders', ordersMetadata],
  ['quotes', quotesMetadata],
  ['leave requests', leaveRequestsMetadata],
  ['my availability', myAvailabilityMetadata],
  ['my leave requests', myLeaveRequestsMetadata],
  ['team members', teamMembersMetadata],
  ['team roles', teamRolesMetadata],
  ['teams', teamsMetadata],
  ['timesheets', timesheetsMetadata],
  ['workflow definitions', workflowDefinitionsMetadata],
  ['workflow events', workflowEventsMetadata],
  ['workflow instances', workflowInstancesMetadata],
  ['workflow tasks', workflowTasksMetadata],
] as const

describe('backend sidebar icon metadata', () => {
  it('uses registry-safe string icon ids for visible core sidebar pages', () => {
    for (const [label, metadata] of mainSidebarMetadata) {
      expect(typeof metadata.icon).toBe('string')
      expect(`${label}:${metadata.icon ?? ''}`).not.toMatch(/:$/)
    }
  })
})
