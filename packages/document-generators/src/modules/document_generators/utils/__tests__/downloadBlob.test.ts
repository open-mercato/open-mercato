/** @jest-environment jsdom */
import { downloadBlob } from '../downloadBlob'

describe('downloadBlob', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('starts a named download and releases its temporary URL after navigation can consume it', () => {
    jest.useFakeTimers()
    const createObjectURL = jest.fn(() => 'blob:document')
    const revokeObjectURL = jest.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('invoice.pdf')
      expect(this.href).toBe('blob:document')
      expect(this.isConnected).toBe(true)
    })
    downloadBlob(new Blob(['PDF']), 'invoice.pdf')
    expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    jest.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:document')
  })
})
