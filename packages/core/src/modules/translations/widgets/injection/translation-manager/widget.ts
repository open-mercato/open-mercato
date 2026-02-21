import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TranslationWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'translations.injection.translation-manager',
    title: 'Translation Manager',
    description: 'Manage translations for the current record',
    features: ['translations.view'],
    priority: 40,
    enabled: true,
  },
  Widget: TranslationWidget,
}

export default widget
