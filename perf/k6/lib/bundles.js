import { all, batch, get, request } from './http.js'
import { hasFeature } from './features.js'
import { vuRng } from './random.js'
import { pickDistinct } from './pure/prng.js'
import { daysAgoIso, monthWindow } from './pure/misc.js'

const DICTIONARY_KINDS = ['statuses', 'sources', 'lifecycle-stages']
const TERMINAL_INTERACTION_STATUSES = 'done,canceled,completed'
const ENTITY_IDS = {
  entity: 'customers:customer_entity',
  person: 'customers:customer_person_profile',
  company: 'customers:customer_company_profile',
  deal: 'customers:customer_deal',
}
const TAB_FEATURES = {
  files: 'attachments.view',
  changelog: 'audit_logs.view_self',
  customerGroups: 'customer_groups.memberships.view',
  warrantyClaims: 'warranty_claims.claim.view',
  customerAccounts: 'customer_accounts.view',
  eudr: 'eudr.submissions.view',
}
const CALENDAR_PAGE_LIMIT = 100
const CALENDAR_MAX_ITEMS = 500
const MAP_PAGE_SIZE = 100
const MAP_MAX_DEALS = 500

function itemsOf(result) {
  const body = result && result.ok ? result.json() : null
  return body && Array.isArray(body.items) ? body.items : []
}

function bodyOf(result) {
  return result && result.ok ? result.json() : null
}

export function shellSpecs() {
  return [
    get('/api/notifications', { pageSize: 50 }, 'shell:notifications', 'items', { group: 'shell' }),
    get('/api/notifications/unread-count', null, 'shell:notifications.unread', 'object', { group: 'shell' }),
    get('/api/messages/unread-count', null, 'shell:messages.unread', 'object', { group: 'shell' }),
    get('/api/progress/active', null, 'shell:progress.active', 'object', { group: 'shell' }),
    get('/api/directory/organization-switcher', null, 'shell:organization.switcher', 'object', { group: 'shell' }),
    { method: 'POST', path: '/api/auth/feature-check', body: { features: [] }, name: 'shell:feature.check', expect: 'object', group: 'shell' },
    get('/api/ai_assistant/ai/actions', { status: 'pending', pageSize: 1 }, 'shell:ai.actions', 'object', { group: 'shell' }),
  ]
}

export function pageView(specs) {
  return batch(shellSpecs().concat(specs))
}

function dictionarySpecs(prefix) {
  return DICTIONARY_KINDS.map((kind) => get(`/api/customers/dictionaries/${kind}`, { locale: 'en' }, `${prefix}:dictionary.${kind}`, 'items'))
}

function listQuery({ page = 1, pageSize = 20, search, sortField, sortDir, filters } = {}) {
  return { page, pageSize, sortField, sortDir, search, ...(filters || {}) }
}

export function peopleListSpec(options = {}, name = 'people.list:list') {
  return get('/api/customers/people', listQuery(options), name, 'items')
}

export function companiesListSpec(options = {}, name = 'companies.list:list') {
  return get('/api/customers/companies', listQuery(options), name, 'items')
}

function listPageSpecs(kind, options) {
  const isPeople = kind === 'people'
  const prefix = isPeople ? 'people.list' : 'companies.list'
  return [
    isPeople ? peopleListSpec(options) : companiesListSpec(options),
    get('/api/entities/definitions', { entityId: [ENTITY_IDS.entity, isPeople ? ENTITY_IDS.person : ENTITY_IDS.company] }, `${prefix}:definitions`, 'items'),
    ...dictionarySpecs(prefix),
    get('/api/staff/team-members/assignable', { page: 1, pageSize: 100 }, `${prefix}:assignable.staff`, 'items'),
    get(`/api/perspectives/customers.${kind}.list`, null, `${prefix}:perspectives`, 'object'),
  ]
}

export function peopleListPage(options = {}) {
  return pageView(listPageSpecs('people', options))
}

export function companiesListPage(options = {}) {
  return pageView(listPageSpecs('companies', options))
}

export function peopleListRefetch(options = {}) {
  return request(peopleListSpec(options))
}

export function companiesListRefetch(options = {}) {
  return request(companiesListSpec(options))
}

