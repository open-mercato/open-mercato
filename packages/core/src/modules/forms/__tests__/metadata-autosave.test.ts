import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { createMetadataAutosave, type MetadataPatch } from '../backend/forms/[id]/studio/metadata-autosave'

function deferredSave() {
  let resolve: (saved: boolean) => void = () => undefined
  const promise = new Promise<boolean>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe('Form Studio metadata autosave', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('reports pending edits immediately and coalesces only edited metadata fields', async () => {
    const save = jest.fn<(patch: MetadataPatch) => Promise<boolean>>().mockResolvedValue(true)
    const onStateChange = jest.fn()
    const autosave = createMetadataAutosave({ save, onStateChange, onError: jest.fn() })
    autosave.schedule({ name: 'New name' })
    autosave.schedule({ description: 'New description' })
    expect(onStateChange).toHaveBeenLastCalledWith('saving')
    expect(save).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ name: 'New name', description: 'New description' })
    expect(onStateChange).toHaveBeenLastCalledWith('idle')
  })

  it('retains unsaved fields and the error after repeated refusals, without an automatic retry loop', async () => {
    const save = jest.fn<(patch: MetadataPatch) => Promise<boolean>>().mockResolvedValue(false)
    const onStateChange = jest.fn()
    const autosave = createMetadataAutosave({ save, onStateChange, onError: jest.fn() })
    autosave.schedule({ name: 'Refused name' })
    await jest.advanceTimersByTimeAsync(1000)
    expect(onStateChange).toHaveBeenLastCalledWith('error')
    await jest.advanceTimersByTimeAsync(10_000)
    expect(save).toHaveBeenCalledTimes(1)
    autosave.schedule({ description: 'Retry description' })
    await jest.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenLastCalledWith({ name: 'Refused name', description: 'Retry description' })
    expect(onStateChange).toHaveBeenLastCalledWith('error')
  })

  it('serializes writes and never reports idle while another edit is pending', async () => {
    const first = deferredSave()
    const second = deferredSave()
    const save = jest.fn<(patch: MetadataPatch) => Promise<boolean>>()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const onStateChange = jest.fn()
    const autosave = createMetadataAutosave({ save, onStateChange, onError: jest.fn() })
    autosave.schedule({ name: 'First' })
    await jest.advanceTimersByTimeAsync(1000)
    autosave.schedule({ description: 'Second' })
    await jest.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    first.resolve(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenNthCalledWith(2, { description: 'Second' })
    expect(onStateChange).toHaveBeenLastCalledWith('saving')
    second.resolve(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(onStateChange).toHaveBeenLastCalledWith('idle')
  })

  it('reports network failures and recovers after a successful explicit retry', async () => {
    const error = new Error('Network unavailable')
    const save = jest.fn<(patch: MetadataPatch) => Promise<boolean>>()
      .mockRejectedValueOnce(error).mockResolvedValueOnce(true)
    const onStateChange = jest.fn()
    const onError = jest.fn()
    const autosave = createMetadataAutosave({ save, onStateChange, onError })
    autosave.schedule({ name: 'Retry me' })
    await jest.advanceTimersByTimeAsync(1000)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(error)
    expect(onStateChange).toHaveBeenLastCalledWith('error')
    autosave.schedule({ name: 'Retried' })
    await jest.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenLastCalledWith({ name: 'Retried' })
    expect(onStateChange).toHaveBeenLastCalledWith('idle')
  })

  it('discards queued edits on reload and ignores an old in-flight result', async () => {
    const first = deferredSave()
    const save = jest.fn<(patch: MetadataPatch) => Promise<boolean>>().mockReturnValueOnce(first.promise)
    const onStateChange = jest.fn()
    const autosave = createMetadataAutosave({ save, onStateChange, onError: jest.fn() })
    autosave.schedule({ name: 'Old' })
    await jest.advanceTimersByTimeAsync(1000)
    autosave.schedule({ description: 'Discard' })
    autosave.reset()
    first.resolve(false)
    await jest.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(onStateChange).toHaveBeenLastCalledWith('idle')
  })

  it('cancels queued work on unmount', async () => {
    const save = jest.fn<(patch: MetadataPatch) => Promise<boolean>>().mockResolvedValue(true)
    const autosave = createMetadataAutosave({ save, onStateChange: jest.fn(), onError: jest.fn() })
    autosave.schedule({ name: 'Discard' })
    autosave.dispose()
    await jest.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })
})
