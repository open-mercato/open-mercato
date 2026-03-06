import { NextResponse } from 'next/server'

export function requireSudo(): Response {
  return NextResponse.json({ error: 'Sudo challenge is not implemented yet' }, { status: 501 })
}