function plannedSpec(scope, name) {
  return get('/api/customers/interactions', {
    ...scope,
    excludeStatus: TERMINAL_INTERACTION_STATUSES,
    excludeInteractionType: 'task',
    limit: 100,
    sortField: 'scheduledAt',
    sortDir: 'asc',
  }, name, 'items')
}

function timelineQuery(entityId, extra = {}) {
  return { entityId, limit: 50, sortField: 'activityDate', sortDir: 'desc', excludeInteractionType: 'task', ...extra }
}

function timelineSpecs(prefix, entityId) {
  return [
    plannedSpec({ entityId }, `${prefix}:planned`),
    get('/api/customers/interactions', timelineQuery(entityId), `${prefix}:timeline`, 'items'),
    get('/api/customers/interactions/counts', { entityId }, `${prefix}:counts`, 'object'),
  ]
}

function followTimeline(prefix, entityId, firstPage) {
  const body = bodyOf(firstPage)
  if (!body || typeof body.nextCursor !== 'string' || !body.nextCursor) return null
  return request(get('/api/customers/interactions', timelineQuery(entityId, { cursor: body.nextCursor }), `${prefix}:timeline.page`, 'items'))
}

function changelogSpec(prefix, kind, entityId) {
  return get('/api/audit_logs/audit-logs/actions', {
    resourceKind: `customers.${kind}`,
    resourceId: entityId,
    includeRelated: 'true',
    limit: 50,
    offset: 0,
    sortField: 'createdAt',
    sortDir: 'desc',
    after: daysAgoIso(90),
  }, `${prefix}:tab.changelog`, 'items')
}

function personTabSpecs(personId) {
  const prefix = 'person.360'
  return {
    deals: get('/api/customers/deals', { page: 1, pageSize: 10, sortField: 'updatedAt', sortDir: 'desc', personEntityId: personId }, `${prefix}:tab.deals`, 'items'),
    companies: get(`/api/customers/people/${personId}/companies/enriched`, { page: 1, pageSize: 20, sort: 'name-asc' }, `${prefix}:tab.companies`, 'items'),
    addresses: get('/api/customers/addresses', { entityId: personId, pageSize: 100 }, `${prefix}:tab.addresses`, 'items'),
    tasks: get('/api/customers/interactions/tasks', { page: 1, pageSize: 20, entityId: personId }, `${prefix}:tab.tasks`, 'items'),
    files: get('/api/attachments', { entityId: ENTITY_IDS.entity, recordId: personId, page: 1, pageSize: 24 }, `${prefix}:tab.files`, 'items'),
    changelog: changelogSpec(prefix, 'person', personId),
    customerGroups: get('/api/customer_groups/customer-groups/memberships', { customerId: personId, pageSize: 100 }, `${prefix}:tab.customer_groups`, 'items'),
    warrantyClaims: get('/api/warranty_claims', { customerId: personId, page: 1, pageSize: 20, sortField: 'updatedAt', sortDir: 'desc' }, `${prefix}:tab.warranty_claims`, 'items'),
    customerAccounts: get('/api/customer_accounts/admin/users', { personEntityId: personId, pageSize: 1 }, `${prefix}:tab.customer_accounts`, 'items'),
  }
}

function companyTabSpecs(companyId) {
  const prefix = 'company.360'
  return {
    deals: get('/api/customers/deals', { page: 1, pageSize: 10, sortField: 'updatedAt', sortDir: 'desc', companyEntityId: companyId }, `${prefix}:tab.deals`, 'items'),
    addresses: get('/api/customers/addresses', { entityId: companyId, pageSize: 100 }, `${prefix}:tab.addresses`, 'items'),
    tasks: get('/api/customers/interactions/tasks', { page: 1, pageSize: 20, entityId: companyId }, `${prefix}:tab.tasks`, 'items'),
    files: get('/api/attachments', { entityId: ENTITY_IDS.entity, recordId: companyId, page: 1, pageSize: 24 }, `${prefix}:tab.files`, 'items'),
    changelog: changelogSpec(prefix, 'company', companyId),
    customerGroups: get('/api/customer_groups/customer-groups/memberships', { customerId: companyId, pageSize: 100 }, `${prefix}:tab.customer_groups`, 'items'),
    warrantyClaims: get('/api/warranty_claims', { customerId: companyId, page: 1, pageSize: 20, sortField: 'updatedAt', sortDir: 'desc' }, `${prefix}:tab.warranty_claims`, 'items'),
    customerAccounts: get('/api/customer_accounts/admin/users', { customerEntityId: companyId, pageSize: 50 }, `${prefix}:tab.customer_accounts`, 'items'),
    eudr: get('/api/eudr/suppliers/compliance', { supplierEntityId: companyId }, `${prefix}:tab.eudr`, 'object'),
  }
}

