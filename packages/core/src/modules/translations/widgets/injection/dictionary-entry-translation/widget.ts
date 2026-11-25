import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { DictionaryEntryTranslationAction, type DictionaryEntryContext } from '../../../components/TranslationActions'

const widget: InjectionWidgetModule<DictionaryEntryContext> = {
  metadata: {
    id: 'translations.injection.dictionary-entry-translation',
    title: 'Dictionary entry translation',
    features: ['translations.manage'],
    requiredModules: ['dictionaries'],
    priority: 40,
    enabled: true,
  },
  Widget: DictionaryEntryTranslationAction,
}

export default widget
