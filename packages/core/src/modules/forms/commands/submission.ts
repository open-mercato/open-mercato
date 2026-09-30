/**
 * Forms module — submission lifecycle commands.
 *
 * The handlers delegate the heavy lifting to `SubmissionService`. They exist
 * so admin/UI surfaces can route through the command bus and reuse the
 * standard logging/undo/audit plumbing that other modules rely on.
 *
 * Undoability matrix (per spec):
 *   submission.start           — undoable iff no revisions yet (always at start)
 *   submission.save            — NOT undoable (append-only revision chain)
 *   submission.submit          — undoable, inverse is `submission.reopen`
 *   submission.reopen          — undoable, inverse is re-submit
 *   submission.assign_actor    — undoable, inverse is revoke
 *   submission.revoke_actor    — undoable, inverse is re-assign
 *
 * `submission.anonymize` is intentionally NOT registered here — it lands in
 * phase 2b along with the rest of the compliance machinery.
 */

import {
  registerCommand,
  type CommandHandler,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import type { AwilixContainer } from 'awilix'
import type { SubmissionService } from '../services/submission-service'

type Scope = {
  tenantId: string
  organizationId: string
}

type StartInput = Scope & {
  formKey: string
  subjectType: string
  subjectId: string
  startedBy: string
  initialRole?: string | null
}

type SaveInput = Scope & {
  submissionId: string
  baseRevisionId: string
  patch: Record<string, unknown>
  savedBy: string
  changeSummary?: string | null
  changeSource?: 'user' | 'admin' | 'system'
}

type SubmitInput = Scope & {
  submissionId: string
  baseRevisionId: string
  submittedBy: string
  submitMetadata?: Record<string, unknown> | null
}

type ReopenInput = Scope & {
  submissionId: string
  reopenedBy: string
}

type AssignActorInput = Scope & {
  submissionId: string
  userId: string
  role: string
  assignedBy: string
}

type RevokeActorInput = Scope & {
  submissionId: string
  actorId: string
  revokedBy: string
}

function resolveSubmissionService(ctx: CommandRuntimeContext): SubmissionService {
  return (ctx.container as AwilixContainer).resolve('formsSubmissionService') as SubmissionService
}

const startHandler: CommandHandler<StartInput, { submissionId: string; revisionId: string }> = {
  id: 'forms.submission.start',
  isUndoable: true,
  async execute(input, ctx) {
    const service = resolveSubmissionService(ctx)
    const view = await service.start(input)
    return { submissionId: view.submission.id, revisionId: view.revision.id }
  },
  async buildLog({ input, result }) {
    return {
      actionLabel: 'forms.submission.start',
      resourceKind: 'forms.submission',
      resourceId: result.submissionId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: {
        formKey: input.formKey,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    }
  },
}

const saveHandler: CommandHandler<SaveInput, { revisionId: string; coalesced: boolean }> = {
  id: 'forms.submission.save',
  isUndoable: false,
  async execute(input, ctx) {
    const service = resolveSubmissionService(ctx)
    const outcome = await service.save(input)
    return { revisionId: outcome.revision.id, coalesced: outcome.coalesced }
  },
  async buildLog({ input, result }) {
    return {
      actionLabel: 'forms.submission.save',
      resourceKind: 'forms.submission',
      resourceId: input.submissionId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: { coalesced: result.coalesced },
    }
  },
}

const submitHandler: CommandHandler<SubmitInput, { submissionId: string }> = {
  id: 'forms.submission.submit',
  isUndoable: true,
  async execute(input, ctx) {
    const service = resolveSubmissionService(ctx)
    const submission = await service.submit(input)
    return { submissionId: submission.id }
  },
  async buildLog({ input }) {
    return {
      actionLabel: 'forms.submission.submit',
      resourceKind: 'forms.submission',
      resourceId: input.submissionId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }
  },
}

const reopenHandler: CommandHandler<ReopenInput, { submissionId: string }> = {
  id: 'forms.submission.reopen',
  isUndoable: true,
  async execute(input, ctx) {
    const service = resolveSubmissionService(ctx)
    const submission = await service.reopen(input)
    return { submissionId: submission.id }
  },
  async buildLog({ input }) {
    return {
      actionLabel: 'forms.submission.reopen',
      resourceKind: 'forms.submission',
      resourceId: input.submissionId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }
  },
}

const assignActorHandler: CommandHandler<AssignActorInput, { actorId: string }> = {
  id: 'forms.submission.assign_actor',
  isUndoable: true,
  async execute(input, ctx) {
    const service = resolveSubmissionService(ctx)
    const actor = await service.assignActor(input)
    return { actorId: actor.id }
  },
  async buildLog({ input, result }) {
    return {
      actionLabel: 'forms.submission.assign_actor',
      resourceKind: 'forms.submission',
      resourceId: input.submissionId,
      relatedResourceKind: 'forms.submission_actor',
      relatedResourceId: result.actorId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: { userId: input.userId, role: input.role },
    }
  },
}

const revokeActorHandler: CommandHandler<RevokeActorInput, { ok: true }> = {
  id: 'forms.submission.revoke_actor',
  isUndoable: true,
  async execute(input, ctx) {
    const service = resolveSubmissionService(ctx)
    await service.revokeActor(input)
    return { ok: true }
  },
  async buildLog({ input }) {
    return {
      actionLabel: 'forms.submission.revoke_actor',
      resourceKind: 'forms.submission',
      resourceId: input.submissionId,
      relatedResourceKind: 'forms.submission_actor',
      relatedResourceId: input.actorId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }
  },
}

let registered = false
export function registerSubmissionCommands(): void {
  if (registered) return
  registered = true
  registerCommand(startHandler)
  registerCommand(saveHandler)
  registerCommand(submitHandler)
  registerCommand(reopenHandler)
  registerCommand(assignActorHandler)
  registerCommand(revokeActorHandler)
}

// Eagerly register at module load — keeps command IDs discoverable as soon as
// the forms module is imported (mirrors the customers module pattern).
registerSubmissionCommands()
