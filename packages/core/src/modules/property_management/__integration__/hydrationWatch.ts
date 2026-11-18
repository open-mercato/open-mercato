import { expect, type Page } from '@playwright/test'

const HYDRATION_PROBLEM = /hydrat|did not match|server rendered|Minified React error #(418|419|423|425)/i

export type HydrationWatch = { assertClean: () => void }

export function watchHydration(page: Page): HydrationWatch {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (HYDRATION_PROBLEM.test(text)) problems.push(`console: ${text}`)
  })
  return {
    assertClean: () => expect(problems, 'no uncaught page errors or hydration mismatches').toEqual([]),
  }
}
