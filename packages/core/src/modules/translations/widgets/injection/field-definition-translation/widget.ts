import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { FieldDefinitionTranslationAction, type FieldDefinitionContext } from '../../../components/TranslationActions'

const widget: InjectionWidgetModule<FieldDefinitionContext> = {
  metadata: {
    id: 'translations.injection.field-definition-translation',
    title: 'Field definition translation',
    features: ['translations.manage'],
    requiredModules: ['entities'],
    priority: 40,
    enabled: true,
  },
  Widget: FieldDefinitionTranslationAction,
}

export default widget
