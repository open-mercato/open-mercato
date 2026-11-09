// Request scenarios for the customers companies API. Each scenario returns the next request path;
// all randomness comes from the injected seeded `rand`, so a run is reproducible.
import { NOUNS, generateCompany } from './generator.mjs'

export const DEFAULT_SEED = 20261103

/**
 * @param {object} input
 * @param {() => number} input.rand        seeded PRNG
 * @param {object} input.sample            values read from the database for the measured scope
 * @param {string[]} input.sample.ids      company ids in scope
 * @param {string[]} input.sample.statuses
 * @param {string[]} input.sample.stages
 * @param {number} input.sample.inScope    number of companies in scope
 * @param {string[]} [input.emailPrefixes] e.g. "info@iron-"; derived from the generator because emails are encrypted at rest
 */
export function companyScenarios({ rand, sample, emailPrefixes = [] }) {
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const pageCount = Math.max(1, Math.floor(sample.inScope / 50))
  const statuses = sample.statuses?.length ? sample.statuses : ['active']
  const stages = sample.stages?.length ? sample.stages : ['customer']
  return {
    R1_list: () => `/api/customers/companies?page=${1 + Math.floor(rand() * Math.min(pageCount, 200))}&pageSize=50&sortField=name&sortDir=asc`,
    R2_filter: () => `/api/customers/companies?status=${encodeURIComponent(pick(statuses))}&lifecycleStage=${encodeURIComponent(pick(stages))}&pageSize=50&sortField=name&sortDir=asc`,
    R3_lookup: () => `/api/customers/companies?id=${pick(sample.ids)}&pageSize=1`,
    R4_picker: () => `/api/customers/companies?emailStartsWith=${encodeURIComponent(emailPrefixes.length ? pick(emailPrefixes) : 'hello@')}&pageSize=20`,
    R5_search: () => `/api/customers/companies?search=${encodeURIComponent(pick(NOUNS))}&pageSize=50&sortField=name&sortDir=asc`,
  }
}

export const SCENARIO_DESCRIPTIONS = {
  R1_list: 'list page, 50 rows sorted by name, random page',
  R2_filter: 'status + lifecycle stage filter, 50 rows',
  R3_lookup: 'one company by id (the detail-page lookup)',
  R4_picker: 'email prefix picker, 20 rows',
  R5_search: 'full-text search, 50 rows',
}

/** Email prefixes such as "info@iron-" for the first `count` generated records of a target. */
export function generatedEmailPrefixes(plan, tenantKey, orgKey, count = 500) {
  return Array.from({ length: count }, (_, i) => generateCompany(plan, tenantKey, orgKey, i).primaryEmail)
    .filter(Boolean)
    .map((email) => email.slice(0, email.indexOf('@') + 5))
}