export function personTabNames() {
  return Object.keys(personTabSpecs('00000000-0000-0000-0000-000000000000'))
}

export function companyTabNames() {
  return Object.keys(companyTabSpecs('00000000-0000-0000-0000-000000000000'))
}

function pickTabs(specsByTab, count, forcedTabs) {
  const visible = Object.keys(specsByTab).filter((name) => hasFeature(TAB_FEATURES[name]))
  const names = forcedTabs && forcedTabs.length
    ? forcedTabs.filter((name) => visible.includes(name))
    : pickDistinct(vuRng(), visible, count)
  return names.map((name) => specsByTab[name]).filter(Boolean)
}

export function person360(personId, { tabCount = 2, tabs } = {}) {
  const prefix = 'person.360'
  const first = pageView([
    get(`/api/customers/people/${personId}`, null, `${prefix}:detail`, 'person.id'),
    ...dictionarySpecs(prefix),
    get(`/api/customers/people/${personId}/roles`, null, `${prefix}:roles`, 'object'),
    ...timelineSpecs(prefix, personId),
  ])
  followTimeline(prefix, personId, first[`${prefix}:timeline`])
  const lazy = batch(pickTabs(personTabSpecs(personId), tabCount, tabs))
  return { first, lazy, detail: bodyOf(first[`${prefix}:detail`]) }
}

export function company360(companyId, { tabCount = 2, tabs } = {}) {
  const prefix = 'company.360'
  const first = pageView([
    get(`/api/customers/companies/${companyId}`, null, `${prefix}:detail`, 'company.id'),
    ...dictionarySpecs(prefix),
    get(`/api/customers/companies/${companyId}/people`, { page: 1, pageSize: 20, sort: 'name-asc' }, `${prefix}:people`, 'items'),
    get(`/api/customers/companies/${companyId}/roles`, null, `${prefix}:roles`, 'object'),
    ...timelineSpecs(prefix, companyId),
  ])
  followTimeline(prefix, companyId, first[`${prefix}:timeline`])
  const lazy = batch(pickTabs(companyTabSpecs(companyId), tabCount, tabs))
  return { first, lazy, detail: bodyOf(first[`${prefix}:detail`]) }
}

export function dealsPipeline(fallbackPipeline) {
  const prefix = 'deals.pipeline'
  const first = pageView([
    get('/api/customers/pipelines', null, `${prefix}:pipelines`, 'items'),
    get('/api/customers/companies', { page: 1, pageSize: 100, sortField: 'display_name', sortDir: 'asc' }, `${prefix}:companies`, 'items'),
    get('/api/customers/dictionaries/currency', null, `${prefix}:dictionary.currency`, 'object'),
  ])
  const pipelines = itemsOf(first[`${prefix}:pipelines`])
  const pipelineId = (pipelines[0] && pipelines[0].id) || (fallbackPipeline && fallbackPipeline.id)
  if (!pipelineId) return { first, lanes: [], pipelineId: null }
  const second = batch([
    get('/api/customers/pipeline-stages', { pipelineId }, `${prefix}:stages`, 'items'),
    get('/api/customers/deals/aggregate', { pipelineId }, `${prefix}:aggregate`, 'object'),
  ])
  const apiStages = itemsOf(second[`${prefix}:stages`])
  const stages = apiStages.length ? apiStages : ((fallbackPipeline && fallbackPipeline.stages) || [])
  const lanes = batch(stages.map((stage) => get('/api/customers/deals', {
    page: 1,
    pageSize: 25,
    pipelineId,
    pipelineStageId: stage.id,
    sortField: 'updatedAt',
    sortDir: 'desc',
  }, `${prefix}:lane`, 'items')))
  const laneDeals = all(lanes, `${prefix}:lane`).flatMap(itemsOf)
  return { first, second, lanes, laneDeals, pipelineId, stages }
}

