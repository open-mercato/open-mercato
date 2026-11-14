import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import InpostConfigWidget from '../widgets/injection/inpost-config/widget.client'

function renderWidget(context: Record<string, unknown> | undefined): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" dict={{}}>
      <InpostConfigWidget context={context} />
    </I18nProvider>,
  )
}

describe('InpostConfigWidget', () => {
  it('links to the credentials tab of the integration detail page', () => {
    const markup = renderWidget({ integrationId: 'carrier_inpost' })

    expect(markup).toContain('href="/backend/integrations/carrier_inpost?tab=credentials"')
  })

  it('falls back to the integrations marketplace when the integration id is unknown', () => {
    const markup = renderWidget(undefined)

    expect(markup).toContain('href="/backend/integrations"')
  })
})
