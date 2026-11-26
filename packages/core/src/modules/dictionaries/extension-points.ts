import { defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'dictionaries',
  hosts: {
    entryActions: injectionExtensionHost({
      family: 'generic',
      spotId: 'dictionaries:entry:actions',
      supported: ['render-widget'],
      source: 'components/DictionaryEntriesEditor.tsx',
      contextContract: '{ dictionaryId: string, entry: DictionaryEntryRecord }',
    }),
  },
})

export default extensionPoints
