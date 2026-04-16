'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function safeNext(next: FormDataEntryValue | null): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const next = safeNext(formData.get('next'))

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    redirect(`/auth/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`)
  }
  redirect(next)
}

export async function signUpAction(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const next = safeNext(formData.get('next'))

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) {
    redirect(`/auth/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`)
  }
  redirect(`/auth/login?notice=${encodeURIComponent('Check your email to confirm, then sign in.')}&next=${encodeURIComponent(next)}`)
}

export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
