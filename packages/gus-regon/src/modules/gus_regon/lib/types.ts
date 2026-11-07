/**
 * Shared, client-safe types for the GUS REGON lookup, derived from the zod
 * schemas that also document the lookup API.
 */
import type { z } from 'zod'
import type { gusCompanySchema, lookupFailSchema, lookupResponseSchema } from '../data/validators'

export type GusCompany = z.infer<typeof gusCompanySchema>

export type GusLookupFailureReason = z.infer<typeof lookupFailSchema>['reason']

export type GusLookupResult = z.infer<typeof lookupResponseSchema>

export type GusEnvironment = 'test' | 'production'
