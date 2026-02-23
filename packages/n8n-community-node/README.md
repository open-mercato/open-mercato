# n8n-nodes-open-mercato

Initial scaffolding for the Open Mercato n8n community node package.

## Included

- `OpenMercatoApi` credentials (base URL + API key)
- `Open Mercato` declarative REST API node
- `openapi:generate` script that fetches `/api/docs/openapi`

## Development

```bash
yarn workspace n8n-nodes-open-mercato build
yarn workspace n8n-nodes-open-mercato lint
yarn workspace n8n-nodes-open-mercato test
OPEN_MERCATO_BASE_URL=http://localhost:3000 yarn workspace n8n-nodes-open-mercato openapi:generate
# or use an existing JSON file:
OPEN_MERCATO_OPENAPI_SOURCE=apps/mercato/.mercato/generated/openapi.generated.json yarn workspace n8n-nodes-open-mercato openapi:generate
```
