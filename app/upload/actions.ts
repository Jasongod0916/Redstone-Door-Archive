'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { DoorFileKey, DoorFiles } from '@/lib/types/door'

const FILE_KEYS: DoorFileKey[] = ['litematic', 'schem', 'mcstructure']
const MAX_FILE_BYTES = 25 * 1024 * 1024

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return base || 'door'
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

function asInt(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : null
}

function asRequiredInt(value: FormDataEntryValue | null): number {
  const n = asInt(value)
  if (n === null || n <= 0) throw new Error('Door width and height must be positive numbers.')
  return n
}

function fileExtension(name: string, fallback: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : fallback
}

export async function createDoorAction(formData: FormData) {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) redirect('/auth/login?next=/upload')

  const title = String(formData.get('title') ?? '').trim()
  const author = (String(formData.get('author') ?? '').trim()) || (user.email ?? 'anonymous')
  const description = String(formData.get('description') ?? '').trim() || null
  const minecraftVersion = String(formData.get('minecraft_version') ?? '').trim() || null
  const videoUrl = String(formData.get('video_url') ?? '').trim() || null
  const tags = String(formData.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  if (!title) throw new Error('Title is required.')

  const doorW = asRequiredInt(formData.get('door_width'))
  const doorH = asRequiredInt(formData.get('door_height'))
  const nonAir = asInt(formData.get('non_air_blocks'))
  const bboxW = asInt(formData.get('bbox_w'))
  const bboxH = asInt(formData.get('bbox_h'))
  const bboxD = asInt(formData.get('bbox_d'))
  const openTicks = asInt(formData.get('open_ticks'))
  const closeTicks = asInt(formData.get('close_ticks'))
  const total =
    asInt(formData.get('total_ticks')) ??
    (openTicks !== null && closeTicks !== null ? openTicks + closeTicks : null)

  const id = `${slugify(title)}-${doorW}x${doorH}-${suffix()}`
  const files: DoorFiles = {}

  for (const key of FILE_KEYS) {
    const blob = formData.get(`file_${key}`)
    if (!(blob instanceof File) || blob.size === 0) continue
    if (blob.size > MAX_FILE_BYTES) throw new Error(`${key} file exceeds 25 MB limit.`)
    const ext = fileExtension(blob.name, key === 'mcstructure' ? 'mcstructure' : key)
    const path = `${user.id}/${id}/${key}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('schematics')
      .upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false })
    if (uploadErr) throw new Error(`Upload ${key}: ${uploadErr.message}`)
    const { data: pub } = supabase.storage.from('schematics').getPublicUrl(path)
    files[key] = pub.publicUrl
  }

  if (Object.keys(files).length === 0) {
    throw new Error('Attach at least one schematic file (.litematic, .schem, or .mcstructure).')
  }

  const { error: insertErr } = await supabase.from('doors').insert({
    id,
    title,
    author,
    description,
    minecraft_version: minecraftVersion,
    door_width: doorW,
    door_height: doorH,
    non_air_blocks: nonAir,
    bbox_w: bboxW,
    bbox_h: bboxH,
    bbox_d: bboxD,
    open_ticks: openTicks,
    close_ticks: closeTicks,
    total_ticks: total,
    video_url: videoUrl,
    tags,
    files,
    owner_id: user.id,
  })
  if (insertErr) throw new Error(`Save door: ${insertErr.message}`)

  revalidatePath('/')
  redirect(`/view/${id}`)
}
