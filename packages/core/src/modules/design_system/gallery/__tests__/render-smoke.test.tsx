/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, cleanup } from '@testing-library/react'
import { entries as buttonEntries } from '../entries/buttons'

describe('design_system buttons family render smoke', () => {
  afterEach(cleanup)

  for (const entry of buttonEntries) {
    describe(entry.title, () => {
      for (const variant of entry.variants) {
        it(`renders variant "${variant.id}" without throwing`, () => {
          const { container } = render(<>{variant.render()}</>)
          expect(container.firstChild).not.toBeNull()
        })
      }
    })
  }
})
