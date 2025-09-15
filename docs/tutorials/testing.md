# Tutorial: Writing Unit Tests

This guide shows how to write and run unit tests for Open Mercato using Jest + ts-jest. It covers services, API handlers, and utilities, and explains how to keep tests out of the runtime bundle.

## Prerequisites

- Node.js 20+
- Jest + ts-jest already configured in this repo
- Aliases resolved in tests via `jest.config.cjs`

## Running Tests

- All tests: `yarn test`
- Watch mode: `yarn test:watch`

## Jest Aliases (in tests)

- `@/generated/*` → `generated/*`
- `@/lib/*` → `packages/shared/src/lib/*`
- `@/types/*` → `packages/shared/src/types/*`
- `@open-mercato/core/*`, `@open-mercato/example/*`, `@open-mercato/cli/*`, `@open-mercato/shared/*`
- Fallback: `@/*` → `src/*`

See `jest.config.cjs: moduleNameMapper` for the full mapping.

## Patterns

### 1) Services (no DB)

Keep service tests fast by stubbing the EM (or other gateways) with minimal methods.

```ts
// packages/core/src/modules/auth/services/__tests__/authService.test.ts
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

describe('AuthService', () => {
  it('hashes password on create', async () => {
    const em: any = { calls: [], persistAndFlush: async (e: any) => em.calls.push(['persistAndFlush', e]) }
    const svc = new AuthService(em)
    await svc.createUser({ email: 'a@b.c', password: 'secret' } as any)
    expect(em.calls[0][0]).toBe('persistAndFlush')
  })
})
```

Tips:

- Stub only what you use; avoid spinning up real DB connections.
- Extract common stubs to `__tests__/helpers` if reused.

### 2) API Handlers (mock DI)

Import handlers and call them directly. Mock the DI container so handlers get fake services.

```ts
// packages/core/src/modules/auth/api/__tests__/login.test.ts
import { POST } from '@open-mercato/core/modules/auth/api/login'

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({
      findUserByEmail: async () => ({ id: 1, email: 'admin@acme.com', passwordHash: 'hash', tenant: { id: 1 }, organization: { id: 1 } }),
      verifyPassword: async () => true,
      issueSession: async () => ({ token: 'jwt-token' }),
    }),
  }),
}))

function makeRequest(body: any) {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('auth login', () => {
  it('returns 200 for valid credentials', async () => {
    const res = await POST(makeRequest({ email: 'admin@acme.com', password: 'secret' }))
    expect(res.status).toBe(200)
  })
})
```

Tips:

- Use `Request` with JSON bodies to simulate HTTP.
- Assert on status codes and minimal response body (not framework internals).

### 3) Utilities

Plain utilities are simple to test:

```ts
import { someUtil } from '@open-mercato/shared/lib/utils'

test('someUtil', () => {
  expect(someUtil('x')).toBe('X')
})
```

## File Layout and Discovery

- Co-locate tests in `__tests__` folders next to code.
- Filenames: `*.test.ts` or `*.test.tsx`
- Jest `testMatch`: `**/__tests__/**/*.test.(ts|tsx)`

## Keeping Tests Out of Runtime

Our module generator explicitly ignores tests so dev/runtime doesn’t import them:

- Skips folders named `__tests__` and `__mocks__`
- Skips files ending with `.test.ts`, `.spec.ts`

If you introduce new patterns, ensure they don’t live under module `api/` unless named with `.test.ts`.

## Troubleshooting

- “jest is not defined” during `yarn dev`: means a test leaked into the runtime. Ensure tests are under `__tests__` and the generator filters apply.
- Module not found in tests: verify alias in `jest.config.cjs` and the file path.

You’re set — write focused tests, mock I/O, and keep the loop fast.
