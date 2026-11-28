/** @jest-environment jsdom */
import { overlayRequiredHeight, previewContentHeight } from '../preview-protocol'

function rect(top: number, height: number, width = 100): DOMRect {
  return { top, height, width, bottom: top + height, left: 0, right: width, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

describe('previewContentHeight', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('uses the content height when nothing is open', () => {
    const content = document.createElement('div')
    content.getBoundingClientRect = () => rect(0, 120)
    document.body.appendChild(content)
    expect(previewContentHeight(content, document)).toBe(120)
  })

  it('grows to fit an open portaled listbox, including its clipped scroll height', () => {
    const content = document.createElement('div')
    content.getBoundingClientRect = () => rect(0, 120)
    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    listbox.getBoundingClientRect = () => rect(90, 40)
    Object.defineProperty(listbox, 'scrollHeight', { value: 200 })
    document.body.append(content, listbox)
    expect(previewContentHeight(content, document)).toBe(90 + 200 + 16)
  })

  it('ignores hidden overlays', () => {
    const content = document.createElement('div')
    content.getBoundingClientRect = () => rect(0, 120)
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.getBoundingClientRect = () => rect(0, 0, 0)
    document.body.append(content, menu)
    expect(previewContentHeight(content, document)).toBe(120)
  })

  it('sizes a dialog by its own height, wherever the viewport places it', () => {
    const content = document.createElement('div')
    content.getBoundingClientRect = () => rect(0, 80)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    Object.defineProperty(dialog, 'scrollHeight', { value: 240 })
    document.body.append(content, dialog)
    for (const iframeHeight of [80, 272, 600]) {
      Object.defineProperty(window, 'innerHeight', { value: iframeHeight, configurable: true })
      dialog.getBoundingClientRect = () => rect(iframeHeight - 240, 240)
      expect(previewContentHeight(content, document)).toBe(272)
    }
  })

  it('still positions a popover dialog from its anchor', () => {
    const content = document.createElement('div')
    content.getBoundingClientRect = () => rect(0, 80)
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-radix-popper-content-wrapper', '')
    wrapper.getBoundingClientRect = () => rect(0, 0, 0)
    const popover = document.createElement('div')
    popover.setAttribute('role', 'dialog')
    popover.getBoundingClientRect = () => rect(44, 120)
    Object.defineProperty(popover, 'scrollHeight', { value: 120 })
    wrapper.appendChild(popover)
    document.body.append(content, wrapper)
    expect(previewContentHeight(content, document)).toBe(44 + 120 + 16)
  })
})

describe('overlayRequiredHeight', () => {
  it('reaches a fixed point for a bottom sheet instead of growing on every measurement', () => {
    let iframeHeight = 80
    for (let pass = 0; pass < 6; pass += 1) {
      const required = overlayRequiredHeight({ top: iframeHeight - 200, height: 200, scrollHeight: 200, anchored: false }, iframeHeight)
      iframeHeight = Math.max(iframeHeight, required)
    }
    expect(iframeHeight).toBe(232)
  })

  it('does not ask for more room when a full-height panel already fills the frame', () => {
    expect(overlayRequiredHeight({ top: 0, height: 400, scrollHeight: 400, anchored: false }, 400)).toBe(0)
  })

  it('grows a full-height panel only as far as its clipped content', () => {
    expect(overlayRequiredHeight({ top: 0, height: 80, scrollHeight: 300, anchored: false }, 80)).toBe(332)
    expect(overlayRequiredHeight({ top: 0, height: 332, scrollHeight: 332, anchored: false }, 332)).toBe(0)
  })
})
