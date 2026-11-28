// Compile-time-only guard for the deprecated deal loss-reason exports of `sales/lib/dictionaries`
// (#8801). Never imported at runtime: `yarn typecheck` (`tsc --noEmit`) is the only gate that
// catches a regression here, because the Jest transform skips type diagnostics and
// `packages/core/tsconfig.json` excludes `__tests__`. Same convention as
// `packages/core/src/modules/staff/lib/time-tracking/settings.typecheck.tsx`.
//
// What it protects: `revivedDictionary` was added after `BackfillDealLossReasonDictionaryResult`
// was published. Downstream code building the five-field result through the old import path
// must keep compiling (BACKWARD_COMPATIBILITY.md, exported types: optional additions only).
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  backfillDealLossReasonDictionary,
  type BackfillDealLossReasonDictionaryResult,
} from './dictionaries'
import type { BackfillDealLossReasonDictionaryResult as CustomersBackfillDealLossReasonDictionaryResult } from '@open-mercato/core/modules/customers/lib/dealLossReasons'

const legacyResult: BackfillDealLossReasonDictionaryResult = {
  dictionaryId: 'dictionary-id',
  createdDictionary: false,
  copiedLegacyEntries: 0,
  seededDefaultEntries: 0,
  existingEntries: 0,
}

const currentResult: CustomersBackfillDealLossReasonDictionaryResult = legacyResult

const readRevived: boolean = currentResult.revivedDictionary ?? false

type LegacyBackfill = (
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
) => Promise<BackfillDealLossReasonDictionaryResult>

const legacyBackfill: LegacyBackfill = backfillDealLossReasonDictionary

void legacyResult
void currentResult
void readRevived
void legacyBackfill
