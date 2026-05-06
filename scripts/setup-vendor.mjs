import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const vendorDir = path.join(rootDir, 'public', 'vendor')

const THREE_VERSION = '0.181.2'
const SR_VERSION = '1.1.23'

const downloads = [
  {
    path: path.join(vendorDir, 'three.module.min.js'),
    url: `https://unpkg.com/three@${THREE_VERSION}/build/three.module.min.js`,
  },
  {
    path: path.join(vendorDir, 'three.core.min.js'),
    url: `https://unpkg.com/three@${THREE_VERSION}/build/three.core.min.js`,
  },
  {
    path: path.join(vendorDir, 'schematic-renderer.umd.js'),
    url: `https://unpkg.com/schematic-renderer@${SR_VERSION}/dist/schematic-renderer.umd.js`,
  },
]

const packSrc = path.join(rootDir, 'schematic-renderer', 'test', 'public', 'pack.zip')
const packDest = path.join(vendorDir, 'pack.zip')

async function fileHasContent(targetPath) {
  try {
    const info = await stat(targetPath)
    return info.size > 0
  } catch {
    return false
  }
}

async function downloadIfMissing(targetPath, url) {
  if (await fileHasContent(targetPath)) {
    console.log(`  ok   ${path.relative(rootDir, targetPath)} (cached)`)
    return
  }

  console.log(`  get  ${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  await writeFile(targetPath, bytes)
  console.log(`  ok   ${path.relative(rootDir, targetPath)} (${bytes.byteLength} bytes)`)
}

async function copyPackIfMissing() {
  if (await fileHasContent(packDest)) {
    console.log(`  ok   ${path.relative(rootDir, packDest)} (cached)`)
    return
  }

  try {
    await stat(packSrc)
  } catch {
    console.warn(
      `  warn ${path.relative(rootDir, packSrc)} missing — viewer will fail until it exists`,
    )
    return
  }

  await copyFile(packSrc, packDest)
  const info = await stat(packDest)
  console.log(
    `  ok   ${path.relative(rootDir, packDest)} (${info.size} bytes, copied from ${path.relative(rootDir, packSrc)})`,
  )
}

async function main() {
  console.log(`Hydrating ${path.relative(rootDir, vendorDir)} ...`)
  await mkdir(vendorDir, { recursive: true })

  for (const download of downloads) {
    await downloadIfMissing(download.path, download.url)
  }

  await copyPackIfMissing()
  console.log('Done. Vendor assets ready.')
}

await main()
