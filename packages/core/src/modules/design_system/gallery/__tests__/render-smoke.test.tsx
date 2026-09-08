/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, cleanup } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backend/design-system',
}))
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { galleryFamilies } from '../registry'
import type { GalleryEntry } from '../types'

// Every family's entries must mount under jsdom without throwing. Entries
// render inside the same I18nProvider the backend shell provides (some
// primitives call useT for their built-in labels).
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const families: Array<{ id: string; entries: GalleryEntry[] }> = []

beforeAll(async () => {
  ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock
  for (const family of galleryFamilies) {
    const { entries } = await family.load()
    families.push({ id: family.id, entries })
  }
})

afterEach(cleanup)

describe('design_system gallery render smoke', () => {
  it('loads every family from the manifest', () => {
    expect(families.length).toBe(galleryFamilies.length)
    for (const family of families) expect(family.entries.length).toBeGreaterThan(0)
  })

  it('renders every variant of every entry without throwing', () => {
    for (const family of families) {
      for (const entry of family.entries) {
        for (const variant of entry.variants) {
          const { container, unmount } = render(
            <I18nProvider locale="en" dict={{}}>
              {variant.render()}
            </I18nProvider>,
          )
          expect(container.firstChild).not.toBeNull()
          unmount()
        }
      }
    }
  })
})
