import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse
  user: Record<string, unknown> | null
}> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refresh the session. Per Supabase SSR docs, this call must be the first
  // thing after createServerClient — nothing must run between them that could
  // read/write cookies, or sessions can desync and log users out at random.
  const { data } = await supabase.auth.getClaims()
  const user = (data?.claims ?? null) as Record<string, unknown> | null

  return { response, user }
}
