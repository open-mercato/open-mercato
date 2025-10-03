# Field Registry

Modules can register new custom-field kinds that provide:
- A form input component used by CrudForm (for values or sidecar UIs like attachments)
- A definition editor component rendered in the field definitions page

Registry API:
- `FieldRegistry.register(kind, { input, defEditor })`
- `FieldRegistry.getInput(kind)`
- `FieldRegistry.getDefEditor(kind)`
- The UI loads `packages/ui/src/backend/fields/registry.generated.ts` which imports registrations from modules.

Attachments example (built-in module):
- Kind: `attachment`
- Input: upload files for a saved record; lists existing attachments
- Def editor: `maxAttachmentSizeMb`, `acceptExtensions`
- APIs:
  - `POST /api/attachments` (multipart)
  - `GET /api/attachments?entityId=<id>&recordId=<id>`

Implementation files:
- Registry: `packages/ui/src/backend/fields/registry.ts`
- Generated loader: `packages/ui/src/backend/fields/registry.generated.ts`
- Attachments UI: `packages/core/src/modules/attachments/fields/attachment.tsx`
