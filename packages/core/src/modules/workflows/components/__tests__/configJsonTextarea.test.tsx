/**
 * @jest-environment jsdom
 *
 * Regression guard for the silent-failure class in .ai/specs/2026-07-26-workflows-ux-redesign.md
 * (Phase 0): the activity config JSON textarea used to discard every keystroke that was not
 * momentarily valid JSON, so typing naturally lost edits with no feedback. The editors must keep
 * the raw text, surface an inline error hint while the JSON is invalid, and only propagate the
 * parsed config once it parses again.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesEditor } from '../ActivitiesEditor'
import { TransitionsEditor } from '../TransitionsEditor'
import { ConfigJsonTextarea } from '../ConfigJsonTextarea'
import { assertNoInvalidActivityConfigs } from '../formConfig'

const HINT_KEY = 'workflows.fieldEditors.activities.invalidJson'

const activity = {
  activityId: 'activity_1',
  activityName: 'Call API',
  activityType: 'CALL_API',
  config: { url: 'https://example.com' },
}

describe('ActivitiesEditor config JSON textarea', () => {
  it('keeps invalid JSON text, shows the hint, and does not propagate', () => {
    const onChange = jest.fn()
    renderWithProviders(<ActivitiesEditor value={[activity]} onChange={onChange} />)

    const textarea = document.getElementById('activity-0-config') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '{"url": ' } })

    expect(textarea.value).toBe('{"url": ')
    expect(screen.getByText(HINT_KEY)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('propagates parsed config and hides the hint when JSON becomes valid', () => {
    const onChange = jest.fn()
    renderWithProviders(<ActivitiesEditor value={[activity]} onChange={onChange} />)

    const textarea = document.getElementById('activity-0-config') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '{"url": ' } })
    expect(screen.getByText(HINT_KEY)).toBeTruthy()

    fireEvent.change(textarea, { target: { value: '{"url": "https://other.test"}' } })

    expect(screen.queryByText(HINT_KEY)).toBeNull()
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ config: { url: 'https://other.test' } }),
    ])
  })
})

describe('TransitionsEditor activity config JSON textarea', () => {
  const transition = {
    transitionId: 'transition_1',
    transitionName: 'Go',
    fromStepId: 'start',
    toStepId: 'end',
    trigger: 'auto',
    activities: [activity],
  }

  it('keeps invalid JSON text, shows the hint, and does not propagate', () => {
    const onChange = jest.fn()
    renderWithProviders(<TransitionsEditor value={[transition]} onChange={onChange} />)

    const textarea = document.getElementById('activity-0-0-config') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'not json' } })

    expect(textarea.value).toBe('not json')
    expect(screen.getByText(HINT_KEY)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('invalid config JSON blocks the definition save (PR #4532 review)', () => {
  const transition = {
    transitionId: 'transition_1',
    transitionName: 'Go',
    fromStepId: 'start',
    toStepId: 'end',
    trigger: 'auto',
    activities: [activity],
  }

  it('TransitionsEditor reports the invalid activity by name and clears once fixed', async () => {
    const onInvalid = jest.fn()
    renderWithProviders(
      <TransitionsEditor value={[transition]} onChange={jest.fn()} onInvalidActivityConfigsChange={onInvalid} />,
    )

    const textarea = document.getElementById('activity-0-0-config') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '{"url": ' } })

    await waitFor(() => {
      expect(onInvalid).toHaveBeenCalledWith(['Call API'])
    })

    fireEvent.change(textarea, { target: { value: '{"url": "https://ok.test"}' } })

    await waitFor(() => {
      expect(onInvalid).toHaveBeenCalledWith([])
    })
  })

  it('ActivitiesEditor reports the invalid activity by name and clears once fixed', async () => {
    const onInvalid = jest.fn()
    renderWithProviders(
      <ActivitiesEditor value={[activity]} onChange={jest.fn()} onInvalidActivityConfigsChange={onInvalid} />,
    )

    const textarea = document.getElementById('activity-0-config') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'not json' } })

    await waitFor(() => {
      expect(onInvalid).toHaveBeenCalledWith(['Call API'])
    })

    fireEvent.change(textarea, { target: { value: '{}' } })

    await waitFor(() => {
      expect(onInvalid).toHaveBeenCalledWith([])
    })
  })

  it('assertNoInvalidActivityConfigs throws the naming error while invalid and passes when clear', () => {
    const translate = (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${String(params.activity)}` : key

    expect(() => assertNoInvalidActivityConfigs(['Call API'], translate)).toThrow(
      'workflows.validation.invalidActivityConfigJson:Call API',
    )
    expect(() => assertNoInvalidActivityConfigs([], translate)).not.toThrow()
  })
})

describe('ConfigJsonTextarea external value sync', () => {
  it('re-derives the local text when the value prop changes while not focused', () => {
    const onChange = jest.fn()
    const { rerender } = renderWithProviders(
      <ConfigJsonTextarea id="config" value={{ initial: true }} onChange={onChange} />,
    )

    const textarea = document.getElementById('config') as HTMLTextAreaElement
    expect(textarea.value).toBe(JSON.stringify({ initial: true }, null, 2))

    rerender(<ConfigJsonTextarea id="config" value={{ replaced: 1 }} onChange={onChange} />)

    expect(textarea.value).toBe(JSON.stringify({ replaced: 1 }, null, 2))
    expect(screen.queryByText(HINT_KEY)).toBeNull()
  })
})
