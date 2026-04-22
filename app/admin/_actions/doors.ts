'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/guard'
import { logAdminAction } from '@/lib/admin/audit'

export type ActionResult = { ok: true } | { ok: false, error: string }

// NOTE: `doors` table has NO door_width / door_height columns — only a single
// `door_size` text column (e.g. "3x3"). Upload combines two inputs into that
// string before insert; admin edit keeps the single-field form.
const EDITABLE_FIELDS = [
  'title', 'author', 'description', 'tags', 'minecraft_version',
  'door_size',
  'block_count', 'open_ticks', 'close_ticks', 'total_ticks',
  'bounds_width', 'bounds_height', 'bounds_depth',
  'video_url',
] as const
type EditableField = typeof EDITABLE_FIELDS[number]

export type DoorMetaUpdate = Partial<Record<EditableField, string | number | string[] | null>>

export async function updateDoorMeta(
  _doorId: string,
  _fields: DoorMetaUpdate,
): Promise<ActionResult> {
  await requireAdmin()
  // Task 7 fills this in.
  throw new Error('updateDoorMeta: not implemented')
}

export async function softDeleteDoor(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { data: existing, error: fetchErr } = await supabase
    .from('doors')
    .select('id, deleted_at')
    .eq('id', doorId)
    .maybeSingle()
  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!existing) return { ok: false, error: 'not_found' }
  if (existing.deleted_at) return { ok: false, error: 'already_deleted' }

  const { error: updateErr } = await supabase
    .from('doors')
    .update({ deleted_at: new Date().toISOString(), deleted_by: actor.id })
    .eq('id', doorId)
  if (updateErr) return { ok: false, error: updateErr.message }

  await logAdminAction({
    actor, action: 'door.soft_delete', targetType: 'door', targetId: doorId,
  })

  revalidatePath('/admin/doors')
  revalidatePath('/admin/trash')
  revalidatePath(`/view/${doorId}`)
  revalidatePath('/')
  return { ok: true }
}

export async function restoreDoor(_doorId: string): Promise<ActionResult> {
  await requireAdmin()
  // Task 8 fills this in.
  throw new Error('restoreDoor: not implemented')
}

export async function hardDeleteDoor(_doorId: string): Promise<ActionResult> {
  await requireAdmin()
  // Task 8 fills this in.
  throw new Error('hardDeleteDoor: not implemented')
}
