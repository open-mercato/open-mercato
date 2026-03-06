export function generateOtpCode(): string {
  return '000000'
}

export async function hashOtpCode(code: string): Promise<string> {
  return code
}

export async function verifyOtpCode(input: string, expectedHash: string): Promise<boolean> {
  return input === expectedHash
}
