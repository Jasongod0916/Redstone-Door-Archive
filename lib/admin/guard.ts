import { notFound, redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export type AdminUser = User

async function tryBootstrap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  _user: User,
): Promise<boolean> {
  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim()
  if (!bootstrapEmail) return false
  // The bootstrap function is SECURITY DEFINER; it rechecks email, emptiness,
  // and session identity server-side. We only pass the env-var email through.
  const { data, error } = await supabase.rpc('bootstrap_admin', {
    bootstrap_email: bootstrapEmail,
  })
  if (error) return false
  return data === true
}

async function isMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return false
  return data != null
}

export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  return isMember(supabase, user.id)
}

/**
 * Gate for admin-only Server Components and Server Actions.
 * - Not signed in → redirect to /auth/login
 * - Signed in but not admin → try one-shot bootstrap, else 404
 */
export async function requireAdmin(nextPath?: string): Promise<AdminUser> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const next = nextPath ?? '/admin'
    redirect(`/auth/login?next=${encodeURIComponent(next)}`)
  }
  if (await isMember(supabase, user.id)) return user
  if (await tryBootstrap(supabase, user)) return user
  notFound()
}
