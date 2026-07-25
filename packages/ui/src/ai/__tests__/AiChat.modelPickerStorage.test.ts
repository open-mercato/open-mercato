/** @jest-environment jsdom */
import { readModelPickerValue, writeModelPickerValue } from '../modelPickerStorage'

const PREFIX = 'om-ai-model-picker:'

describe('AiChat model-picker storage (versioned envelope)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('writes a versioned envelope and reads it back', () => {
    writeModelPickerValue('agent1', { providerId: 'openai', modelId: 'gpt' })
    expect(JSON.parse(localStorage.getItem(`${PREFIX}agent1`)!)).toEqual({
      v: 1,
      data: { providerId: 'openai', modelId: 'gpt' },
    })
    expect(readModelPickerValue('agent1')).toEqual({ providerId: 'openai', modelId: 'gpt' })
  })

  it('migrates a legacy bare (pre-envelope) value on read', () => {
    localStorage.setItem(`${PREFIX}agent2`, JSON.stringify({ providerId: 'anthropic', modelId: 'opus' }))
    expect(readModelPickerValue('agent2')).toEqual({ providerId: 'anthropic', modelId: 'opus' })
  })

  it('discards a version-mismatched envelope', () => {
    localStorage.setItem(`${PREFIX}agent3`, JSON.stringify({ v: 2, data: { providerId: 'x', modelId: 'y' } }))
    expect(readModelPickerValue('agent3')).toBeNull()
  })

  it('returns null for malformed data', () => {
    localStorage.setItem(`${PREFIX}agent4`, JSON.stringify({ providerId: 123 }))
    expect(readModelPickerValue('agent4')).toBeNull()
  })

  it('clears the slot when writing null', () => {
    writeModelPickerValue('agent5', { providerId: 'a', modelId: 'b' })
    writeModelPickerValue('agent5', null)
    expect(localStorage.getItem(`${PREFIX}agent5`)).toBeNull()
  })
})
