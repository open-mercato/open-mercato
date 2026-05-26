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
