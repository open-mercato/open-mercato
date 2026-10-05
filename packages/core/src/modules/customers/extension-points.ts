import {
  crudFormExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

const detailHost = (spotId: string, source: string, dataContract?: string) => injectionExtensionHost({
  family: 'detail',
  spotId,
  supported: ['render-widget'],
  contextContract: 'customers.detail.v1',
  dataContract,
  source,
})

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'customers',
  hosts: {
    companiesTable: dataTableExtensionHost({ tableId: 'customers.companies.list', source: 'backend/customers/companies/page.tsx' }),
    dealsTable: dataTableExtensionHost({ tableId: 'customers.deals.list', source: 'backend/customers/deals/page.tsx' }),
    peopleTable: dataTableExtensionHost({ tableId: 'customers.people.list', source: 'backend/customers/people/page.tsx' }),
    todosTable: dataTableExtensionHost({ tableId: 'customers.todos.list', source: 'components/CustomerTodosTable.tsx' }),
    companyForm: crudFormExtensionHost({ entityId: 'customers.company', spotId: 'crud-form:customers.company', source: ['backend/customers/companies-v2/[id]/page.tsx', 'backend/customers/companies/create/page.tsx'] }),
    dealForm: crudFormExtensionHost({ entityId: 'customers.deal', spotId: 'crud-form:customers.deal', source: ['backend/customers/deals/[id]/page.tsx', 'components/detail/create/CreateDealForm.tsx', 'backend/customers/deals/pipeline/components/QuickDealDialog.tsx'] }),
    personForm: crudFormExtensionHost({ entityId: 'customers.person', spotId: 'crud-form:customers.person', source: ['backend/customers/people-v2/[id]/page.tsx', 'backend/customers/people/create/page.tsx', 'components/detail/CreatePersonDialog.tsx'] }),
    companyHeaderActions: detailHost('detail:customers.company:header-actions', 'backend/customers/companies-v2/[id]/page.tsx', 'customers.detail.overview.v1'),
    companySidebar: detailHost('detail:customers.company:sidebar', 'backend/customers/companies-v2/[id]/page.tsx', 'customers.detail.overview.v1'),
    companyTabs: detailHost('detail:customers.company:tabs', 'backend/customers/companies-v2/[id]/page.tsx', 'customers.detail.overview.v1'),
    companyHeader: detailHost('detail:customers.company:header', 'backend/customers/companies-v2/[id]/page.tsx'),
    companyStatusBadges: detailHost('detail:customers.company:status-badges', 'backend/customers/companies-v2/[id]/page.tsx'),
    companyFooter: detailHost('detail:customers.company:footer', 'backend/customers/companies-v2/[id]/page.tsx'),
    companyLegacyDetails: detailHost('customers.company.detail:details', 'backend/customers/companies/[id]/page.tsx'),
    dealHeaderActions: detailHost('detail:customers.deal:header-actions', 'backend/customers/deals/[id]/page.tsx', 'customers.detail.overview.v1'),
    dealSidebar: detailHost('detail:customers.deal:sidebar', 'backend/customers/deals/[id]/page.tsx', 'customers.detail.overview.v1'),
    dealTabs: detailHost('detail:customers.deal:tabs', 'backend/customers/deals/[id]/hooks/useDealInjectedTabs.tsx', 'customers.detail.overview.v1'),
    dealHeader: detailHost('detail:customers.deal:header', 'backend/customers/deals/[id]/page.tsx'),
    dealStatusBadges: detailHost('detail:customers.deal:status-badges', 'backend/customers/deals/[id]/page.tsx'),
    dealFooter: detailHost('detail:customers.deal:footer', 'backend/customers/deals/[id]/page.tsx'),
    personHeaderActions: detailHost('detail:customers.person:header-actions', 'backend/customers/people-v2/[id]/page.tsx', 'customers.detail.overview.v1'),
    personSidebar: detailHost('detail:customers.person:sidebar', 'backend/customers/people-v2/[id]/page.tsx', 'customers.detail.overview.v1'),
    personTabs: detailHost('detail:customers.person:tabs', 'backend/customers/people-v2/[id]/page.tsx', 'customers.detail.overview.v1'),
    personHeader: detailHost('detail:customers.person:header', 'backend/customers/people-v2/[id]/page.tsx'),
    personStatusBadges: detailHost('detail:customers.person:status-badges', 'backend/customers/people-v2/[id]/page.tsx'),
    personFooter: detailHost('detail:customers.person:footer', 'backend/customers/people-v2/[id]/page.tsx'),
    personLegacyDetails: detailHost('customers.person.detail:details', 'backend/customers/people/[id]/page.tsx'),
  },
})

export default extensionPoints
