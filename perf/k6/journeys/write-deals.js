import { get, request } from '../lib/http.js'
import { linkedEntityOf } from '../lib/bundles.js'
import { dealWriteTarget, firstPipeline, pipelineById, rememberCreated, sampleOwner, samplePipeline, scopeIds, writeTarget } from '../lib/catalog.js'
import { vuRng } from '../lib/random.js'
import { pickOne, randomInt } from '../lib/pure/prng.js'
import { nextStageId } from '../lib/pure/misc.js'
import { think } from '../lib/think.js'
import { OPTIMISTIC_LOCK_HEADER } from './write-people.js'

const CURRENCIES = ['USD', 'EUR', 'PLN']

function dealDetailFor(dealId, name) {
  const result = request(get(`/api/customers/deals/${dealId}`, { include: 'stages', view: 'lite' }, name, 'deal.id'))
  return result.ok ? result.json() : null
}

function stagesOf(detail) {
  const deal = detail && detail.deal
  const fromCatalog = deal ? pipelineById(deal.pipelineId) : null
  if (fromCatalog && fromCatalog.stages.length) return fromCatalog.stages
  return Array.isArray(detail && detail.stages) ? detail.stages : []
}

export function moveDealStageJourney() {
  const target = dealWriteTarget()
  if (!target) return
  const detail = dealDetailFor(target.id, 'write.deal.stage:detail')
  if (!detail || !detail.deal) return
  const pipelineStageId = nextStageId(stagesOf(detail), detail.deal.pipelineStageId)
  if (!pipelineStageId) return
  think()
  request({
    method: 'PUT',
    path: '/api/customers/deals',
    body: { ...scopeIds(), id: detail.deal.id, pipelineStageId },
    headers: { [OPTIMISTIC_LOCK_HEADER]: detail.deal.updatedAt },
    name: 'write.deal.stage:update',
    expect: 'ok',
    conflict: true,
  })
}

export function createDealJourney() {
  const pipeline = samplePipeline() || firstPipeline()
  const person = writeTarget('people')
  const stages = pipeline ? pipeline.stages.slice().sort((left, right) => left.order - right.order) : []
  const rng = vuRng()
  const owner = sampleOwner()
  const created = request({
    method: 'POST',
    path: '/api/customers/deals',
    body: {
      ...scopeIds(),
      title: `Perf deal ${randomInt(rng, 1000, 999999)}`,
      pipelineId: pipeline ? pipeline.id : undefined,
      pipelineStageId: stages[0] ? stages[0].id : undefined,
      valueAmount: randomInt(rng, 500, 250000),
      valueCurrency: pickOne(rng, CURRENCIES),
      probability: randomInt(rng, 5, 90),
      ownerUserId: owner || undefined,
      personIds: person ? [person.id] : undefined,
    },
    name: 'write.deal.create:create',
    expect: 'id',
  })
  const body = created.ok ? created.json() : null
  if (body && body.id) rememberCreated('deals', body.id)
}

export function commentDealJourney() {
  const target = dealWriteTarget()
  if (!target) return
  const detail = dealDetailFor(target.id, 'write.deal.comment:detail')
  if (!detail || !detail.deal) return
  const fallback = writeTarget('people')
  const entityId = linkedEntityOf(detail) || (fallback && fallback.id)
  if (!entityId) return
  request({
    method: 'POST',
    path: '/api/customers/comments',
    body: { ...scopeIds(), entityId, dealId: detail.deal.id, body: `perf comment ${randomInt(vuRng(), 1, 1e9)}` },
    name: 'write.deal.comment:create',
    expect: 'id',
  })
}
