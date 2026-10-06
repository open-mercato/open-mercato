# DAM module (Media): folder tree, assets over attachments, folder-level RBAC, trash, bulk ops

- Date: 2026-10-06
- Category: feature
- Priority signal: medium — partner-driven need (sales enablement materials); first step of an Asset Data Management module class
- Risk signal: medium — new module with new tables and record-level (folder) ACL; layered over the stable `attachmentService` contract, no changes to existing contract surfaces expected
- Routing: Next: om-auto-write-spec "DAM module (Media): folder tree, assets over attachments, folder-level RBAC, trash, bulk ops — brief: .ai/specs/briefs/2026-10-06-dam-module.md"

## Problem

Sales reps need one organized place for amorphous marketing and offer materials (images, PDFs, office files, text notes). Today Open Mercato only has the flat `attachments` library: no folder hierarchy, no asset title/description, no per-folder access control. The module is named **DAM** in code, UI and docs; this is the first, deliberately small step of a module of the Asset Data Management class. The architecture must let DAM later become the central document-management point other Open Mercato modules integrate with — via a stable asset id referenced by FK-id, widget injection and response enrichers (no direct ORM relations). Evidence: a partner (Univio) requirement; no usage numbers yet.

## Agreed direction

- A **new, separate module `dam`** (nav group `Media`, next to the attachments library) layered over the attachments module. DAM owns folders, asset records, grants and trash; bytes, storage drivers, quota, file security, thumbnails and text extraction stay in `attachments`, used only through the public `attachmentService` DI contract (`readUploadForm`, `releaseScoped`, etc.) on a dedicated `dam` partition. Never read `Attachment` entities or construct storage drivers directly.
- Rejected alternatives:
  - **Extend `attachments`** — it is a contract surface consumed by many modules (catalog, messages, sync_excel, …); folders/ACL there would widen a frozen-ish surface.
  - **Extend `documents`** (`packages/documents`, has folders + per-document sharing) — different domain: collaborative authoring of rich-text documents (TipTap/Yjs, sidecar, content versions) vs. storing finished files. Merging would tangle responsibilities. DAM instead *links* documents (Phase 5).
  - **Build nothing / tags as virtual folders** — no real hierarchy, no title/description, no folder-level access control; does not meet the need.
- **Folder hierarchy** is DAM's own implementation (`dam/lib/folderHierarchy.ts`), following the platform's existing pattern (`parent_id` + denormalized `tree_path`, `depth`, `ancestor_ids`, `descendant_ids`, as in `directory/lib/hierarchy.ts` and `catalog/lib/categoryHierarchy.ts`) — a pattern copy, **no import** from `directory` or `catalog`. A generic tree helper in `shared` is a separate refactor, out of scope.
- **Folder permission model** follows the principal shape used by `documents` (user | role principals, tiered levels) but is DAM's own code, applied to folders with downward inheritance.

## Phasing (the agreed delivery scope)

| Phase | Scope |
|-------|-------|
| P1 | Module scaffold, folder tree (CRUD, move), asset upload via `attachmentService`, file-type allowlist + magic-byte validation, thumbnails, technical metadata extraction, `name`/`title`/`description`/tags, business metadata via custom fields, list + grid views, folder stats, strict naming rules, flat module-level RBAC (`dam.view`, `dam.manage`, `dam.admin`), optimistic locking |
| P2 | Folder-level RBAC: grants, inheritance, break-inheritance, effective-permission aggregation, applied to every read path |
| P3 | Trash: move-to-trash, restore with conflict handling, manual empty, scheduled auto-purge, physical byte deletion |
| P4 | Bulk operations (multi-file upload with progress, bulk move/tag/trash) and in-module, ACL-filtered search |
| P5 | Links to `documents` records placed in DAM folders (soft-optional integration) |

