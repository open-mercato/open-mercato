import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CatalogSeoReportWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.catalog-seo-report',
    title: 'Catalog SEO Report',
    description: 'Flags products that need SEO updates directly in the list view.',
    priority: 10,
    enabled: true,
  },
  Widget: CatalogSeoReportWidget,
}

export default widget
