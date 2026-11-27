import { check } from 'k6'
import { dealDetail, dealsList, dealsPipeline } from '../lib/bundles.js'
import { firstPipeline, sampleDeal } from '../lib/catalog.js'
import { get, request } from '../lib/http.js'
import { think } from '../lib/think.js'
import { vuRng } from '../lib/random.js'
import { pickOne } from '../lib/pure/prng.js'
import { sortHonored } from '../lib/pure/misc.js'

export function dealsPipelineJourney() {
  const pipeline = dealsPipeline(firstPipeline())
  think()
  const fromLane = pickOne(vuRng(), pipeline.laneDeals || [])
  const dealId = (fromLane && fromLane.id) || sampleDeal()
  if (dealId) dealDetail(dealId)
}

export function dealsListJourney() {
  dealsList({ page: 1, pageSize: 20 })
  think()
  request(get('/api/customers/deals', { page: 2, pageSize: 20 }, 'deals.list:list', 'items'))
}

export function dealDetailJourney() {
  const dealId = sampleDeal()
  if (dealId) dealDetail(dealId)
}

function itemsFrom(result) {
  const body = result.ok ? result.json() : null
  return body && Array.isArray(body.items) ? body.items : []
}

function compareOrders(prefix, ascQuery, descQuery) {
  const ascending = request(get('/api/customers/deals', ascQuery, `${prefix}.asc`, 'items', { strict: false }))
  const descending = request(get('/api/customers/deals', descQuery, `${prefix}.desc`, 'items', { strict: false }))
  return sortHonored(itemsFrom(ascending), itemsFrom(descending), 'id')
}

export function dealsListSortProbe() {
  const uiParams = compareOrders('deals.list:sort',
    { page: 1, pageSize: 20, sort: 'title', order: 'asc' },
    { page: 1, pageSize: 20, sort: 'title', order: 'desc' })
  const routeParams = compareOrders('deals.list:sortField',
    { page: 1, pageSize: 20, sortField: 'title', sortDir: 'asc' },
    { page: 1, pageSize: 20, sortField: 'title', sortDir: 'desc' })
  check(null, {
    'deals.list sort honored': () => uiParams === true,
    'deals.list sortField honored': () => routeParams === true,
  }, { strict: '0', name: 'deals.list:sort.probe', group: 'read', journey: 'deals.list' })
  return { uiParams, routeParams }
}
