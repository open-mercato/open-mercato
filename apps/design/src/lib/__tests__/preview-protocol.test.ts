/** @jest-environment jsdom */
import { previewContentHeight } from '../preview-protocol'

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
})
