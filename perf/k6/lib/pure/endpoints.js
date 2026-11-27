const DICTIONARIES = ['dictionary.statuses', 'dictionary.sources', 'dictionary.lifecycle-stages']
const TIMELINE = ['planned', 'timeline', 'timeline.page', 'counts']
const SHARED_TABS = ['tab.deals', 'tab.addresses', 'tab.tasks', 'tab.files', 'tab.changelog', 'tab.customer_groups', 'tab.warranty_claims', 'tab.customer_accounts']
const LIST_PAGE = ['list', 'definitions', ...DICTIONARIES, 'assignable.staff', 'perspectives']

export const ENDPOINTS_BY_BUNDLE = {
  shell: ['notifications', 'notifications.unread', 'messages.unread', 'progress.active', 'organization.switcher', 'feature.check', 'ai.actions'],
  login: ['login', 'refresh', 'features'],
  'people.list': LIST_PAGE,
  'companies.list': LIST_PAGE,
  'person.360': ['detail', ...DICTIONARIES, 'roles', ...TIMELINE, ...SHARED_TABS, 'tab.companies'],
  'company.360': ['detail', ...DICTIONARIES, 'people', 'roles', ...TIMELINE, ...SHARED_TABS, 'tab.eudr'],
  'deals.pipeline': ['pipelines', 'companies', 'dictionary.currency', 'stages', 'aggregate', 'lane'],
  'deals.list': ['list', 'summary', 'pipelines', 'definitions', 'perspectives', 'sort.asc', 'sort.desc', 'sortField.asc', 'sortField.desc'],
  'deal.detail': ['detail', 'planned', 'people', 'companies', 'comments', 'interactions'],
  dashboard: ['layout', 'widget.new-customers', 'widget.new-deals', 'widget.customer-todos', 'widget.next-interactions'],
  'search.list': ['unique', 'common', 'prefix', 'noHit'],
  'search.global': ['query'],
  'write.interaction': ['create', 'note', 'timeline'],
  'write.person.edit': ['detail', 'update'],
  'write.person.create': ['create', 'address'],
  'write.tag.assign': ['assign'],
  'write.task.complete': ['tasks', 'create', 'complete'],
  'write.deal.stage': ['detail', 'update'],
  'write.deal.create': ['create'],
  'write.deal.comment': ['detail', 'create'],
  'heavy.deals.summary': ['summary', 'needsAttention', 'stuck'],
  'heavy.encrypted.sort': ['people.name', 'people.primaryEmail', 'companies.name', 'deals.title'],
  'heavy.calendar.month': ['page'],
  'heavy.deals.map': ['page'],
  'heavy.bulk.owner': ['post.100', 'post.1000', 'poll'],
}

export function endpointNames() {
  const names = []
  for (const bundle of Object.keys(ENDPOINTS_BY_BUNDLE)) {
    for (const request of ENDPOINTS_BY_BUNDLE[bundle]) names.push(`${bundle}:${request}`)
  }
  return names
}

export const GROUPS = ['read', 'write', 'heavy', 'shell', 'auth']

export function referenceThresholds({ measuredOnly = true, endpoints = false, journeys = [] } = {}) {
  const suffix = measuredOnly ? ',measured:1' : ''
  const thresholds = {}
  thresholds[`http_req_duration{measured:1}`] = ['max>=0']
  thresholds[`http_req_failed{measured:1}`] = ['rate>=0']
  for (const group of GROUPS) {
    thresholds[`http_req_duration{group:${group}${suffix}}`] = ['max>=0']
    thresholds[`http_req_failed{group:${group}${suffix}}`] = ['rate>=0']
  }
  for (const journey of journeys) {
    thresholds[`om_journey_duration{journey:${journey}${suffix}}`] = ['max>=0']
  }
  if (endpoints) {
    for (const name of endpointNames()) thresholds[`http_req_duration{name:${name}${suffix}}`] = ['max>=0']
  }
  return thresholds
}

export function safetyThresholds({ maxErrorRate = 0.2, errorWindow = '2m', maxP95Ms = 30000 } = {}) {
  return {
    http_req_failed: [{ threshold: `rate<${maxErrorRate}`, abortOnFail: true, delayAbortEval: errorWindow }],
    http_req_duration: [{ threshold: `p(95)<${maxP95Ms}`, abortOnFail: true, delayAbortEval: errorWindow }],
  }
}