## Resolved unknowns

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| Module name / terminology | `dam`; the term "DAM" everywhere (not "Micro DAM" — that only described the starting scale) |
| Placement in navigation | Backend nav group `Media` (the group already used by the attachments library) |
| Relation to existing attachments | DAM assets are stored as attachments on a dedicated `dam` partition through `attachmentService`. DAM does **not** import or show pre-existing attachments from other modules — it manages only assets uploaded through DAM (keeps ownership, ACL and lifecycle unambiguous) |
| Allowed file types | Images: JPG, PNG, WebP, GIF, BMP, TIFF. Documents: PDF, TXT. Office: DOCX, XLSX, PPTX (already recognized by `attachments/lib/security.ts`). **No SVG** (active content / XSS). Type validated by magic bytes, not only extension |
| Thumbnails | Images: existing `sharp` pipeline + thumbnail cache from attachments. PDF: first page rasterized with the existing pdfjs/canvas path (`attachments/lib/pdfProcessing.ts`). TXT and Office: file-type icon (no thumbnail; Office thumbnails need a converter → separate future spec) |
| File size / quota | Use the platform's existing configuration only: `OM_ATTACHMENT_MAX_UPLOAD_MB` (default 25 MB per file) and `OM_ATTACHMENT_TENANT_QUOTA_MB` (default 512 MB per tenant). No DAM-specific limits |
| Asset descriptive fields | `name` (strict, file-system-safe, includes extension), `title` (free human-readable display label, optional), `description` (free text), tags |
| Technical metadata | Auto-extracted, read-only: MIME type, size, image dimensions, PDF page count, EXIF where available |
| Business metadata | Platform custom fields (`ce.ts`) on the DAM asset entity; one tenant-wide field set; **no** per-folder or per-type schemas |
| Naming rules (future WebDAV-ready) | Folders and assets share one namespace per parent folder; uniqueness is **case-insensitive** within a folder; allowed: Unicode letters, digits, space, `-`, `_`, `.`, `(`, `)`; forbidden: `/ \ : * ? " < > |` and control chars; no leading `.`, no trailing space or `.`; max 255 chars; Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`) rejected; an asset's extension is fixed to its file type and cannot be changed by rename |
| Name conflicts on upload | Default name derived from the normalized file name; on conflict the UI suggests a `(1)`-style suffix the user accepts or edits. Duplicates are never persisted |
| Views | Folder tree + content pane with list and grid toggle |
| Folder stats | Asset count and total size, both "this folder only" and "including subfolders"; computed only over items the current user can see |
| Move | Drag & drop and "Move to…" action, for assets and folders; requires `editor` on both source and target |
| Module-level RBAC | `dam.view` gates entry to the module; superadmin and `dam.admin` see and manage everything |
| Folder-level RBAC principals | Role and individual user |
| Folder-level RBAC levels | `viewer` (browse, download), `editor` (upload, edit metadata, move, trash), `manager` (editor + create/delete subfolders + manage grants) |
| Inheritance | Subfolders inherit the parent's grants; grants can be **added** on a subfolder; inheritance can be **broken** on a subfolder (parent grants are copied as the starting point, then editable). No deny rules — grants only. Effective access = grants from the nearest broken-inheritance ancestor (or root) downward |
| Default visibility of a new root folder | Visible only to its creator (as `manager`) and admins until grants are added |
| Effective-permission aggregation (riskiest part) | The spec MUST design a dedicated aggregation of effective permissions (e.g. a denormalized effective-grants table or equivalent) that every list, search, stats and trash query uses, plus its invalidation/rebuild on grant change, break/restore inheritance, folder move/re-parent and principal (role membership) changes |
| How effective permissions are kept current | Hybrid, reusing existing platform mechanisms (no custom queues/polling): **(1) DAM-internal changes** (grant add/remove, break/restore inheritance, folder move/re-parent) recompute effective permissions **synchronously inside the DAM command, in the same transaction**, scoped to the affected subtree via `descendant_ids` — same pattern as `catalog/commands/categories.ts` → `rebuildCategoryHierarchyForOrganization` and `directory/commands/organizations.ts` → `rebuildHierarchyForTenant`; no window where a revoked/moved folder stays visible. **(2) External principal changes** (user loses a role, role deleted, user deactivated) are handled by an idempotent **persistent event subscriber** (`@open-mercato/events`, `persistent: true`) on `auth.*` events that recomputes the affected principal's rows; reads stay **fail-closed** meanwhile — a role-based grant only applies if the user's role membership is still active at read time. **(3) Reconcile**: a nightly idempotent **queue worker** (`@open-mercato/queue`, respecting the DB connection budget) triggered by `@open-mercato/scheduler` rebuilds the table per tenant and repairs drift. The same scheduler drives trash auto-purge (P3). The spec MUST verify whether `auth` emits an event on user↔role assignment changes (`user_roles`); `auth.user.updated` exists but coverage of role membership is unconfirmed — if missing, an **additive** `auth` event is required and must be called out as a contract change |
| Search | Inside the DAM module only — over name, title, description, tags and type — ACL-filtered. DAM assets are **not** fed into the platform's global search index (it has no record-level result ACL filtering; same reason `documents` disabled global search) |
| Delete / trash | Delete moves items to trash (`trashed_at`), restorable. One trash per organization; a user sees trashed items from folders where they hold at least `editor`. Restore and empty require `manager` at the origin or `dam.admin` |
| Restore conflicts | Restore to the original folder; if it is itself trashed or the name is now taken, the user picks a target folder and/or renames |
| Purge | Manual "empty trash" or automatic after N days (default 30, configurable). Purge sets `deleted_at` on the DAM record (kept for audit, invisible everywhere in UI/API) **and physically deletes the file bytes** via `attachmentService.releaseScoped()` (commit DB removal first, provider cleanup after commit), releasing quota |
| Versioning | None; replacing an asset's file overwrites it |
| Bulk operations | Multi-file upload with progress; bulk move, bulk tag, bulk trash. No ZIP download |
| Optimistic locking | Default ON for every user-editable DAM entity (`updated_at`, `updatedAt` in responses, CrudForm/`buildOptimisticLockHeader`) |
| Documents integration (P5) | A DAM folder can contain **links** to `documents` records. Soft-optional: when the `documents` package/module is absent the feature is disabled and DAM works unchanged. Viewing a link requires both DAM folder access and access to the document under `documents`' own permissions. A link occupies a name in the folder namespace; no bytes are copied |
| Future integrations | Architecture must allow other modules to reference DAM assets (stable asset id via FK-id + snapshot, widget injection, response enrichers, events) |

## Non-goals

- SVG support (needs sanitization — later).
- Thumbnails/previews for Office files (needs a converter dependency — separate spec).
- File versioning, ZIP download, WebDAV itself (naming only prepares for it).
- Per-folder or per-type metadata schemas.
- Feeding DAM into the platform global search index.
- Importing or displaying pre-existing attachments from other modules (ownership/ACL would be ambiguous).
- Concrete examples of integrations with other modules in the spec/docs, other than the explicitly required `documents` link (P5). Keep the integration story at the level of mechanics (asset id, FK-id, widgets, enrichers, events) — named examples add noise and invite scope creep.
- Extracting a shared tree library into `shared` or refactoring `directory`/`catalog` hierarchies.
- Changes to the `attachments` or `documents` modules beyond consuming their public contracts (if a gap is found, the spec must call it out explicitly as an additive seam).

## Affected areas (if known)

- New module `dam` (location per platform conventions — core module or dedicated workspace package; spec decides), nav group `Media`.
- Consumes `attachmentService` (`packages/core/src/modules/attachments`, public DI contract) on a new `dam` partition; reuses its thumbnail, pdfjs rasterization, text-extraction and security helpers only through public surfaces.
- Custom fields (`ce.ts`) for business metadata.
- Soft-optional coupling to `packages/documents` (P5) per `core` → Cross-Module Coupling.
- `@open-mercato/queue` workers + `@open-mercato/scheduler` for trash auto-purge and nightly effective-permission reconcile.
- `@open-mercato/events` persistent subscriber on `auth.*` events; possibly an additive `auth` event for role-membership changes.
