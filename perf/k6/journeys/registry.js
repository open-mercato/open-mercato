import { company360Journey, companiesListJourney, peopleListJourney, person360Journey } from './read-people.js'
import { dealsListJourney, dealsPipelineJourney } from './read-deals.js'
import { dashboardJourney, searchGlobalJourney, searchListJourney } from './read-misc.js'
import { assignTagJourney, completeTaskJourney, createPersonJourney, editPersonJourney, logInteractionJourney } from './write-people.js'
import { commentDealJourney, createDealJourney, moveDealStageJourney } from './write-deals.js'
import { bulkOwnerJourney, calendarMonthJourney, dealsMapJourney, dealsSummaryJourney, encryptedSortJourney } from './heavy-ops.js'
import { setJourneyContext } from '../lib/context.js'
import { ensureSession } from '../lib/auth.js'
import { journeyDuration, journeyRuns } from '../lib/metrics.js'
import { thinkTally } from '../lib/think.js'

export const JOURNEYS = {
  'people.list': { group: 'read', run: peopleListJourney },
  'person.360': { group: 'read', run: person360Journey },
  'companies.list': { group: 'read', run: companiesListJourney },
  'company.360': { group: 'read', run: company360Journey },
  'deals.pipeline': { group: 'read', run: dealsPipelineJourney },
  'deals.list': { group: 'read', run: dealsListJourney },
  dashboard: { group: 'read', run: dashboardJourney },
  'search.list': { group: 'read', run: searchListJourney },
  'search.global': { group: 'read', run: searchGlobalJourney },
  'write.interaction': { group: 'write', run: logInteractionJourney },
  'write.person.edit': { group: 'write', run: editPersonJourney },
  'write.deal.stage': { group: 'write', run: moveDealStageJourney },
  'write.person.create': { group: 'write', run: createPersonJourney },
  'write.deal.create': { group: 'write', run: createDealJourney },
  'write.task.complete': { group: 'write', run: completeTaskJourney },
  'write.deal.comment': { group: 'write', run: commentDealJourney },
  'write.tag.assign': { group: 'write', run: assignTagJourney },
  'heavy.deals.summary': { group: 'heavy', run: dealsSummaryJourney },
  'heavy.encrypted.sort': { group: 'heavy', run: encryptedSortJourney },
  'heavy.calendar.month': { group: 'heavy', run: calendarMonthJourney },
  'heavy.deals.map': { group: 'heavy', run: dealsMapJourney },
  'heavy.bulk.owner': { group: 'heavy', run: bulkOwnerJourney },
}

export const JOURNEY_NAMES = Object.keys(JOURNEYS)

export function runJourney(name, args) {
  const journey = JOURNEYS[name]
  if (!journey) throw new Error(`[internal] unknown journey ${name}`)
  setJourneyContext(journey.group, name)
  ensureSession()
  const startedAt = Date.now()
  const thinkBefore = thinkTally()
  try {
    return journey.run(args)
  } finally {
    const activeMs = Date.now() - startedAt - (thinkTally() - thinkBefore)
    const tags = { journey: name, group: journey.group }
    journeyDuration.add(Math.max(0, activeMs), tags)
    journeyRuns.add(1, tags)
  }
}
