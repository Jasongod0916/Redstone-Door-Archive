'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/guard'
import { logAdminAction } from '@/lib/admin/audit'

export type ActionResult = { ok: true; count: number } | { ok: false; error: string }

export async function cleanupOrphans(paths: string[]): Promise<ActionResult> {
  const actor = await requireAdmin()
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'no_paths' }
  }
  if (paths.length > 100) {
    return { ok: false, error: 'too_many' }
  }

  const supabase = await createClient()
  const { error } = await supabase.storage.from('schematics').remove(paths)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor,
    action: 'storage.orphan_cleanup',
    targetType: 'storage',
    targetId: paths[0],
    details: { count: paths.length, paths },
  })

  revalidatePath('/admin/storage')
  revalidatePath('/admin')
  return { ok: true, count: paths.length }
}
