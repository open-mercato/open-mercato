# @open-mercato/sync-xero

Xero provider for the Open Mercato integration marketplace (module `sync_xero`). It connects one Xero Organisation per Open Mercato organization through the OAuth2 grant core of the `integrations` module and imports Xero Contacts into Companies through the `data_sync` hub.

- Setup guide: [`apps/docs/docs/user-guide/xero.mdx`](../../apps/docs/docs/user-guide/xero.mdx)
- Design: [`.ai/specs/2026-10-13-sync-xero-phase-1-connect-and-contacts.md`](../../.ai/specs/2026-10-13-sync-xero-phase-1-connect-and-contacts.md)
- Business rules: [`.ai/specs/2026-09-26-app-spec-xero-integration.md`](../../.ai/specs/2026-09-26-app-spec-xero-integration.md)

## Configuration

| Variable | Why |
|---|---|
| `APP_URL` | Base of the OAuth redirect URI `<APP_URL>/api/sync_xero/oauth/callback`. `https` in production; `http://localhost:<port>` for local testing (Xero rejects `127.0.0.1`). |
| `OM_HUB_OAUTH_STATE_KEY` or `KMS_MASTER_KEY` | Encrypts the Connect state cookie. Connect fails closed in production without one of them. |
| `CACHE_STRATEGY=redis` | Single-use Connect state across web replicas. |

The package adds no environment variable of its own and no env preset: the Client ID and Secret are entered per organization on the integration's Credentials tab.

The module ships enabled in the monorepo app. In a standalone app scaffolded by `create-mercato-app`, the package is installed but the module is commented out in `src/modules.ts`; uncomment `{ id: 'sync_xero', from: '@open-mercato/sync-xero' }` to enable it.

## Compatibility

Once released, these surfaces change only additively (see `BACKWARD_COMPATIBILITY.md`):
- the integration and module id `sync_xero` and its callback URL `/api/sync_xero/oauth/callback`, which each tenant registers in its Xero app;
- the routes under `/api/sync_xero/*` (`oauth/initiate`, `oauth/callback`, `connection`, `organisations`, `organisation`, `disconnect`, `schedules`, `companies/[id]`);
- the DI name `xeroHealthCheck`, the data-sync entity type `xero.contacts` and the widget ids `sync_xero.injection.xero-tab` and `sync_xero.injection.company-badge`;
- the Company custom fields `xero_contact_id`, `xero_tax_number` and `xero_merged_into`;
- the persisted formats: external ids `<xeroOrganisationId>:<contactId>` (addresses `…:<contactId>:<POBOX|STREET>`), the sync cursor `v: 1`, and the grant's `providerData` keys `xeroOrganisationId`, `xeroConnectionId`, `xeroOrganisationName`.

Not contracts: the test-only route `POST /api/sync_xero/test-fakes` and its actions, the `om_test_seam_` Client ID prefix, the in-process fakes and their global registry. They exist only while `OM_ENABLE_TEST_OAUTH_GRANTS` is on, which is never set in production.
