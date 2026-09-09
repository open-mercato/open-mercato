import {
  crudFormExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

const detailHost = (spotId: string, source: string) => injectionExtensionHost({
  family: 'detail',
  spotId,
  supported: ['render-widget'],
  contextContract: 'customers.detail.v1',
  source,
})

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'customers',
  hosts: {
    companiesTable: dataTableExtensionHost({ tableId: 'customers.companies.list', source: 'backend/customers/companies/page.tsx' }),
    dealsTable: dataTableExtensionHost({ tableId: 'customers.deals.list', source: 'backend/customers/deals/page.tsx' }),
    peopleTable: dataTableExtensionHost({ tableId: 'customers.people.list', source: 'backend/customers/people/page.tsx' }),
    todosTable: dataTableExtensionHost({ tableId: 'customers.todos.list', source: 'components/CustomerTodosTable.tsx' }),
    companyForm: crudFormExtensionHost({ entityId: 'customers.company', spotId: 'crud-form:customers.company', source: 'backend/customers/companies-v2/[id]/page.tsx' }),
    dealForm: crudFormExtensionHost({ entityId: 'customers.deal', spotId: 'crud-form:customers.deal', source: 'backend/customers/deals/[id]/page.tsx' }),
    personForm: crudFormExtensionHost({ entityId: 'customers.person', spotId: 'crud-form:customers.person', source: 'backend/customers/people-v2/[id]/page.tsx' }),
    companyHeader: detailHost('detail:customers.company:header', 'backend/customers/companies-v2/[id]/page.tsx'),
    companyStatusBadges: detailHost('detail:customers.company:status-badges', 'backend/customers/companies-v2/[id]/page.tsx'),
    companyFooter: detailHost('detail:customers.company:footer', 'backend/customers/companies-v2/[id]/page.tsx'),
    companyLegacyDetails: detailHost('customers.company.detail:details', 'backend/customers/companies/[id]/page.tsx'),
    dealHeader: detailHost('detail:customers.deal:header', 'backend/customers/deals/[id]/page.tsx'),
    dealStatusBadges: detailHost('detail:customers.deal:status-badges', 'backend/customers/deals/[id]/page.tsx'),
    dealFooter: detailHost('detail:customers.deal:footer', 'backend/customers/deals/[id]/page.tsx'),
    personHeader: detailHost('detail:customers.person:header', 'backend/customers/people-v2/[id]/page.tsx'),
    personStatusBadges: detailHost('detail:customers.person:status-badges', 'backend/customers/people-v2/[id]/page.tsx'),
    personFooter: detailHost('detail:customers.person:footer', 'backend/customers/people-v2/[id]/page.tsx'),
    personLegacyDetails: detailHost('customers.person.detail:details', 'backend/customers/people/[id]/page.tsx'),
  },
})

export default extensionPoints
