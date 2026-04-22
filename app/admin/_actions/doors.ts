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

export async function softDeleteDoor(_doorId: string): Promise<ActionResult> {
  await requireAdmin()
  // Task 6 fills this in.
  throw new Error('softDeleteDoor: not implemented')
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
