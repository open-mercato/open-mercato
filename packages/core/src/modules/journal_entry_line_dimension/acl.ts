// No UI, no API route — nothing to gate in Phase 1. The write command is
// called by other modules' own backend logic (never directly by a person
// through a screen or a raw HTTP call), and reads are a direct entity query
// by trusted hard-dependency code, not an exposed endpoint. See the spec's
// Design Decisions, "No ACL features, no API routes, no backend pages in
// Phase 1." Paired with `setup.ts`'s empty `defaultRoleFeatures.admin: []`
// per `packages/core/AGENTS.md`'s acl.ts/setup.ts convention — revisit both
// together once a real admin need appears (e.g. a "list every line tagged
// with cost centre X" reporting screen, tracked in Out of Scope).
export const features = []

export default features
