/**
 * Re-export shared entity-access helpers so existing imports keep working.
 * The canonical implementation lives in @open-mercato/shared to be reusable
 * from ai-assistant without introducing a search↔ai-assistant dependency cycle.
 */
export * from '@open-mercato/shared/lib/search/entityAccess'
