# Editable Extension Round Trip

Load this reference for app fields/actions added to installed UI/data.

1. Define app-owned storage or an existing host-supported custom field; keep full scope and locking.
2. Add an enricher/detail read that returns a stable typed value, including explicit null.
3. Inject a typed field/control into the exact CrudForm/DataTable host.
4. Intercept/guard/dispatch the write through a command; validate scope/features/version and support clear-to-null.
5. Invalidate the owning data/cache/search projections after commit.
6. Map response data into initial values without truthy defaults.
7. Test create or first save, reload, edit, clear, stale version, denied/wildcard ACL, and host absence.

Do not stop after rendering the field. A visible input without read and durable write paths is incomplete.
