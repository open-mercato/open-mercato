# TC-SEC-015: Feature-gated product injection widgets

Regression coverage for #4398 and #3946. The current SEO widget requires
`catalog.products.manage`; the historical `catalog.products.edit` permission no
longer applies. The test creates its own product, role, and restricted employee
through shared API fixtures and removes them in `finally`.

| Actor | Expected result |
| --- | --- |
| Admin with `catalog.products.manage` | The product edit form displays Product SEO Helper. A short title triggers SEO validation and no product update request. |
| Restricted employee with only `catalog.products.view` | The same product form renders without a crash, error banner, or SEO widget in the DOM. A short-title save reaches the real product API and receives 403 without the SEO validation message. |

The denied request is intentional: the product mutation and widget share the
same permission. Reaching the server proves the hidden widget's `onBeforeSave`
handler did not block submission, while the server still enforces write access.

Run from the repository root with Docker available:

```bash
OM_INTEGRATION_MODULES=catalog yarn test:integration:ephemeral TC-SEC-015
```

The repository CLI provisions an isolated application/database or reuses a
healthy matching ephemeral environment. No seeded product or employee ACL is
required.
