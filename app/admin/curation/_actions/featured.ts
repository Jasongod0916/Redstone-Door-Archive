'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/guard'
import { logAdminAction } from '@/lib/admin/audit'

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function featureDoor(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { data: maxRow, error: maxErr } = await supabase
    .from('doors')
    .select('sort_order')
    .eq('is_featured', true)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxErr) return { ok: false, error: maxErr.message }
  const nextSort = ((maxRow?.sort_order as number | null | undefined) ?? 0) + 10

  const { error: updateErr } = await supabase
    .from('doors')
    .update({ is_featured: true, sort_order: nextSort })
    .eq('id', doorId)
  if (updateErr) return { ok: false, error: updateErr.message }

  await logAdminAction({
    actor, action: 'door.feature', targetType: 'door', targetId: doorId,
  })
  revalidatePath('/admin/curation')
  revalidatePath('/')
  return { ok: true }
}

export async function unfeatureDoor(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { error } = await supabase
    .from('doors')
    .update({ is_featured: false })
    .eq('id', doorId)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor, action: 'door.unfeature', targetType: 'door', targetId: doorId,
  })
  revalidatePath('/admin/curation')
  revalidatePath('/')
  return { ok: true }
}

async function findNeighbor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  doorId: string,
  direction: 'up' | 'down',
): Promise<{ id: string; sort_order: number } | null> {
  const { data: self, error: selfErr } = await supabase
    .from('doors')
    .select('sort_order')
    .eq('id', doorId)
    .eq('is_featured', true)
    .maybeSingle()
  if (selfErr || !self) return null

  const selfOrder = self.sort_order as number

  const query = supabase
    .from('doors')
    .select('id, sort_order')
    .eq('is_featured', true)
    .is('deleted_at', null)

  const { data: neighbor, error: neighborErr } = await (direction === 'up'
    ? query.lt('sort_order', selfOrder).order('sort_order', { ascending: false })
    : query.gt('sort_order', selfOrder).order('sort_order', { ascending: true })
  ).limit(1).maybeSingle()

  if (neighborErr || !neighbor) return null
  return { id: neighbor.id as string, sort_order: neighbor.sort_order as number }
}

export async function moveFeaturedUp(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const neighbor = await findNeighbor(supabase, doorId, 'up')
  if (!neighbor) return { ok: true } // already first — no-op, no audit

  const { error } = await supabase.rpc('swap_featured_sort_order', {
    door_a: doorId,
    door_b: neighbor.id,
  })
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor, action: 'door.reorder', targetType: 'door', targetId: doorId,
    details: { direction: 'up', swappedWith: neighbor.id },
  })
  revalidatePath('/admin/curation')
  revalidatePath('/')
  return { ok: true }
}

export async function moveFeaturedDown(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const neighbor = await findNeighbor(supabase, doorId, 'down')
  if (!neighbor) return { ok: true } // already last — no-op, no audit

  const { error } = await supabase.rpc('swap_featured_sort_order', {
    door_a: doorId,
    door_b: neighbor.id,
  })
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor, action: 'door.reorder', targetType: 'door', targetId: doorId,
    details: { direction: 'down', swappedWith: neighbor.id },
  })
  revalidatePath('/admin/curation')
  revalidatePath('/')
  return { ok: true }
}
