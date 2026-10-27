/** @jest-environment jsdom */

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import ValidationWidget from '../injection/crud-validation/widget.client'

describe('ValidationWidget shared-state hydration', () => {
  it('observes a value written between initial render and subscription', async () => {
    const values = new Map<string, unknown>()
    const sharedState = {
      get: (key: string) => values.get(key),
      subscribe: (key: string) => {
        if (key === 'lastTransformDisplayData') {
          values.set(key, { title: 'TRANSFORMED' })
        }
        return () => {}
      },
    }

    render(<ValidationWidget context={{ sharedState }} data={{}} disabled={false} />)

    expect(await screen.findByTestId('widget-transform-display-data')).toHaveTextContent(
      'transformDisplayData={"title":"TRANSFORMED"}',
    )
  })
})
