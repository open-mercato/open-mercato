# n8n-nodes-open-mercato

Initial scaffolding for the Open Mercato n8n community node package.

## Included

- `OpenMercatoApi` credentials (base URL + API key)
- `Open Mercato` declarative REST API node
- `openapi:generate` script that fetches `/api/docs/openapi`
- Smoke test for credential/node loading

## Notes

- `Path` is normalized to `/api/...` automatically if needed.
- Request body is intended for `POST` / `PUT` / `PATCH` (UI hint shown for `GET`/`DELETE`).

## Known limitations (MVP)

- Generic REST node only (no resource-specific operation list yet)
- Query/body are entered manually as JSON
- OpenAPI spec is generated on demand; it is not yet used to auto-build node operations

## Example workflow

Import: `examples/open-mercato-smoke-workflow.json`

This example calls `GET /api/customers/people`.

## Development

```bash
npx -y @yarnpkg/cli-dist@4.12.0 workspace n8n-nodes-open-mercato build
npx -y @yarnpkg/cli-dist@4.12.0 workspace n8n-nodes-open-mercato lint
npx -y @yarnpkg/cli-dist@4.12.0 workspace n8n-nodes-open-mercato test

OPEN_MERCATO_BASE_URL=http://localhost:3000 \
  npx -y @yarnpkg/cli-dist@4.12.0 workspace n8n-nodes-open-mercato openapi:generate

# or use an existing JSON file
OPEN_MERCATO_OPENAPI_SOURCE=apps/mercato/.mercato/generated/openapi.generated.json \
  npx -y @yarnpkg/cli-dist@4.12.0 workspace n8n-nodes-open-mercato openapi:generate
```
