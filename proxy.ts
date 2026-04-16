import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PROTECTED_PREFIXES = ['/upload', '/admin']

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request)

  if (isProtected(request.nextUrl.pathname) && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // Run on everything except static assets and the vendored UMD bundle.
    '/((?!_next/static|_next/image|favicon.ico|vendor/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
