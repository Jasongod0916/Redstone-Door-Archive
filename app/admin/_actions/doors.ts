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

type RawEditablePayload = Partial<Record<EditableField, unknown>>

function coerceInt(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : null
}

function coerceString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function coerceTags(v: unknown): string[] | undefined {
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return undefined
}

function buildUpdatePatch(raw: RawEditablePayload): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const strFields: EditableField[] = ['title', 'author', 'description', 'minecraft_version', 'door_size', 'video_url']
  for (const k of strFields) {
    const v = coerceString(raw[k])
    if (v !== undefined) out[k] = v
  }
  const intFields: EditableField[] = ['block_count', 'open_ticks', 'close_ticks', 'total_ticks', 'bounds_width', 'bounds_height', 'bounds_depth']
  for (const k of intFields) {
    const v = coerceInt(raw[k])
    if (v !== undefined) out[k] = v
  }
  const tags = coerceTags(raw.tags)
  if (tags !== undefined) out.tags = tags
  return out
}

function diffFields(before: Record<string, unknown>, patch: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(patch[key])) {
      b[key] = before[key] ?? null
      a[key] = patch[key]
    }
  }
  return { before: b, after: a }
}

export async function updateDoorMeta(
  doorId: string,
  raw: DoorMetaUpdate,
): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { data: existing, error: fetchErr } = await supabase
    .from('doors')
    .select('*')
    .eq('id', doorId)
    .maybeSingle()
  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!existing) return { ok: false, error: 'not_found' }

  const patch = buildUpdatePatch(raw as RawEditablePayload)
  if (Object.keys(patch).length === 0) return { ok: true }

  const diff = diffFields(existing as Record<string, unknown>, patch)
  if (Object.keys(diff.after).length === 0) return { ok: true }

  const { error: updateErr } = await supabase.from('doors').update(patch).eq('id', doorId)
  if (updateErr) return { ok: false, error: updateErr.message }

  await logAdminAction({
    actor, action: 'door.update', targetType: 'door', targetId: doorId, details: diff,
  })

  revalidatePath('/admin/doors')
  revalidatePath(`/admin/doors/${doorId}/edit`)
  revalidatePath(`/view/${doorId}`)
  revalidatePath('/')
  return { ok: true }
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

export async function restoreDoor(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { data: existing, error: fetchErr } = await supabase
    .from('doors')
    .select('id, deleted_at')
    .eq('id', doorId)
    .maybeSingle()
  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!existing) return { ok: false, error: 'not_found' }
  if (!existing.deleted_at) return { ok: false, error: 'not_deleted' }

  const { error: updateErr } = await supabase
    .from('doors')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', doorId)
  if (updateErr) return { ok: false, error: updateErr.message }

  await logAdminAction({
    actor, action: 'door.restore', targetType: 'door', targetId: doorId,
  })

  revalidatePath('/admin/doors')
  revalidatePath('/admin/trash')
  revalidatePath(`/view/${doorId}`)
  revalidatePath('/')
  return { ok: true }
}

export async function hardDeleteDoor(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  // Gate: must already be soft-deleted. UI only shows this on Trash page,
  // but we enforce on the server too.
  const { data: existing, error: fetchErr } = await supabase
    .from('doors')
    .select('id, owner_id, deleted_at, thumbnail_url')
    .eq('id', doorId)
    .maybeSingle()
  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!existing) return { ok: false, error: 'not_found' }
  if (!existing.deleted_at) return { ok: false, error: 'not_trashed' }

  // Collect storage paths to remove.
  const { data: files } = await supabase
    .from('door_files')
    .select('storage_path')
    .eq('door_id', doorId)
  const paths: string[] = []
  for (const f of files ?? []) {
    if (f.storage_path) paths.push(f.storage_path)
  }
  // Try to remove storage first. If owner_id is known and files are under that
  // prefix, RLS will let admin_users delete (per migration policy).
  if (paths.length > 0) {
    const { error: removeErr } = await supabase.storage.from('schematics').remove(paths)
    if (removeErr) {
      await logAdminAction({
        actor, action: 'door.hard_delete_failed', targetType: 'door', targetId: doorId,
        details: { stage: 'storage', error: removeErr.message, paths },
      })
      return { ok: false, error: `storage_failed: ${removeErr.message}` }
    }
  }

  // Now delete the DB row. door_files is expected to cascade via FK.
  const { error: deleteErr } = await supabase.from('doors').delete().eq('id', doorId)
  if (deleteErr) {
    await logAdminAction({
      actor, action: 'door.hard_delete_failed', targetType: 'door', targetId: doorId,
      details: { stage: 'db', error: deleteErr.message },
    })
    return { ok: false, error: deleteErr.message }
  }

  await logAdminAction({
    actor, action: 'door.hard_delete', targetType: 'door', targetId: doorId,
    details: { filesRemoved: paths.length },
  })

  revalidatePath('/admin/trash')
  revalidatePath('/admin/doors')
  revalidatePath('/')
  return { ok: true }
}
