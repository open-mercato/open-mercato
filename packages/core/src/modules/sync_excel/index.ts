export const metadata = {
  id: 'sync_excel',
  title: 'Excel / CSV Import',
  description: 'File-upload-based CSV import foundation built on top of the data sync hub.',
  /**
   * `customers` is a HARD dependency: `lib/adapters/customers.ts` reads `E.customers.*` at module scope.
   *
   * `E` only carries a key for an ENABLED module, so with `customers` switched off that read is
   * `undefined.customer_entity` and it throws while the adapter is being imported — not inside a request, where
   * it could be traced. Declaring it has the generator refuse the combination before anybody starts the app.
   *
   * `data_sync` is the hub this is built on, named in the description and now in the manifest too.
   */
  requires: ['customers', 'data_sync'],
}

export default metadata
