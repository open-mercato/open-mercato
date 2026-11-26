import { company360, companiesListPage, companiesListRefetch, peopleListPage, peopleListRefetch, person360 } from '../lib/bundles.js'
import { sampleCompany, sampleDictionaryValue, samplePerson } from '../lib/catalog.js'
import { think } from '../lib/think.js'
import { vuRng } from '../lib/random.js'
import { pickOne } from '../lib/pure/prng.js'

const LIST_FOLLOW_UPS = ['nextPage', 'statusFilter', 'sortCreated']

function followUpQuery(action) {
  if (action === 'nextPage') return { page: 2, pageSize: 20 }
  if (action === 'statusFilter') {
    const status = sampleDictionaryValue('statuses')
    return status ? { page: 1, pageSize: 20, filters: { status } } : { page: 2, pageSize: 20 }
  }
  return { page: 1, pageSize: 20, sortField: 'createdAt', sortDir: 'desc' }
}

export function peopleListJourney() {
  peopleListPage({ page: 1, pageSize: 20 })
  think()
  peopleListRefetch(followUpQuery(pickOne(vuRng(), LIST_FOLLOW_UPS)))
}

export function companiesListJourney() {
  companiesListPage({ page: 1, pageSize: 20 })
  think()
  companiesListRefetch(followUpQuery(pickOne(vuRng(), LIST_FOLLOW_UPS)))
}

export function person360Journey(options = {}) {
  const target = samplePerson()
  if (!target) return
  person360(target.id, options)
}

export function company360Journey(options = {}) {
  const target = sampleCompany()
  if (!target) return
  company360(target.id, options)
}
