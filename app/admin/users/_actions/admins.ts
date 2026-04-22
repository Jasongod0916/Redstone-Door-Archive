'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/guard'
import { logAdminAction } from '@/lib/admin/audit'

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function promoteAdmin(targetUserId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { error } = await supabase.rpc('promote_admin', {
    target_user_id: targetUserId,
  })
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor,
    action: 'admin.promote',
    targetType: 'user',
    targetId: targetUserId,
  })

  revalidatePath('/admin/users')
  revalidatePath('/admin')
  return { ok: true }
}

export async function demoteAdmin(targetUserId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { error } = await supabase.rpc('demote_admin', {
    target_user_id: targetUserId,
  })
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor,
    action: 'admin.demote',
    targetType: 'user',
    targetId: targetUserId,
    details: { selfDemote: actor.id === targetUserId },
  })

  revalidatePath('/admin/users')
  revalidatePath('/admin')
  return { ok: true }
}
