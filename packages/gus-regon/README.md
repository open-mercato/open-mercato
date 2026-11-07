# @open-mercato/gus-regon

GUS REGON company lookup for [Open Mercato](https://github.com/open-mercato/open-mercato): type a Polish NIP, click **Fetch from GUS** and get the company name and registered address (plus the REGON number) from the official GUS REGON registry (BIR1.1 API).

- Works for every registered entity — including businesses outside the VAT register (not covered by MF *Wykaz*).
- Fills **empty** fields only; values typed by the operator are never overwritten.
- Fail-open: when GUS is slow or down, the form keeps working and the operator fills fields manually.
- The API key is configured per organization in **Settings → Integrations**, stored encrypted, and never reaches the browser.

Spec: [`.ai/specs/2026-10-12-gus-regon-company-lookup.md`](https://github.com/open-mercato/open-mercato/blob/develop/.ai/specs/2026-10-12-gus-regon-company-lookup.md) · User guide: [`apps/docs/docs/user-guide/gus-regon.mdx`](https://github.com/open-mercato/open-mercato/blob/develop/apps/docs/docs/user-guide/gus-regon.mdx)

## Install

The package ships with Open Mercato. In the monorepo app it is enabled in `apps/mercato/src/modules.ts`. In a standalone app created with `create-mercato-app`, uncomment it in `src/modules.ts`:

```ts
{ id: 'gus_regon', from: '@open-mercato/gus-regon' },
```

Then run `yarn generate`. No migrations are needed — the package has no entities.

## Configure

1. Go to **Settings → Integrations → GUS REGON (BIR1)**.
2. Choose the **Environment**:
   - **Test** — GUS test registry with synthetic data. The API key is optional; without one the public GUS test key is used.
   - **Production** — the real registry. Requires your own **BIR API key** (issued by GUS for the BIR1.1 API, see [api.stat.gov.pl](https://api.stat.gov.pl/Home/RegonApi)).
3. **Show on CRM company forms** — off by default. Turn it on to add the "Fetch from GUS" card to the company create and edit forms. It only takes effect once an **API key is entered** (in Test you can enter the public GUS test key `abcde12345abcde12345`); the integration page shows why the card is hidden.
4. Save and **enable** the integration. The health check logs in to BIR1 to confirm the key.

Users need the `gus_regon.lookup` feature (granted to superadmin, admin and employee by default).

## Use

When **Show on CRM company forms** is on (and an API key is set), the customers company create and edit forms show a **Fetch data from GUS REGON** card above the fields (never on person forms). Enter a NIP (spaces, dashes and a `PL` prefix are accepted) and click **Fetch from GUS**:

| GUS | Company form |
|-----|--------------|
| `Nazwa` | Legal name, display name (when empty) |
| `Ulica`, `NrNieruchomosci`, `NrLokalu`, `KodPocztowy`, `Miejscowosc`, `Wojewodztwo` | One primary address — create form only, when no address exists yet |
| `Regon` | Shown in the card ("Found: … · REGON …"); the company form has no REGON field |

## API

`GET /api/gus_regon/status` — requires `gus_regon.lookup`. Returns `{ enabled, environment, hasApiKey, lookupAvailable, companyFormsRequested, companyFormsActive }` (never the key). Widgets use it to stay hidden until the integration is usable.

`GET /api/gus_regon/lookup?nip=<nip>` — requires `gus_regon.lookup`.

| Status | Body |
|--------|------|
| 200 | `{ ok: true, company, candidates }` |
| 200 | `{ ok: false, reason: 'not_found' \| 'unavailable' \| 'not_configured' }` |
| 400 | Missing or invalid NIP, or user without an organization |
| 401 | Not authenticated |

`company`: `nip, regon, name, street, buildingNumber, flatNumber, postalCode, city, voivodeship, county, commune, type, endDate, country`.

## Use in your own forms

The CRM company forms are built in (behind the switch above). To add the same "Fetch data from GUS REGON" card to **any other CrudForm** (e.g. a supplier form in your app module), declare a widget with a field map — no React code needed:

```ts
// <your module>/widgets/injection/gus-supplier/widget.ts
import { createGusLookupWidget } from '@open-mercato/gus-regon/modules/gus_regon/components/createGusLookupWidget'

export default createGusLookupWidget({
  id: 'purchasing.injection.gus-supplier',
  nipField: 'taxId', // pre-fills the NIP input from the form
  fields: {
    name: 'name',
    regon: 'regon',
    streetLine: 'street', // "ul. Krucza 53/2"
    postalCode: 'postalCode',
    city: 'city',
    country: 'country',
  },
})
```

```ts
// <your module>/widgets/injection-table.ts
export const injectionTable = {
  'crud-form:purchasing.supplier': ['purchasing.injection.gus-supplier'],
}
```

Run `yarn generate`. Mapped fields are filled only while empty. The card renders only when the GUS integration is enabled and usable for the organization (`gate: 'lookup'`, default); use `gate: 'companyForms'` to also require the switch and an API key.

| Config | Purpose |
|--------|---------|
| `id` | Widget id, `<module>.injection.<name>` |
| `fields` | GUS value → form field id(s): `name`, `nip`, `regon`, `street`, `streetLine`, `buildingNumber`, `flatNumber`, `postalCode`, `city`, `voivodeship`, `county`, `commune`, `country` |
| `apply` | Instead of `fields`: custom `(values, company, { t }) => { values, filled }` for complex forms |
| `nipField` | Form field that pre-fills the NIP input |
| `fieldLabels` | i18n keys for field names in the success message |
| `titleKey`, `descriptionKey` | i18n keys (or plain text) for the card heading and helper text |
| `visible` | `({ pathname, operation, values }) => boolean` when a spot is shared by several forms |
| `gate` | `'lookup'` (default) or `'companyForms'` |
| `features`, `requiredModules`, `priority` | ACL, module dependencies (always includes `gus_regon`, `integrations`), ordering |

For full control, embed the panel directly and map the result yourself:

```tsx
import { GusLookupPanel } from '@open-mercato/gus-regon/modules/gus_regon/components/GusLookupPanel'

<GusLookupPanel initialNip={values.taxId} onCompany={(company) => { /* map onto your fields */ }} />
```

## Development

```bash
yarn workspace @open-mercato/gus-regon build
yarn workspace @open-mercato/gus-regon typecheck
yarn workspace @open-mercato/gus-regon test
```

Integration tests: `src/modules/gus_regon/__integration__/TC-GUS-001…005.spec.ts` (`yarn test:integration`).

## License

MIT
