/**
 * The tenant and organization a query is answered within.
 *
 * Its own file, and that is the whole point: it used to live in `subject-document.ts`, which imports the score
 * ledger and the survey reader — and both of those need this type, so both imported it back. Type-only imports
 * are erased at runtime, so nothing broke, but the module graph carried two cycles and a dependency scan is
 * right to object: the next person to need a VALUE from `subject-document.ts` in either file would turn a
 * harmless cycle into a real one.
 *
 * Nothing else belongs here. A file that exists to break a cycle stops working the moment it grows reasons of
 * its own to import something.
 */
export type SubjectScope = { tenantId: string; organizationId: string }
