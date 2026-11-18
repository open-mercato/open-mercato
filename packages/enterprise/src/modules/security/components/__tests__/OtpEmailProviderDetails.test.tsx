/** @jest-environment jsdom */
import * as React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import OtpEmailProviderDetails from '../OtpEmailProviderDetails'

const mutate = jest.fn()
jest.mock('../hooks/useMfaMutation', () => ({ useMfaMutation: () => mutate }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

test('Email OTP UI waits for the emailed code before confirming enrollment', async () => {
  mutate.mockResolvedValueOnce({ setupId: 'pending', clientData: {} }).mockResolvedValueOnce({ ok: true })
  const onMethodsChanged = jest.fn()
  render(<I18nProvider locale="en" dict={{}}><OtpEmailProviderDetails onMethodsChanged={onMethodsChanged} /></I18nProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Enable email OTP' }))
  const codeInput = await screen.findByLabelText('security.login.mfaChallenge.otpEmail.codeLabel')
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(onMethodsChanged).not.toHaveBeenCalled()
  fireEvent.change(codeInput, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'security.profile.mfa.generic.confirm' }))
  await waitFor(() => expect(onMethodsChanged).toHaveBeenCalledTimes(1))
  expect(mutate).toHaveBeenLastCalledWith('/api/security/mfa/provider/otp_email', expect.objectContaining({
    method: 'PUT', body: JSON.stringify({ setupId: 'pending', payload: { code: '123456' } }),
  }))
})
