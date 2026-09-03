/** @jest-environment jsdom */

/**
 * Step 3.13 (workflows UX Phase 3b): the form editor is retired (spec section 10).
 *
 * "Form pages 301 to the Studio (bridge routes >= 1 minor)". These are client
 * components, so the 301 is an immediate `router.replace` — and the point of a
 * BRIDGE route is that the file and its RBAC guard survive, so this suite
 * asserts both: the redirect target AND that `page.meta.ts` still declares the
 * same auth/feature guards it declared before the retirement.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'

const replaceMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/definitions',
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import CreateWorkflowDefinitionPage from '../create/page'
import EditWorkflowDefinitionPage from '../[id]/page'
import { metadata as createMetadata } from '../create/page.meta'
import { metadata as editMetadata } from '../[id]/page.meta'

describe('retired workflow form editor bridges to the Studio', () => {
  beforeEach(() => {
    replaceMock.mockClear()
  })

  test('the create route forwards to the blank Studio', () => {
    render(<CreateWorkflowDefinitionPage />)

    expect(replaceMock).toHaveBeenCalledWith('/backend/definitions/visual-editor')
    expect(screen.getByText('Opening the workflow studio…')).toBeTruthy()
  })

  // The id arrives on the params prop the /backend/[...slug] catch-all passes
  // down (#5600); the positional slug reading this bridge used before is gone.
  test('the edit route forwards to the Studio carrying the definition id', () => {
    render(<EditWorkflowDefinitionPage params={{ id: '11111111-2222-3333-4444-555555555555' }} />)

    expect(replaceMock).toHaveBeenCalledWith(
      '/backend/definitions/visual-editor?id=11111111-2222-3333-4444-555555555555',
    )
  })

  test('an id-less edit route falls back to the blank Studio instead of a broken query', () => {
    render(<EditWorkflowDefinitionPage />)

    expect(replaceMock).toHaveBeenCalledWith('/backend/definitions/visual-editor')
  })

  // The create bridge guarded on `workflows.create`, an id `acl.ts` never
  // declared, so only a wildcard grant could open it. The guard now names the
  // real create feature.
  test('the bridge routes keep their RBAC guards', () => {
    expect(createMetadata.requireAuth).toBe(true)
    expect(createMetadata.requireFeatures).toEqual(['workflows.definitions.create'])
    expect(editMetadata.requireAuth).toBe(true)
    expect(editMetadata.requireFeatures).toEqual(['workflows.view'])
  })
})
