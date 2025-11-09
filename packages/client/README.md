# @open-mercato/client

Typed API client for the Open Mercato platform, generated directly from the monorepo's OpenAPI specification.

## Installation

```bash
npm install @open-mercato/client
```

## Usage

```ts
import { createOpenMercatoClient } from '@open-mercato/client'

const client = createOpenMercatoClient({
  baseUrl: 'https://api.your-mercato.com/api',
  accessToken: async () => process.env.OPEN_MERCATO_TOKEN,
})

const { data, error } = await client.GET('/customers/customers/people', {
  params: { query: { page: 1, pageSize: 20 } },
})

if (error) throw new Error(error.message ?? 'Request failed')
console.log('people', data?.items)
```

### Base URL resolution

If `baseUrl` is omitted the client tries, in order, `OPEN_MERCATO_API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `APP_URL`, then defaults to `http://localhost:3000/api`.

### Authentication

Pass a string or async function via `accessToken`. Values are normalized to `Authorization: Bearer <token>` automatically. You may also register custom `Middleware` when creating the client for advanced flows (retry, tracing, etc.).

## Regenerating types locally

```bash
yarn client:generate
```

This script builds the OpenAPI document from enabled modules, normalizes recursive schemas, and re-runs `openapi-typescript` to refresh `src/generated/openapi.types.ts`.

## Publishing to npm

1. Ensure artifacts are up to date: `yarn client:generate && yarn workspace @open-mercato/client build`.
2. From repo root, publish the workspace:
   ```bash
   npm publish packages/client --access public
   ```
   (Or use `yarn npm publish --access public --workspace @open-mercato/client`).
3. Tag/commit as needed for release automation.

> The package's `files` entry only ships `dist/` and `src/generated/`, so remember to run `tsc` before publishing.

