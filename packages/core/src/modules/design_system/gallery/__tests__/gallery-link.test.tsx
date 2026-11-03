/** @jest-environment jsdom */
import { navigateGallery } from '../components/GalleryLink'

afterEach(() => jest.restoreAllMocks())

it('updates gallery query state locally, with a separate history entry', () => {
  window.history.replaceState(null, '', '/backend/design-system?view=style-agents')
  const push = jest.spyOn(window.history, 'pushState')
  expect(navigateGallery('/backend/design-system?family=dates')).toBe(true)
  expect(push).toHaveBeenCalledTimes(1)
  expect(window.location.search).toBe('?family=dates')
  expect(navigateGallery('/backend/design-system?family=dates')).toBe(true)
  expect(push).toHaveBeenCalledTimes(1)
})

it('leaves external links, different pages and initial entry to the router', () => {
  window.history.replaceState(null, '', '/backend/design-system')
  const push = jest.spyOn(window.history, 'pushState')
  expect(navigateGallery('/backend/settings')).toBe(false)
  expect(navigateGallery('https://example.com/backend/design-system')).toBe(false)
  window.history.replaceState(null, '', '/backend/settings')
  expect(navigateGallery('/backend/design-system')).toBe(false)
  expect(push).not.toHaveBeenCalled()
})
