import { read } from 'nbtify'
import type { DoorFileFormat } from '@/lib/types/door'

export type ParsedSchematicMetadata = {
  block_count?: number
  bounds_width?: number
  bounds_height?: number
  bounds_depth?: number
  minecraft_version?: string
}

const AIR_BLOCKS = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])

function unwrapTagValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    'value' in value &&
    Object.keys(value).every((key) => key === 'type' || key === 'value')
  ) {
    return unwrapTagValue((value as { value: unknown }).value)
  }
  return value
}

function asCompound(value: unknown): Record<string, unknown> | null {
  const raw = unwrapTagValue(value)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ArrayBuffer.isView(raw)) {
    return null
  }
  return raw as Record<string, unknown>
}

function asNumber(value: unknown): number | null {
  const raw = unwrapTagValue(value)
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'bigint') return Number(raw)
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (raw instanceof Number) {
    const parsed = Number(raw.valueOf())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asString(value: unknown): string | null {
  const raw = unwrapTagValue(value)
  if (typeof raw === 'string') return raw
  if (raw instanceof String) return raw.valueOf()
  return null
}

function asByteArray(value: unknown): Uint8Array | null {
  const raw = unwrapTagValue(value)
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof Int8Array) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  }
  if (Array.isArray(raw) && raw.every((entry) => typeof entry === 'number')) {
    return Uint8Array.from(raw.map((entry) => entry & 0xff))
  }
  return null
}

function countNonAirBlocks(
  blockData: Uint8Array,
  airPaletteIndexes: Set<number>,
  expectedVolume: number,
): number {
  let count = 0
  let entries = 0
  let value = 0
  let shift = 0

  for (const currentByte of blockData) {
    const byte = currentByte & 0xff
    value |= (byte & 0x7f) << shift

    if ((byte & 0x80) === 0) {
      if (!airPaletteIndexes.has(value)) count++
      entries++
      value = 0
      shift = 0
      continue
    }

    shift += 7
    if (shift > 35) {
      throw new Error('Invalid varint in BlockData.')
    }
  }

  if (shift !== 0) {
    throw new Error('Truncated varint in BlockData.')
  }

  if (entries !== expectedVolume) {
    throw new Error('BlockData length does not match schematic volume.')
  }

  return count
}

async function parseSpongeSchematic(data: ArrayBuffer | Uint8Array | Blob): Promise<ParsedSchematicMetadata> {
  const parsed = await read(data)
  const root = asCompound(parsed.data)
  if (!root) return {}

  const width = asNumber(root.Width)
  const height = asNumber(root.Height)
  const length = asNumber(root.Length)
  const palette = asCompound(root.Palette)
  const blockData = asByteArray(root.BlockData)

  if (
    width === null ||
    height === null ||
    length === null ||
    width < 0 ||
    height < 0 ||
    length < 0 ||
    !palette ||
    !blockData
  ) {
    return {}
  }

  const airPaletteIndexes = new Set<number>()
  for (const [blockState, paletteIndex] of Object.entries(palette)) {
    if (!AIR_BLOCKS.has(blockState)) continue
    const index = asNumber(paletteIndex)
    if (index !== null) airPaletteIndexes.add(index)
  }

  const expectedVolume = Math.trunc(width) * Math.trunc(height) * Math.trunc(length)
  const block_count = countNonAirBlocks(blockData, airPaletteIndexes, expectedVolume)
  const versionString =
    asString(root.MinecraftDataVersion) ??
    asString(root.minecraft_version) ??
    (() => {
      const versionNumber =
        asNumber(root.DataVersion) ??
        asNumber(root.MinecraftDataVersion) ??
        asNumber(root.minecraft_version)
      return versionNumber !== null ? String(Math.trunc(versionNumber)) : null
    })()
  const minecraft_version = versionString ?? undefined

  return {
    block_count,
    bounds_width: Math.trunc(width),
    bounds_height: Math.trunc(height),
    bounds_depth: Math.trunc(length),
    minecraft_version,
  }
}

export async function parseSchematicMetadata(
  format: DoorFileFormat,
  data: ArrayBuffer | Uint8Array | Blob,
): Promise<ParsedSchematicMetadata> {
  try {
    if (format === 'schem') {
      return await parseSpongeSchematic(data)
    }

    if (format === 'litematic') {
      // TODO: Parse Litematic metadata server-side.
      return {}
    }

    if (format === 'mcstructure') {
      // TODO: Parse MCStructure metadata server-side.
      return {}
    }

    if (format === 'schematic') {
      // TODO: Parse classic .schematic metadata server-side.
      return {}
    }

    return {}
  } catch {
    return {}
  }
}
