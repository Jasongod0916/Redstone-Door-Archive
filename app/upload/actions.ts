'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { DoorFileFormat } from '@/lib/types/door'
import {
  parseSchematicMetadata,
  type ParsedSchematicMetadata,
} from '@/lib/schematic/parse'

const FILE_FORMATS: DoorFileFormat[] = ['litematic', 'schem', 'mcstructure']
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

// Reject obviously-wrong file contents. Sponge .schem / .schematic and
// .litematic are gzip-compressed NBT (magic `1f 8b`). Bedrock .mcstructure
// is raw little-endian NBT starting with a root compound tag (`0x0a`).
function isLikelyValidFormat(fmt: DoorFileFormat, head: Uint8Array): boolean {
  if (head.length < 2) return false
  if (fmt === 'litematic' || fmt === 'schem' || fmt === 'schematic') {
    return head[0] === 0x1f && head[1] === 0x8b
  }
  if (fmt === 'mcstructure') {
    return head[0] === 0x0a
  }
  return true
}

function mergeParsedMetadata(
  accumulator: ParsedSchematicMetadata,
  parsed: ParsedSchematicMetadata,
) {
  if (accumulator.block_count == null && parsed.block_count != null) {
    accumulator.block_count = parsed.block_count
  }
  if (accumulator.bounds_width == null && parsed.bounds_width != null) {
    accumulator.bounds_width = parsed.bounds_width
  }
  if (accumulator.bounds_height == null && parsed.bounds_height != null) {
    accumulator.bounds_height = parsed.bounds_height
  }
  if (accumulator.bounds_depth == null && parsed.bounds_depth != null) {
    accumulator.bounds_depth = parsed.bounds_depth
  }
  if (accumulator.minecraft_version == null && parsed.minecraft_version != null) {
    accumulator.minecraft_version = parsed.minecraft_version
  }
}

export async function createDoorAction(formData: FormData) {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) redirect('/auth/login?next=/upload')

  const title = String(formData.get('title') ?? '').trim()
  const author = String(formData.get('author') ?? '').trim() || (user.email ?? 'anonymous')
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
  const doorSize = `${doorW}x${doorH}`
  const blockCount = asInt(formData.get('block_count'))
  const boundsW = asInt(formData.get('bounds_width'))
  const boundsH = asInt(formData.get('bounds_height'))
  const boundsD = asInt(formData.get('bounds_depth'))
  const openTicks = asInt(formData.get('open_ticks'))
  const closeTicks = asInt(formData.get('close_ticks'))

  const slug = `${slugify(title)}-${doorSize}-${suffix()}`

  const { data: doorRow, error: insertErr } = await supabase
    .from('doors')
    .insert({
      slug,
      title,
      owner_id: user.id,
      author,
      description,
      minecraft_version: minecraftVersion,
      door_size: doorSize,
      block_count: blockCount,
      bounds_width: boundsW,
      bounds_height: boundsH,
      bounds_depth: boundsD,
      open_ticks: openTicks,
      close_ticks: closeTicks,
      video_url: videoUrl,
      tags,
    })
    .select('id')
    .single()
  if (insertErr) throw new Error(`Save door: ${insertErr.message}`)

  const doorId = doorRow.id
  let fileCount = 0
  const parsedMetadata: ParsedSchematicMetadata = {}

  for (const fmt of FILE_FORMATS) {
    const blob = formData.get(`file_${fmt}`)
    if (!(blob instanceof File) || blob.size === 0) continue
    if (blob.size > MAX_FILE_BYTES) throw new Error(`${fmt} file exceeds 25 MB limit.`)
    const arrayBuffer = await blob.arrayBuffer()
    if (!isLikelyValidFormat(fmt, new Uint8Array(arrayBuffer, 0, Math.min(4, arrayBuffer.byteLength)))) {
      throw new Error(`${fmt} file doesn't match its declared format.`)
    }
    const ext = fileExtension(blob.name, fmt)
    const storagePath = `${user.id}/${doorId}/${fmt}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('schematics')
      .upload(storagePath, blob, { contentType: blob.type || 'application/octet-stream', upsert: false })
    if (uploadErr) throw new Error(`Upload ${fmt}: ${uploadErr.message}`)

    const { error: fileErr } = await supabase.from('door_files').insert({
      door_id: doorId,
      format: fmt,
      storage_path: storagePath,
      file_name: blob.name,
      file_size: blob.size,
    })
    if (fileErr) throw new Error(`Save file record: ${fileErr.message}`)

    const parsed = await parseSchematicMetadata(fmt, arrayBuffer)
    mergeParsedMetadata(parsedMetadata, parsed)
    fileCount++
  }

  if (fileCount === 0) {
    await supabase.from('doors').delete().eq('id', doorId)
    throw new Error('Attach at least one schematic file (.litematic, .schem, or .mcstructure).')
  }

  const fillUpdate: Record<string, string | number> = {}
  if (blockCount === null && parsedMetadata.block_count != null) {
    fillUpdate.block_count = parsedMetadata.block_count
  }
  if (boundsW === null && parsedMetadata.bounds_width != null) {
    fillUpdate.bounds_width = parsedMetadata.bounds_width
  }
  if (boundsH === null && parsedMetadata.bounds_height != null) {
    fillUpdate.bounds_height = parsedMetadata.bounds_height
  }
  if (boundsD === null && parsedMetadata.bounds_depth != null) {
    fillUpdate.bounds_depth = parsedMetadata.bounds_depth
  }
  if (minecraftVersion === null && parsedMetadata.minecraft_version != null) {
    fillUpdate.minecraft_version = parsedMetadata.minecraft_version
  }

  if (Object.keys(fillUpdate).length > 0) {
    try {
      const { error: updateErr } = await supabase.from('doors').update(fillUpdate).eq('id', doorId)
      if (updateErr) void updateErr
    } catch (updateErr) {
      void updateErr
    }
  }

  revalidatePath('/')
  redirect(`/view/${doorId}`)
}
