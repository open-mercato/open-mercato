# Step 1 — Gather Requirements & Scaffold Structure

## 1. Gather Requirements

Before writing any code, ask the developer:

1. **Module name** — plural, snake_case (e.g., `tickets`, `fleet_vehicles`, `loyalty_points`)
2. **Primary entity name** — singular (e.g., `ticket`, `fleet_vehicle`, `loyalty_point`)
3. **Key fields** — beyond standard columns, what data does this entity store?
4. **Relationships** — does it reference entities from other modules? (FK IDs only, no ORM relations)
5. **Features needed**:
   - [ ] CRUD API (almost always yes)
   - [ ] Backend admin pages (almost always yes)
   - [ ] Frontend public pages
   - [ ] Search indexing
   - [ ] Event publishing
   - [ ] Background workers
   - [ ] CLI commands
   - [ ] Custom fields support
   - [ ] **Sensitive / GDPR-relevant fields** (PII, contact info, addresses, free-text notes about people, integration credentials, secrets) — if yes, an `encryption.ts` declaring `defaultEncryptionMaps` is mandatory; see [step-6-optional-features.md](step-6-optional-features.md) → Encryption maps

If the developer provides a brief description, infer reasonable defaults and confirm. When key fields include names, emails, phones, addresses, free-text comments, or external API keys, treat the encryption checkbox as `yes` by default and confirm with the user rather than skipping it silently.

---

## 2. Scaffold Structure

Create the directory tree under `src/modules/<module_id>/`:

```
src/modules/<module_id>/
├── index.ts                    # Module metadata + feature exports
├── acl.ts                      # Feature-based permissions
├── setup.ts                    # Tenant init, role features
├── di.ts                       # Awilix DI registrations
├── events.ts                   # Typed event declarations (if needed)
├── encryption.ts               # Tenant data encryption maps (only if entity has sensitive/GDPR fields)
├── data/
│   ├── entities.ts             # MikroORM entity classes
│   └── validators.ts           # Zod validation schemas
├── api/
│   └── <entities>/
│       └── route.ts            # All HTTP methods in one file: GET, POST, PUT, DELETE
└── backend/
    ├── page.tsx                # List page → /backend/<module>
    ├── <entities>/
    │   ├── new.tsx             # Create page → /backend/<module>/<entities>/new
    │   └── [id].tsx            # Edit page → /backend/<module>/<entities>/<id>
```
