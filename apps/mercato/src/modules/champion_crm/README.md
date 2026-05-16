# Champion CRM

Champion CRM is an app-local module for real-estate lead intake and sales qualification.

Slice 0 + Slice 1 provide:

- Module metadata, ACL, setup, events, search, translations, and an optional AI adapter type.
- Owned domain tables for leads, contacts, deals, investments, apartments, activities, consent events, and audit events.
- Lead intake at `/api/champion-crm/intake`.
- Lead CRUD/list endpoint at `/api/champion-crm/leads`.
- Lightweight backend shells at `/backend/champion-crm/leads` and `/backend/champion-crm/leads/[id]`.

The module uses core customers only as a design reference. It does not import or write core customer entities.

Migration note: `migrations/Migration20260516090000_champion_crm.ts` is hand-authored for this slice. Regenerate with `yarn db:generate` once the module is active in the target environment if the ORM snapshot needs to be refreshed.

