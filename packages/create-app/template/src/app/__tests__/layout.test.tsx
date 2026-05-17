/**
 * @jest-environment node
 */

import * as React from 'react'
import type { ReactElement, ReactNode } from 'react'

jest.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'geist-sans' }),
  Geist_Mono: () => ({ variable: 'geist-mono' }),
}))

jest.mock('../globals.css', () => ({}))

jest.mock('@/bootstrap', () => ({
  bootstrap: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  detectLocale: jest.fn(async () => 'en'),
  loadDictionary: jest.fn(async () => ({ common: 'value' })),
}))

jest.mock('@/components/AppProviders', () => ({
  AppProviders: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) =>
    React.createElement('app-providers', { ...props }, children),
}))

function findElementByType(node: ReactNode, targetType: unknown): ReactElement | null {
  if (!node || typeof node !== 'object') {
    return null
  }

  const element = node as ReactElement<{ children?: ReactNode }>
  if (element.type === targetType) {
    return element
  }

  const children = element.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const match = findElementByType(child, targetType)
      if (match) {
        return match
      }
    }
    return null
  }

  return findElementByType(children, targetType)
}

describe('RootLayout', () => {
  const originalDemoMode = process.env.DEMO_MODE
  const originalIntegrationFlag = process.env.OM_INTEGRATION_TEST

  afterEach(() => {
    if (originalDemoMode === undefined) {
      delete process.env.DEMO_MODE
    } else {
      process.env.DEMO_MODE = originalDemoMode
    }

    if (originalIntegrationFlag === undefined) {
      delete process.env.OM_INTEGRATION_TEST
    } else {
      process.env.OM_INTEGRATION_TEST = originalIntegrationFlag
    }

    jest.resetModules()
  })

  it('disables notice bars when OM_INTEGRATION_TEST is true', async () => {
    process.env.DEMO_MODE = 'true'
    process.env.OM_INTEGRATION_TEST = 'true'

    const { default: RootLayout } = await import('../layout')
    const { AppProviders } = await import('@/components/AppProviders')
    const tree = await RootLayout({ children: 'child' })
    const appProviders = findElementByType(tree, AppProviders)

    expect(appProviders).not.toBeNull()
    expect(appProviders?.props.demoModeEnabled).toBe(true)
    expect(appProviders?.props.noticeBarsEnabled).toBe(false)
  })

  it('keeps notice bars enabled outside integration mode', async () => {
    process.env.DEMO_MODE = 'false'
    delete process.env.OM_INTEGRATION_TEST

    const { default: RootLayout } = await import('../layout')
    const { AppProviders } = await import('@/components/AppProviders')
    const tree = await RootLayout({ children: 'child' })
    const appProviders = findElementByType(tree, AppProviders)

    expect(appProviders).not.toBeNull()
    expect(appProviders?.props.demoModeEnabled).toBe(false)
    expect(appProviders?.props.noticeBarsEnabled).toBe(true)
  })

  it('defaults demo mode off when DEMO_MODE is unset', async () => {
    delete process.env.DEMO_MODE
    delete process.env.OM_INTEGRATION_TEST

    const { default: RootLayout } = await import('../layout')
    const { AppProviders } = await import('@/components/AppProviders')
    const tree = await RootLayout({ children: 'child' })
    const appProviders = findElementByType(tree, AppProviders)

    expect(appProviders).not.toBeNull()
    expect(appProviders?.props.demoModeEnabled).toBe(false)
    expect(appProviders?.props.noticeBarsEnabled).toBe(true)
  })
})
