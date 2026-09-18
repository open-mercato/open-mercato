"use client"
/**
 * Live host page for the component-replacement handle this module exposes.
 *
 * It exists so the `replace` and `props` entries in `widgets/components.ts` have a real
 * call site instead of being declarations nothing renders. The page is `navHidden`: it
 * is a reference surface, not a product screen.
 */
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ComponentOverrideShowcase } from '../../components/ComponentOverrideShowcase'

const DEMO_RECORD_COUNT = 3

export default function ExampleComponentOverridesPage() {
  const t = useT()

  return (
    <Page>
      <PageHeader
        title={t('example.componentOverrides.page.title', 'Component overrides')}
        description={t('example.componentOverrides.page.description', 'The section below is resolved through the component-override registry. Remove the entries in widgets/components.ts to see the host implementation instead.')}
      />
      <PageBody>
        <ComponentOverrideShowcase recordCount={DEMO_RECORD_COUNT} />
      </PageBody>
    </Page>
  )
}
