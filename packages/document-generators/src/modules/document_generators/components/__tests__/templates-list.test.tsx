import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { TemplatesList } from '../TemplatesList'

const mockUseDocumentTemplates = jest.fn()

jest.mock('../../hooks/templates/useDocumentTemplates', () => ({
  useDocumentTemplates: (...args: unknown[]) => mockUseDocumentTemplates(...args),
}))

describe('TemplatesList', () => {
  it('shows an explicit error when loading templates fails', () => {
    mockUseDocumentTemplates.mockReturnValue({
      data: undefined,
      error: new Error('request failed'),
      isLoading: false,
    })

    const markup = renderToStaticMarkup(
      <I18nProvider
        locale="en"
        dict={{ 'document_generators.page.error': 'Failed to load templates.' }}
      >
        <TemplatesList record={{}} />
      </I18nProvider>,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Failed to load templates.')
  })
})
