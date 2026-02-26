<!--
Please ensure this pull request targets the `develop` branch.
Checking the CLA box below confirms you accept the terms in docs/cla.md.
-->

## Summary

This PR introduces a comprehensive `messages` module in `@open-mercato/core` that provides tenant-scoped internal messaging with inbox/sent/draft workflows, threaded conversations, object/file attachments, actionable messages, and optional email delivery with secure token-based access links.

The implementation includes end-to-end backend APIs, backend/frontend pages, shared UI primitives in `@open-mercato/ui`, extensibility registries for message and object types, queue-based email delivery, and broad automated test coverage.

## Changes

### New Module: `messages`

- Added full module structure in `packages/core/src/modules/messages/` including `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, notifications integration, validators, entities, migrations, subscribers, workers, and i18n files.

### Core Domain and Data Model

- Implemented tenant-aware messaging entities:
- `messages`
- `message_recipients`
- `message_objects`
- `message_access_tokens`
- `message_confirmations`
- Added migrations in `packages/core/src/modules/messages/migrations/`.
- Added zod validation and typed request/response contracts in `packages/core/src/modules/messages/data/validators.ts` and `packages/core/src/modules/messages/api/openapi.ts`.

### Extensibility Registries

- Added module-extensible message type registry:
- `packages/core/src/modules/messages/message-types.ts`
- `packages/core/src/modules/messages/lib/message-types-registry.ts`
- Added module-extensible message object type registry:
- `packages/core/src/modules/messages/message-objects.ts`
- `packages/core/src/modules/messages/lib/message-objects-registry.ts`
- Added UI component mapping support for message type renderers and actions.

### API Surface (`/api/messages`)

- Implemented routes with OpenAPI exports for:
- Listing and composing/sending messages (`GET/POST /api/messages`)
- Message detail/update/delete (`GET/PATCH/DELETE /api/messages/[id]`)
- Reply/forward (`POST /api/messages/[id]/reply`, `POST /api/messages/[id]/forward`)
- Read/unread and archive/unarchive (`PUT/DELETE /read`, `PUT/DELETE /archive`)
- Message action execution (`POST /api/messages/[id]/actions/[actionId]`)
- Confirmation status (`GET /api/messages/[id]/confirmation`)
- Attachment link/unlink/list (`GET/POST/DELETE /api/messages/[id]/attachments`)
- Unread counter (`GET /api/messages/unread-count`)
- Type/object discovery (`GET /api/messages/types`, `GET /api/messages/object-types`, `GET /api/messages/object-options`)
- Token-based access (`GET /api/messages/token/[token]`)

### Email Delivery and Queue Processing

- Added `MessageEmail` template (`packages/core/src/modules/messages/emails/MessageEmail.tsx`).
- Added email sender helpers in `packages/core/src/modules/messages/lib/email-sender.ts`.
- Added async worker for email delivery in `packages/core/src/modules/messages/workers/send-email.worker.ts`.
- Added token-based message access route for secure email deep links.

### Notifications, Events, and Actions

- Added recipient notification subscriber (`packages/core/src/modules/messages/subscribers/message-notification.ts`).
- Added typed module events:
- `messages.sent`
- `messages.action.taken`
- Added action execution safeguards (single execution and expiration checks).

### Access Control and Setup

- Added module ACL features:
- `messages.view`
- `messages.compose`
- `messages.attach`
- `messages.attach_files`
- `messages.email`
- `messages.actions`
- `messages.manage`
- Added default role feature seeding in `packages/core/src/modules/messages/setup.ts`.

### UI and Page Integration

- Added backend pages:
- `/backend/messages`
- `/backend/messages/compose`
- `/backend/messages/[id]`
- Added frontend token page:
- `/messages/view/[token]`
- Added reusable UI components/hooks in `packages/ui/src/backend/messages/`:
- `MessageComposer`
- `MessagesIcon`
- `MessageAttachmentPicker`
- `ObjectAttachmentPicker`
- `MessageObjectRecordPicker`
- `useMessagesPoll`
- Added message detail/list clients and default renderers under `packages/core/src/modules/messages/components/`.

### Module Integrations and Docs

- Added integration points for staff leave request messaging (`packages/core/src/modules/staff/message-types.ts`, `packages/core/src/modules/staff/message-objects.ts`, and staff preview/detail components).
- Added framework documentation in `apps/docs/docs/framework/modules/messages.mdx`.

### Tests

- Added/updated tests across:
- Validators and schemas
- API routes (including token/object/action/confirmation/unread flows)
- Message and object registries
- Actions, attachments, object validation, email sender helpers
- Notification subscriber behavior
- Email worker behavior
- UI composer behavior in `packages/ui/src/backend/messages/__tests__/MessageComposer.test.tsx`

## Specification

<!-- We follow spec-driven development. Please check if a spec exists and update it accordingly. -->

**Does a spec exist for this feature/module?**
- [x] Yes
- [ ] No (created a new spec)
- [ ] N/A (minor change, no spec needed)

**Spec file path:**
.ai/specs/SPEC-002-2026-01-23-messages-module.md


## Testing

### Automated Testing

```bash
yarn test
```

### Build Validation

```bash
yarn workspace @open-mercato/app build
```

## Checklist

- [x] This pull request targets `develop`.
- [x] I have read and accept the Open Mercato Contributor License Agreement (see `docs/cla.md`).
- [x] I updated documentation, locales, or generators if the change requires it.
- [x] I added or adjusted tests that cover the change.
- [x] I created or updated the spec in `.ai/specs/` with a changelog entry (if applicable).

## Linked issues

- N/A
