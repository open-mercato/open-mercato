/**
 * Events Module
 *
 * Provides type-safe event declaration and emission for modules.
 *
 * @example
 * ```typescript
 * // In your module's events.ts:
 * import { createModuleEvents } from '@open-mercato/shared/modules/events'
 *
 * const events = [
 *   { id: 'mymodule.entity.created', label: 'Entity Created', category: 'crud' },
 * ] as const
 *
 * export const eventsConfig = createModuleEvents({
 *   moduleId: 'mymodule',
 *   events,
 * })
 *
 * export const emitMyModuleEvent = eventsConfig.emit
 * export default eventsConfig
 * ```
 */

export * from './types'
export * from './factory'
