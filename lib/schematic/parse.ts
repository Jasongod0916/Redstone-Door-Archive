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

async function parseLitematic(data: ArrayBuffer | Uint8Array | Blob): Promise<ParsedSchematicMetadata> {
  const parsed = await read(data)
  const root = asCompound(parsed.data)
  if (!root) return {}

  const metadata = asCompound(root.Metadata)
  const regions = asCompound(root.Regions)

  // Metadata.TotalBlocks is the non-air block count as Litematica saves it.
  const totalBlocks = metadata ? asNumber(metadata.TotalBlocks) : null

  // Prefer Metadata.EnclosingSize; fall back to abs() of first region's Size.
  let width: number | null = null
  let height: number | null = null
  let depth: number | null = null
  if (metadata) {
    const enclosing = asCompound(metadata.EnclosingSize)
    if (enclosing) {
      width = asNumber(enclosing.x)
      height = asNumber(enclosing.y)
      depth = asNumber(enclosing.z)
    }
  }
  if ((width === null || height === null || depth === null) && regions) {
    const firstRegionKey = Object.keys(regions)[0]
    const region = firstRegionKey ? asCompound(regions[firstRegionKey]) : null
    const size = region ? asCompound(region.Size) : null
    if (size) {
      width = width ?? asNumber(size.x)
      height = height ?? asNumber(size.y)
      depth = depth ?? asNumber(size.z)
    }
  }

  const dataVersion = asNumber(root.MinecraftDataVersion)
  const minecraft_version = dataVersion !== null ? String(Math.trunc(dataVersion)) : undefined

  const out: ParsedSchematicMetadata = {}
  if (totalBlocks !== null && totalBlocks >= 0) out.block_count = Math.trunc(totalBlocks)
  if (width !== null) out.bounds_width = Math.abs(Math.trunc(width))
  if (height !== null) out.bounds_height = Math.abs(Math.trunc(height))
  if (depth !== null) out.bounds_depth = Math.abs(Math.trunc(depth))
  if (minecraft_version) out.minecraft_version = minecraft_version
  return out
}

async function parseBedrockMCStructure(
  data: ArrayBuffer | Uint8Array | Blob,
): Promise<ParsedSchematicMetadata> {
  // Bedrock .mcstructure: little-endian NBT, NOT gzipped.
  const parsed = await read(data, { endian: 'little' })
  const root = asCompound(parsed.data)
  if (!root) return {}

  // `size` is an IntArray [w, h, d] at the root.
  const sizeRaw = unwrapTagValue(root.size)
  const dims: number[] = []
  if (sizeRaw instanceof Int32Array) {
    for (const n of sizeRaw) dims.push(n)
  } else if (Array.isArray(sizeRaw)) {
    for (const n of sizeRaw) {
      const asN = asNumber(n)
      if (asN !== null) dims.push(asN)
    }
  }

  const out: ParsedSchematicMetadata = {}
  if (dims.length >= 3) {
    out.bounds_width = Math.abs(Math.trunc(dims[0]))
    out.bounds_height = Math.abs(Math.trunc(dims[1]))
    out.bounds_depth = Math.abs(Math.trunc(dims[2]))
  }

  // Non-air block count: scan block_indices list (2-layer list of ints -> palette index).
  const structure = asCompound(root.structure)
  const palette = structure ? asCompound(structure.palette) : null
  const defaultPalette = palette ? asCompound(palette.default) : null
  const blockPalette = defaultPalette ? unwrapTagValue(defaultPalette.block_palette) : null
  const airPaletteIndexes = new Set<number>()
  if (Array.isArray(blockPalette)) {
    blockPalette.forEach((entry, i) => {
      const c = asCompound(entry)
      if (!c) return
      const name = asString(c.name)
      if (name && AIR_BLOCKS.has(name)) airPaletteIndexes.add(i)
    })
  }

  const blockIndicesRaw = structure ? unwrapTagValue(structure.block_indices) : null
  if (Array.isArray(blockIndicesRaw) && blockIndicesRaw.length > 0) {
    const layer = unwrapTagValue(blockIndicesRaw[0])
    if (layer instanceof Int32Array) {
      let count = 0
      for (const idx of layer) {
        if (idx >= 0 && !airPaletteIndexes.has(idx)) count++
      }
      out.block_count = count
    } else if (Array.isArray(layer)) {
      let count = 0
      for (const raw of layer) {
        const idx = asNumber(raw)
        if (idx !== null && idx >= 0 && !airPaletteIndexes.has(idx)) count++
      }
      out.block_count = count
    }
  }

  return out
}

export async function parseSchematicMetadata(
  format: DoorFileFormat,
  data: ArrayBuffer | Uint8Array | Blob,
): Promise<ParsedSchematicMetadata> {
  try {
    if (format === 'schem' || format === 'schematic') {
      return await parseSpongeSchematic(data)
    }

    if (format === 'litematic') {
      return await parseLitematic(data)
    }

    if (format === 'mcstructure') {
      return await parseBedrockMCStructure(data)
    }

    return {}
  } catch {
    return {}
  }
}
