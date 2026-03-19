import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

/**
 * Keep payment_gateways module decoupled from feature modules.
 * Module-specific bindings (for example sales.payment enrichment) should be
 * declared by those feature modules and consume payment_gateways as a dependency.
 */
export const enrichers: ResponseEnricher[] = []
