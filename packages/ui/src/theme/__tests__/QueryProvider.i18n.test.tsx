/**
 * @jest-environment jsdom
 */
jest.mock('../../backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '../../backend/FlashMessages'
import { redirectToSessionRefresh } from '../../backend/utils/api'
import { QueryProvider } from '../QueryProvider'

describe('QueryProvider auth notice translator (GH #7381)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.history.pushState({}, '', '/backend/customers/people')
    window.sessionStorage.clear()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('shows the session-expired banner in the active locale', () => {
    const view = render(
      <I18nProvider locale="pl" dict={{ 'ui.auth.sessionExpired': 'Sesja wygasła. Przekierowanie do logowania…' }}>
        <QueryProvider>
          <div />
        </QueryProvider>
      </I18nProvider>,
    )

    redirectToSessionRefresh()
    view.unmount()

    expect(flash).toHaveBeenCalledWith('Sesja wygasła. Przekierowanie do logowania…', 'warning')
  })
})
