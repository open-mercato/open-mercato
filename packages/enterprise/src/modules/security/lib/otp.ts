import { randomInt } from 'node:crypto'
import { compare, hash } from 'bcryptjs'

const BCRYPT_COST = 10
const OTP_MIN = 0
const OTP_MAX_EXCLUSIVE = 1_000_000

export function generateOtpCode(): string {
  return String(randomInt(OTP_MIN, OTP_MAX_EXCLUSIVE)).padStart(6, '0')
}

export async function hashOtpCode(code: string): Promise<string> {
  return hash(code, BCRYPT_COST)
}

export async function verifyOtpCode(input: string, expectedHash: string): Promise<boolean> {
  return compare(input, expectedHash)
}
