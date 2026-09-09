import {
  activateEntityRefFromKeyboardEvent,
  activateEntityRefFromPointerEvent,
  EntityRefNode,
  isSafeEntityHref,
} from '../lib/editorConfig'

const RECORD_ID = '11111111-1111-4111-8111-111111111111'

describe('entity reference accessibility', () => {
  it('renders a keyboard-focusable link named only by its readable label', () => {
    const render = EntityRefNode.config.renderHTML!
    const output = render({
      node: { attrs: { entityType: 'customer-person', entityId: RECORD_ID, label: 'Ada Lovelace', href: `/backend/customers/people/${RECORD_ID}` } },
      HTMLAttributes: {},
    } as never) as [string, Record<string, string>, string]

    expect(output[1]).toMatchObject({ role: 'link', tabindex: '0', 'aria-label': 'Ada Lovelace' })
    expect(output[1]['aria-label']).not.toContain(RECORD_ID)
  })

  it('replaces UUID-shaped chip labels with a neutral readable fallback', () => {
    const render = EntityRefNode.config.renderHTML!
    const output = render({
      node: {
        attrs: {
          entityType: 'customer-person',
          entityId: RECORD_ID,
          label: `Customer ${RECORD_ID}`,
          href: `/backend/customers/people/${RECORD_ID}`,
        },
      },
      HTMLAttributes: {},
    } as never) as [string, Record<string, string | undefined>, string]

    expect(output[1].role).toBeUndefined()
    expect(output[1].tabindex).toBeUndefined()
    expect(output[1]['aria-label']).toBeUndefined()
    expect(output[1]['data-label']).toBeUndefined()
    expect(output[2]).toBe('Record')
    expect(output[2]).not.toContain(RECORD_ID)

    const parser = EntityRefNode.config.parseHTML?.()[0]?.getAttrs
    const parsed = parser?.({
      getAttribute: (name: string) => name === 'data-label' ? RECORD_ID : null,
      textContent: RECORD_ID,
    }) as Record<string, unknown>
    expect(parsed.label).toBe('Record')
  })

  it('does not make external, protocol-relative, or backslash network paths interactive', () => {
    expect(isSafeEntityHref('/backend/customers/people/example')).toBe(true)
    expect(isSafeEntityHref('//example.test/record')).toBe(false)
    expect(isSafeEntityHref('/\\example.test/record')).toBe(false)
    expect(new URL('/\\example.test/record', 'https://open-mercato.invalid').origin).toBe('https://example.test')
    expect(isSafeEntityHref('https://example.test/record')).toBe(false)
  })

  it('opens only safe entity refs through mouse and keyboard activation', () => {
    const openHref = jest.fn()
    const preventDefault = jest.fn()
    const safeTarget = {
      closest: () => ({ dataset: { href: `/backend/customers/people/${RECORD_ID}` } }),
    } as unknown as EventTarget
    const unsafeTarget = {
      closest: () => ({ dataset: { href: '/\\evil.example/path' } }),
    } as unknown as EventTarget

    expect(activateEntityRefFromPointerEvent(
      { target: safeTarget, metaKey: false, ctrlKey: true },
      openHref,
    )).toBe(true)
    expect(activateEntityRefFromKeyboardEvent(
      { target: safeTarget, key: 'Enter', preventDefault },
      openHref,
    )).toBe(true)
    expect(openHref).toHaveBeenNthCalledWith(1, `/backend/customers/people/${RECORD_ID}`)
    expect(openHref).toHaveBeenNthCalledWith(2, `/backend/customers/people/${RECORD_ID}`)
    expect(preventDefault).toHaveBeenCalledTimes(1)

    expect(activateEntityRefFromPointerEvent(
      { target: unsafeTarget, metaKey: true, ctrlKey: false },
      openHref,
    )).toBe(false)
    expect(activateEntityRefFromKeyboardEvent(
      { target: unsafeTarget, key: ' ', preventDefault },
      openHref,
    )).toBe(false)
    expect(openHref).toHaveBeenCalledTimes(2)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})
