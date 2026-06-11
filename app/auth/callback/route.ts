import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const nextParam = searchParams.get('next') ?? '/'
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/'
  const supabase = await createClient()

  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return NextResponse.redirect(
      `${origin}/auth/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`,
    )
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return NextResponse.redirect(
      `${origin}/auth/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`,
    )
  }

  return NextResponse.redirect(`${origin}/auth/login`)
}

function isEmailOtpType(
  type: string | null,
): type is 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email' {
  return (
    type === 'signup' ||
    type === 'invite' ||
    type === 'magiclink' ||
    type === 'recovery' ||
    type === 'email_change' ||
    type === 'email'
  )
}
