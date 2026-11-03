/**
 * Portal subject policy (#7224).
 *
 * A portal customer may start a submission, and finalize a submission they
 * started themselves, only for the subject that identifies them: the
 * `customer` subject whose id is their own customer user id (`auth.sub`).
 * Any other pair is refused before anything is persisted, because the
 * subject is what the consent projector attributes signatures to.
 *
 * A submission started by someone else reached the caller through a staff
 * actor assignment (`forms.submissions.manage`), so staff already vouched for
 * that pairing and the submit is not re-checked here. Token (invitation)
 * principals carry a server-derived subject and are out of scope.
 *
 * The start route applies `isPortalSubjectAllowed` before anything is
 * persisted; `SubmissionService.submit()` applies `isPortalSubmitAllowed`
 * inside its locked transaction when the caller is a portal customer.
 */

export const PORTAL_SUBJECT_TYPE = 'customer'

export type PortalSubject = {
  subjectType: string
  subjectId: string
}

export type PortalSubmissionSubject = PortalSubject & {
  startedBy: string
}

function isSameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

export function isPortalSubjectAllowed(customerUserId: string, subject: PortalSubject): boolean {
  return subject.subjectType === PORTAL_SUBJECT_TYPE && isSameId(subject.subjectId, customerUserId)
}

export function isPortalSubmitAllowed(customerUserId: string, submission: PortalSubmissionSubject): boolean {
  if (!isSameId(submission.startedBy, customerUserId)) return true
  return isPortalSubjectAllowed(customerUserId, submission)
}
