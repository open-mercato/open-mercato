import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import { env, workload } from './config.js'
import { idOf, idsOf, partitionSlice, pickWriteTarget, sampleEntity } from './pure/sampling.js'
import { pickOne } from './pure/prng.js'
import { vuRng } from './random.js'

function readCatalog() {
  return JSON.parse(open(env.catalogPath))
}

function sharedIds(name, select) {
  return new SharedArray(`catalog:${name}`, () => idsOf(select(readCatalog())))
}

function sharedObjects(name, select) {
  return new SharedArray(`catalog:${name}`, () => {
    const value = select(readCatalog())
    return Array.isArray(value) ? value : []
  })
}

function bucketList(kind, bucket) {
  return (catalog) => ((catalog[kind] || {})[bucket]) || []
}

const pools = {
  people: {
    lightMedium: sharedIds('people.lightMedium', (catalog) => bucketList('people', 'light')(catalog).concat(bucketList('people', 'medium')(catalog))),
    heavy: sharedIds('people.heavy', bucketList('people', 'heavy')),
    extreme: sharedIds('people.extreme', bucketList('people', 'extreme')),
  },
  companies: {
    lightMedium: sharedIds('companies.lightMedium', (catalog) => bucketList('companies', 'light')(catalog).concat(bucketList('companies', 'medium')(catalog))),
    heavy: sharedIds('companies.heavy', bucketList('companies', 'heavy')),
    extreme: sharedIds('companies.extreme', bucketList('companies', 'extreme')),
  },
}

const hotSet = {
  people: sharedIds('hotSet.people', (catalog) => (catalog.hotSet || {}).people || []),
  companies: sharedIds('hotSet.companies', (catalog) => (catalog.hotSet || {}).companies || []),
}

const deals = sharedIds('deals.sample', (catalog) => (catalog.deals || {}).sample || [])
const owners = sharedIds('owners', (catalog) => catalog.owners || [])
const heavyOwners = sharedIds('heavyOwners', (catalog) => catalog.heavyOwners || [])
const tags = sharedIds('tags', (catalog) => catalog.tags || [])
const emailPrefixes = sharedObjects('emailPrefixes', (catalog) => (catalog.emailPrefixes || []).map(String))

const searchTerms = {
  unique: sharedObjects('search.unique', (catalog) => (catalog.searchTerms || {}).unique || []),
  common: sharedObjects('search.common', (catalog) => (catalog.searchTerms || {}).common || []),
  prefix: sharedObjects('search.prefix', (catalog) => (catalog.searchTerms || {}).prefix || []),
  noHit: sharedObjects('search.noHit', (catalog) => (catalog.searchTerms || {}).noHit || []),
}

const metaArray = new SharedArray('catalog:meta', () => {
  const catalog = readCatalog()
  return [{
    tier: catalog.tier,
    tenantId: catalog.tenantId,
    organizationId: catalog.organizationId,
    anchor: catalog.anchor,
    pipelines: (catalog.pipelines || []).map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: (pipeline.stages || []).map((stage) => ({ id: stage.id, name: stage.name, order: stage.order })),
    })),
    dictionaries: catalog.dictionaries || {},
  }]
})

let cachedMeta = null
const vuState = { writePartitions: {}, created: { people: [], companies: [], deals: [] } }

export function meta() {
  if (!cachedMeta) cachedMeta = metaArray[0]
  return cachedMeta
}

export function scopeIds() {
  const current = meta()
  return { tenantId: current.tenantId, organizationId: current.organizationId }
}

export function samplePerson() {
  return sampleFor('people')
}

export function sampleCompany() {
  return sampleFor('companies')
}

function sampleFor(kind) {
  const rng = vuRng()
  const recent = vuState.created[kind]
  if (recent.length > 0 && rng() < Number(workload.sampling.recentShare ?? 0)) {
    return { bucket: 'recent', id: pickOne(rng, recent) }
  }
  return sampleEntity(rng, pools[kind], workload.sampling.buckets)
}

function writePartition(kind) {
  if (!vuState.writePartitions[kind]) {
    const partitionCount = Math.max(1, usersCount())
    const index = exec.vu.idInTest - 1
    vuState.writePartitions[kind] = partitionSlice(pools[kind].lightMedium, index, partitionCount)
  }
  return vuState.writePartitions[kind]
}

let usersCountValue = 0
export function setUsersCount(count) {
  usersCountValue = count
}

function usersCount() {
  return usersCountValue
}

export function writeTarget(kind) {
  return pickWriteTarget(vuRng(), {
    partition: writePartition(kind),
    hotSet: hotSet[kind],
    hotShare: Number(workload.sampling.hotSetWriteShare ?? 0.1),
  })
}

export function rememberCreated(kind, id) {
  if (!id) return
  const list = vuState.created[kind]
  list.push(id)
  if (list.length > 50) list.shift()
}

export function sampleDeal() {
  const rng = vuRng()
  const recent = vuState.created.deals
  if (recent.length > 0 && rng() < Number(workload.sampling.recentShare ?? 0)) return pickOne(rng, recent)
  return pickOne(rng, deals)
}

export function dealSample(size) {
  const result = []
  const rng = vuRng()
  const start = Math.floor(rng() * Math.max(1, deals.length))
  for (let offset = 0; offset < Math.min(size, deals.length); offset += 1) {
    result.push(deals[(start + offset) % deals.length])
  }
  return result
}

let dealWritePartition = null
let hotDeals = null

export function dealWriteTarget() {
  if (!dealWritePartition) {
    dealWritePartition = partitionSlice(deals, exec.vu.idInTest - 1, Math.max(1, usersCount()))
    hotDeals = []
    for (let index = 0; index < Math.min(50, deals.length); index += 1) hotDeals.push(deals[index])
  }
  return pickWriteTarget(vuRng(), {
    partition: dealWritePartition,
    hotSet: hotDeals,
    hotShare: Number(workload.sampling.hotSetWriteShare ?? 0.1),
  })
}

export function sampleOwner() {
  return pickOne(vuRng(), owners)
}

export function sampleHeavyOwner() {
  return pickOne(vuRng(), heavyOwners.length ? heavyOwners : owners)
}

export function sampleTag() {
  return pickOne(vuRng(), tags)
}

export function sampleSearchTerm(kind) {
  const entry = pickOne(vuRng(), searchTerms[kind])
  if (!entry) return undefined
  if (typeof entry === 'string') return { term: entry, expected: undefined }
  return { term: String(entry.term ?? ''), expected: entry.expected }
}

export function sampleEmailPrefix() {
  return pickOne(vuRng(), emailPrefixes)
}

export function samplePipeline() {
  return pickOne(vuRng(), meta().pipelines)
}

export function firstPipeline() {
  return meta().pipelines[0]
}

export function pipelineById(pipelineId) {
  return meta().pipelines.find((pipeline) => pipeline.id === pipelineId)
}

export function sampleDictionaryValue(kind) {
  const values = meta().dictionaries[kind] || []
  const entry = pickOne(vuRng(), values)
  return entry && typeof entry === 'object' ? entry.value ?? idOf(entry) : entry
}

export function catalogSizes() {
  return {
    people: pools.people.lightMedium.length + pools.people.heavy.length + pools.people.extreme.length,
    companies: pools.companies.lightMedium.length + pools.companies.heavy.length + pools.companies.extreme.length,
    deals: deals.length,
    owners: owners.length,
    tags: tags.length,
  }
}
