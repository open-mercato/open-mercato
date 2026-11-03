/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react'
import { useDeviceUserLabels } from '../backend/devices/useDeviceUserLabels'

const resolveDeviceUserOptionsMock = jest.fn()

jest.mock('../backend/devices/userOptions', () => ({
  resolveDeviceUserOptions: (...args: unknown[]) => resolveDeviceUserOptionsMock(...args),
}))

const ADA = '11111111-1111-4111-8111-111111111111'
const GRACE = '22222222-2222-4222-8222-222222222222'

function idsAskedFor(callIndex: number): string[] {
  return resolveDeviceUserOptionsMock.mock.calls[callIndex][0] as string[]
}

beforeEach(() => {
  resolveDeviceUserOptionsMock.mockReset()
})

describe('useDeviceUserLabels', () => {
  it('resolves the ids on screen into labels', async () => {
    resolveDeviceUserOptionsMock.mockResolvedValue({
      options: [{ value: ADA, label: 'Ada Lovelace' }],
      resolvedIds: [ADA],
    })

    const { result } = renderHook(() => useDeviceUserLabels([ADA, null, '  ']))

    await waitFor(() => expect(result.current).toEqual({ [ADA]: 'Ada Lovelace' }))
    expect(idsAskedFor(0)).toEqual([ADA])
  })

  it('does not re-ask for an id the server already answered for', async () => {
    resolveDeviceUserOptionsMock.mockResolvedValue({
      options: [{ value: ADA, label: 'Ada Lovelace' }],
      resolvedIds: [ADA],
    })

    const { result, rerender } = renderHook(({ ids }) => useDeviceUserLabels(ids), {
      initialProps: { ids: [ADA] as (string | null)[] },
    })
    await waitFor(() => expect(result.current[ADA]).toBe('Ada Lovelace'))

    resolveDeviceUserOptionsMock.mockResolvedValue({
      options: [{ value: GRACE, label: 'Grace Hopper' }],
      resolvedIds: [GRACE],
    })
    rerender({ ids: [ADA, GRACE] })

    await waitFor(() => expect(result.current[GRACE]).toBe('Grace Hopper'))
    // The second lookup asks for Grace only — Ada is already known.
    expect(idsAskedFor(1)).toEqual([GRACE])
    expect(result.current[ADA]).toBe('Ada Lovelace')
  })

  it('treats an id the server answered for but matched no row as resolved, and stops asking', async () => {
    resolveDeviceUserOptionsMock.mockResolvedValue({ options: [], resolvedIds: [ADA] })

    const { rerender } = renderHook(({ ids }) => useDeviceUserLabels(ids), {
      initialProps: { ids: [ADA] as (string | null)[] },
    })
    await waitFor(() => expect(resolveDeviceUserOptionsMock).toHaveBeenCalledTimes(1))

    resolveDeviceUserOptionsMock.mockResolvedValue({
      options: [{ value: GRACE, label: 'Grace Hopper' }],
      resolvedIds: [GRACE],
    })
    rerender({ ids: [ADA, GRACE] })

    await waitFor(() => expect(resolveDeviceUserOptionsMock).toHaveBeenCalledTimes(2))
    expect(idsAskedFor(1)).toEqual([GRACE])
  })

  it('retries an id whose lookup failed, instead of remembering the failure', async () => {
    // The regression this pins: caching a failed id would leave that row showing a bare UUID for
    // the life of the component, even though the next attempt would have worked.
    resolveDeviceUserOptionsMock.mockResolvedValue({ options: [], resolvedIds: [] })

    const { result, rerender } = renderHook(({ ids }) => useDeviceUserLabels(ids), {
      initialProps: { ids: [ADA] as (string | null)[] },
    })
    await waitFor(() => expect(resolveDeviceUserOptionsMock).toHaveBeenCalledTimes(1))
    expect(result.current).toEqual({})

    resolveDeviceUserOptionsMock.mockResolvedValue({
      options: [
        { value: ADA, label: 'Ada Lovelace' },
        { value: GRACE, label: 'Grace Hopper' },
      ],
      resolvedIds: [ADA, GRACE],
    })
    rerender({ ids: [ADA, GRACE] })

    await waitFor(() => expect(result.current[ADA]).toBe('Ada Lovelace'))
    expect(idsAskedFor(1)).toEqual([ADA, GRACE])
    expect(result.current[GRACE]).toBe('Grace Hopper')
  })

  it('does not call the lookup when no id is on screen', () => {
    renderHook(() => useDeviceUserLabels([null, undefined, '   ']))

    expect(resolveDeviceUserOptionsMock).not.toHaveBeenCalled()
  })

  it('ignores a reordered id list, so a re-sort does not re-fetch', async () => {
    resolveDeviceUserOptionsMock.mockResolvedValue({
      options: [
        { value: ADA, label: 'Ada Lovelace' },
        { value: GRACE, label: 'Grace Hopper' },
      ],
      resolvedIds: [ADA, GRACE],
    })

    const { rerender } = renderHook(({ ids }) => useDeviceUserLabels(ids), {
      initialProps: { ids: [ADA, GRACE] as (string | null)[] },
    })
    await waitFor(() => expect(resolveDeviceUserOptionsMock).toHaveBeenCalledTimes(1))

    rerender({ ids: [GRACE, ADA] })

    expect(resolveDeviceUserOptionsMock).toHaveBeenCalledTimes(1)
  })
})
