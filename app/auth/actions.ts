'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUrl } from '@/lib/app-url'

function safeNext(next: FormDataEntryValue | null): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}

function cleanEmail(email: FormDataEntryValue | null): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('rate limit')) {
    return 'Email sending is temporarily rate limited. Wait a few minutes, then try again.'
  }
  if (lower.includes('invalid login credentials')) {
    return 'The email or password is incorrect.'
  }
  return message
}

function authLoginPath({
  mode,
  next,
  email,
  error,
  notice,
}: {
  mode: 'signin' | 'signup'
  next: string
  email?: string
  error?: string
  notice?: string
}) {
  const params = new URLSearchParams({ mode, next })
  if (email) params.set('email', email)
  if (error) params.set('error', friendlyAuthError(error))
  if (notice) params.set('notice', notice)
  return `/auth/login?${params.toString()}`
}

export async function signInAction(formData: FormData) {
  const email = cleanEmail(formData.get('email'))
  const password = String(formData.get('password') ?? '')
  const next = safeNext(formData.get('next'))

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    redirect(authLoginPath({ mode: 'signin', next, email, error: error.message }))
  }
  redirect(next)
}

export async function signUpAction(formData: FormData) {
  const email = cleanEmail(formData.get('email'))
  const password = String(formData.get('password') ?? '')
  const next = safeNext(formData.get('next'))
  const emailRedirectTo = `${getAppUrl()}/auth/callback?next=${encodeURIComponent(next)}`

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  })
  if (error) {
    redirect(authLoginPath({ mode: 'signup', next, email, error: error.message }))
  }
  redirect(
    authLoginPath({
      mode: 'signin',
      next,
      email,
      notice: 'Account created. Check your email to confirm, then sign in.',
    }),
  )
}

export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
