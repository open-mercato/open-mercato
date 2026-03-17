export enum MfaMethodType {
  TOTP = 'totp',
  OTP_EMAIL = 'otp_email',
  PASSKEY = 'passkey',
}

export enum EnforcementScope {
  PLATFORM = 'platform',
  TENANT = 'tenant',
  ORGANISATION = 'organisation',
}

export enum ChallengeMethod {
  AUTO = 'auto',
  PASSWORD = 'password',
  MFA = 'mfa',
}

export enum SudoChallengeMethodUsed {
  PASSWORD = 'password',
  TOTP = 'totp',
  PASSKEY = 'passkey',
  OTP_EMAIL = 'otp_email',
}
