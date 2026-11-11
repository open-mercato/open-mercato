/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { getInjectionRegistryError, isInjectionRegistryReady } from '@open-mercato/shared/modules/widgets/injection-loader'
import { ClientBootstrapProvider } from '../ClientBootstrap'

jest.mock('@/.mercato/generated/translations-fields.generated', () => {
  throw new Error('TranslationChunkLoadError')
}, { virtual: true })
jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => logger }
  return { createLogger: () => logger }
})

describe('client injection registry prerequisite failure', () => {
  it('publishes a terminal error when translations reject before injection can register', async () => {
    render(<ClientBootstrapProvider profile="backend"><span>Base content</span></ClientBootstrapProvider>)

    await waitFor(() => expect(getInjectionRegistryError()).toBe('TranslationChunkLoadError'))
    expect(isInjectionRegistryReady()).toBe(false)
    expect(screen.getByText('Base content')).toBeInTheDocument()
  })
})
