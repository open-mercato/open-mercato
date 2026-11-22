/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import ProfileTimeZonePage from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/backend/profile/time-zone',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  readApiResultOrThrow: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/crud'),
  updateCrud: jest.fn(),
}))

const router = { refresh: jest.fn() }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ timezone: 'Europe/Warsaw', updatedAt: null })
  jest.mocked(updateCrud).mockResolvedValue({ ok: true, result: { updatedAt: '2026-11-22T06:00:00Z' } } as Awaited<ReturnType<typeof updateCrud>>)
})

async function typeAndSave(text: string) {
  renderWithProviders(<ProfileTimeZonePage />)
  const picker = await screen.findByRole('combobox', { name: 'Time zone' })
  fireEvent.focus(picker)
  fireEvent.change(picker, { target: { value: text } })
  fireEvent.blur(picker)
  fireEvent.click(screen.getAllByRole('button', { name: 'Save time zone' })[0])
}

test('saves a supported time zone typed without selecting a suggestion', async () => {
  await typeAndSave(' asia/tokyo ')
  await waitFor(() => expect(updateCrud).toHaveBeenCalledWith(
    'auth/profile', { timezone: 'Asia/Tokyo' }, expect.anything(),
  ))
  expect(flash).toHaveBeenCalledWith('Time zone saved.', 'success')
})

test('asks for a valid selection before saving unmatched text', async () => {
  await typeAndSave('Asia/Tok')
  const picker = screen.getByRole('combobox', { name: 'Time zone' })
  await waitFor(() => expect(picker).toHaveAttribute('aria-invalid', 'true'))
  expect(picker).toHaveAccessibleDescription('Choose a time zone from the list.')
  expect(updateCrud).not.toHaveBeenCalled()
  expect(flash).not.toHaveBeenCalledWith('Time zone saved.', 'success')

  fireEvent.change(picker, { target: { value: 'Asia/Tokyo' } })
  fireEvent.click(await screen.findByRole('option', { name: 'Asia/Tokyo' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Save time zone' })[0])
  await waitFor(() => expect(updateCrud).toHaveBeenCalledWith(
    'auth/profile', { timezone: 'Asia/Tokyo' }, expect.anything(),
  ))
})

test('clears the personal time zone when the picker is cleared', async () => {
  renderWithProviders(<ProfileTimeZonePage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Clear value' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Save time zone' })[0])
  await waitFor(() => expect(updateCrud).toHaveBeenCalledWith(
    'auth/profile', { timezone: null }, expect.anything(),
  ))
})
