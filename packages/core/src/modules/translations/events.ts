import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'translations.translation.updated', label: 'Translation Updated', entity: 'translation', category: 'crud' },
  { id: 'translations.translation.deleted', label: 'Translation Deleted', entity: 'translation', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'translations',
  events,
})

export const emitTranslationsEvent = eventsConfig.emit

export type TranslationsEventId = (typeof events)[number]['id']

export default eventsConfig