export function dealsListSpecs({ sort, order, page = 1, pageSize = 20, filters } = {}) {
  return [
    get('/api/customers/deals', { page, pageSize, sort, order, ...(filters || {}) }, 'deals.list:list', 'items'),
    get('/api/customers/deals/summary', { range: '6m' }, 'deals.list:summary', 'object'),
    get('/api/customers/pipelines', null, 'deals.list:pipelines', 'items'),
    get('/api/entities/definitions', { entityId: ENTITY_IDS.deal }, 'deals.list:definitions', 'items'),
    get('/api/perspectives/customers.deals.list', null, 'deals.list:perspectives', 'object'),
  ]
}

export function dealsList(options = {}) {
  return pageView(dealsListSpecs(options))
}

export function dealDetail(dealId, { withShell = true } = {}) {
  const prefix = 'deal.detail'
  const specs = [
    get(`/api/customers/deals/${dealId}`, { include: 'stages', view: 'lite' }, `${prefix}:detail`, 'deal.id'),
    plannedSpec({ dealId }, `${prefix}:planned`),
    get(`/api/customers/deals/${dealId}/people`, { page: 1, pageSize: 20, sort: 'name-asc' }, `${prefix}:people`, 'items'),
    get(`/api/customers/deals/${dealId}/companies`, { page: 1, pageSize: 20, sort: 'name-asc' }, `${prefix}:companies`, 'items'),
    get('/api/customers/comments', { dealId, page: 1, pageSize: 20 }, `${prefix}:comments`, 'items'),
  ]
  const first = withShell ? pageView(specs) : batch(specs)
  const detail = bodyOf(first[`${prefix}:detail`])
  const linkedEntityId = linkedEntityOf(detail)
  if (linkedEntityId) {
    request(get('/api/customers/interactions', timelineQuery(linkedEntityId, { dealId }), `${prefix}:interactions`, 'items'))
  }
  return { first, detail, linkedEntityId }
}

export function linkedEntityOf(detail) {
  if (!detail) return null
  const people = Array.isArray(detail.linkedPersonIds) ? detail.linkedPersonIds : (detail.people || []).map((entry) => entry.id)
  const companies = Array.isArray(detail.linkedCompanyIds) ? detail.linkedCompanyIds : (detail.companies || []).map((entry) => entry.id)
  return people[0] || companies[0] || null
}

export function dashboard() {
  return pageView([
    get('/api/dashboards/layout', null, 'dashboard:layout', 'object'),
    ...['new-customers', 'new-deals', 'customer-todos', 'next-interactions'].map((widget) => (
      get(`/api/customers/dashboard/widgets/${widget}`, { limit: 5 }, `dashboard:widget.${widget}`, 'object')
    )),
  ])
}

export function searchList(kind, term) {
  return request(peopleListSpec({ page: 1, pageSize: 20, search: term }, `search.list:${kind}`))
}

export function searchGlobal(term) {
  return request(get('/api/search/search/global', { q: term, limit: 10 }, 'search.global:query', 'results'))
}

export function calendarWindow(window = monthWindow(), name = 'calendar:page') {
  const pages = []
  let cursor
  let collected = 0
  do {
    const result = request(get('/api/customers/interactions', {
      from: window.from,
      to: window.to,
      limit: CALENDAR_PAGE_LIMIT,
      cursor,
    }, name, 'items'))
    pages.push(result)
    const body = bodyOf(result)
    collected += body && Array.isArray(body.items) ? body.items.length : 0
    cursor = body && typeof body.nextCursor === 'string' && body.nextCursor ? body.nextCursor : undefined
  } while (cursor && collected < CALENDAR_MAX_ITEMS)
  return pages
}

export function dealsMap(pipelineId) {
  const query = (page) => ({ page, pageSize: MAP_PAGE_SIZE, sortField: 'updatedAt', sortDir: 'desc', pipelineId })
  const first = request(get('/api/customers/deals/map', query(1), 'heavy.deals.map:page', 'items'))
  const body = bodyOf(first)
  const totalPages = body && typeof body.totalPages === 'number' ? body.totalPages : 1
  const lastPage = Math.min(totalPages, Math.ceil(MAP_MAX_DEALS / MAP_PAGE_SIZE))
  const rest = []
  for (let page = 2; page <= lastPage; page += 1) {
    rest.push(get('/api/customers/deals/map', query(page), 'heavy.deals.map:page', 'items'))
  }
  return { first, rest: batch(rest) }
}

export const entityIds = ENTITY_IDS
