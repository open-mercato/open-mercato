export const PROFILE_PASSWORD_PROOF = Symbol('auth.profile.passwordProof')

export type ProfilePasswordProof = {
  userId: string
  passwordHash: string
}
