/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { TriggerEditor, formatNextRuns } from '../backend/processes/definitions/TriggerEditor'
import type { ProcessTrigger } from '../data/validators'
import dictionary from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn().mockResolvedValue({ ok: true, result: { data: [], items: [] } }),
}))

const t: TranslateFn = (key, fallback) => (dictionary as Record<string, string>)[key] ?? fallback ?? key

test('schedule previews display the configured timezone, not the browser timezone', () => {
  const preview = formatNextRuns('0 9 * * *', 'Pacific/Honolulu', 'en-US')
  expect(preview.ok).toBe(true)
  expect(preview.text.match(/9:00 AM/g)).toHaveLength(3)
})

test('removing other triggers preserves an invalid event draft and blocks saving until corrected', async () => {
  const onValidityChange = jest.fn()
  function Harness() {
    const [value, setValue] = React.useState<ProcessTrigger[]>([
      { kind: 'manual', requireFeatures: [] },
      { kind: 'schedule', cron: '0 7 * * *', timezone: 'UTC', enabled: true },
      { kind: 'event', eventPattern: 'test.case.created', priority: 1, enabled: true },
    ])
    return (
      <TriggerEditor
        value={value}
        onChange={setValue}
        onValidityChange={onValidityChange}
        locale="en"
        t={t}
      />
    )
  }
  renderWithProviders(<Harness />, { dict: dictionary })
  const configLabel = t('agent_orchestrator.processDefinitions.triggers.event.config')
  fireEvent.change(screen.getByLabelText(configLabel), { target: { value: '{invalid' } })
  await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false))
  fireEvent.click(
    screen.getAllByRole('button', { name: t('agent_orchestrator.processDefinitions.triggers.remove') })[0],
  )
  expect(screen.getByLabelText(configLabel)).toHaveProperty('value', '{invalid')
  fireEvent.click(
    screen.getByRole('switch', { name: t('agent_orchestrator.processDefinitions.triggers.manual.toggle') }),
  )
  expect(screen.getByLabelText(configLabel)).toHaveProperty('value', '{invalid')
  expect(onValidityChange).toHaveBeenLastCalledWith(false)
  fireEvent.change(screen.getByLabelText(configLabel), { target: { value: '{}' } })
  await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true))
})
