import * as React from 'react'
import { act, render, fireEvent } from '@testing-library/react'
import { Tabs, TabsContent, TabsContext, TabsList, TabsTrigger } from '../tabs'

describe('Tabs context provider', () => {
  it('keeps a stable context value reference across unrelated parent re-renders', () => {
    const captured: unknown[] = []

    function Capture() {
      captured.push(React.useContext(TabsContext))
      return null
    }

    let bump: () => void = () => {}

    function Host() {
      const [n, setN] = React.useState(0)
      bump = () => setN((prev) => prev + 1)
      return (
        <Tabs defaultValue="a">
          <span data-testid="unrelated">{n}</span>
          <Capture />
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">A content</TabsContent>
        </Tabs>
      )
    }

    render(<Host />)
    const initial = captured[captured.length - 1]

    act(() => {
      bump()
    })
    act(() => {
      bump()
    })

    const afterUnrelated = captured[captured.length - 1]
    expect(afterUnrelated).toBe(initial)
  })

  it('produces a new context value reference when the selected tab changes', () => {
    const captured: unknown[] = []

    function Capture() {
      captured.push(React.useContext(TabsContext))
      return null
    }

    const { getByRole } = render(
      <Tabs defaultValue="a">
        <Capture />
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A content</TabsContent>
        <TabsContent value="b">B content</TabsContent>
      </Tabs>,
    )

    const before = captured[captured.length - 1]
    fireEvent.click(getByRole('tab', { name: 'B' }))
    const after = captured[captured.length - 1]

    expect(after).not.toBe(before)
  })
})

describe('Tabs Phase B.5 — variant + orientation + leading + count', () => {
  it('defaults to variant="pill" + orientation="horizontal" (backward compat)', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content</TabsContent>
      </Tabs>,
    )
    const root = container.querySelector('[data-slot="tabs"]') as HTMLElement
    expect(root.getAttribute('data-variant')).toBe('pill')
    expect(root.getAttribute('data-orientation')).toBe('horizontal')
    const list = container.querySelector('[data-slot="tabs-list"]') as HTMLElement
    expect(list.className).toContain('bg-muted')
    expect(list.className).toContain('rounded-lg')
    expect(list.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('switches to underline strip when variant="underline"', () => {
    const { container } = render(
      <Tabs defaultValue="a" variant="underline">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const list = container.querySelector('[data-slot="tabs-list"]') as HTMLElement
    expect(list.className).toContain('border-b')
    expect(list.className).not.toContain('bg-muted')
    const active = container.querySelector('[data-state="active"]') as HTMLElement
    expect(active.getAttribute('data-variant')).toBe('underline')
    expect(active.className).toContain('border-accent-indigo')
    expect(active.className).toContain('font-semibold')
  })

  it('vertical orientation renders list as a column', () => {
    const { container } = render(
      <Tabs defaultValue="a" orientation="vertical">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const root = container.querySelector('[data-slot="tabs"]') as HTMLElement
    expect(root.getAttribute('data-orientation')).toBe('vertical')
    expect(root.className).toContain('flex')
    expect(root.className).toContain('gap-4')
    const list = container.querySelector('[data-slot="tabs-list"]') as HTMLElement
    expect(list.className).toContain('flex-col')
    expect(list.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('vertical underline switches to right-side border + bg-muted on active item', () => {
    const { container } = render(
      <Tabs defaultValue="a" variant="underline" orientation="vertical">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const list = container.querySelector('[data-slot="tabs-list"]') as HTMLElement
    expect(list.className).toContain('border-r')
    const active = container.querySelector('[data-state="active"]') as HTMLElement
    expect(active.className).toContain('bg-muted/40')
    expect(active.className).toContain('text-foreground')
  })

  it('renders the leading icon slot when provided (both variants)', () => {
    const Icon = () => <svg data-testid="lead" />
    const { container, rerender } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" leading={<Icon />}>A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expect(container.querySelector('[data-slot="tabs-trigger-leading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="lead"]')).not.toBeNull()

    rerender(
      <Tabs defaultValue="a" variant="underline">
        <TabsList>
          <TabsTrigger value="a" leading={<Icon />}>A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expect(container.querySelector('[data-slot="tabs-trigger-leading"]')).not.toBeNull()
  })

  it('renders the count slot on selected trigger with accent-indigo tone', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" count={5}>Active</TabsTrigger>
          <TabsTrigger value="b" count={3}>Inactive</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const counts = Array.from(
      container.querySelectorAll('[data-slot="tabs-trigger-count"]'),
    ) as HTMLElement[]
    expect(counts.length).toBe(2)
    // The first (selected) trigger's count uses accent-indigo tone.
    expect(counts[0].className).toContain('bg-accent-indigo/10')
    expect(counts[0].className).toContain('text-accent-indigo')
    // The second (inactive) trigger's count uses the muted variant.
    expect(counts[1].className).toContain('text-muted-foreground')
    expect(counts[0].textContent).toBe('5')
    expect(counts[1].textContent).toBe('3')
  })

  it('count=0 still renders (typeof check is `!== undefined`)', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" count={0}>Empty</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const count = container.querySelector('[data-slot="tabs-trigger-count"]') as HTMLElement
    expect(count).not.toBeNull()
    expect(count.textContent).toBe('0')
  })

  it('omits the count slot entirely when prop is undefined', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">No count</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expect(container.querySelector('[data-slot="tabs-trigger-count"]')).toBeNull()
  })
})
