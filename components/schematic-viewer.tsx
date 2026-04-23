'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

type SchematicRendererInstance = {
  dispose?: () => void
  cubane?: {
    loadResourcePack: (pack: File) => Promise<void>
    getAssetLoader?: () => { buildTextureAtlas?: () => Promise<void> } | null
  }
  schematicManager?: {
    loadSchematicFromURL: (url: string, id: string) => Promise<void>
  }
  cameraManager?: {
    focusOnSchematics?: () => void
    switchCameraPreset?: (preset: string) => void
  }
  renderManager?: {
    updateCanvasSize?: () => void
  }
}

type SchematicRendererCtor = new (
  canvas: HTMLCanvasElement,
  schematics: Record<string, () => Promise<ArrayBuffer>>,
  resourcePacks: Record<string, () => Promise<Blob>>,
  options: Record<string, unknown>,
) => SchematicRendererInstance

declare global {
  interface Window {
    THREE?: unknown
    SchematicRenderer?: { SchematicRenderer: SchematicRendererCtor }
  }
}

// Three.js dropped the UMD build after r0.159, so we load the current ES
// module build dynamically and assign the namespace to window.THREE. The
// schematic-renderer UMD (which marks `three` as external) reads it from
// there.
const THREE_SRC = process.env.NEXT_PUBLIC_THREE_URL ?? '/vendor/three.module.min.js'

const RENDERER_SRC =
  process.env.NEXT_PUBLIC_SCHEMATIC_RENDERER_URL ?? '/vendor/schematic-renderer.umd.js'
const RESOURCE_PACK_URL = process.env.NEXT_PUBLIC_RESOURCE_PACK_URL ?? '/vendor/pack.zip'

let threeLoadPromise: Promise<void> | null = null
let resourcePackPromise: Promise<ArrayBuffer> | null = null
let srErrorSuppressorInstalled = false

// schematic-renderer's dispose() aborts on a "FFmpeg not found" throw before
// it can disconnect the canvas ResizeObserver it attached in the ctor. The
// leaked observer then fires `updateCanvasSize` against a disposed instance
// and reads `.camera` off `undefined`. React 19 strict-mode double-mount
// triggers this reliably in dev. We can't patch sr internals, but we can
// silence this one specific error before it bubbles to the Next.js overlay.
function installSrErrorSuppressor() {
  if (srErrorSuppressorInstalled) return
  if (typeof window === 'undefined') return
  srErrorSuppressorInstalled = true
  const matchesCamera = (msg: string, src: string) =>
    msg.includes("reading 'camera'") && src.includes('schematic-renderer')
  window.addEventListener('error', (e) => {
    const msg = e.error?.message ?? e.message ?? ''
    const src = e.filename ?? ''
    if (matchesCamera(msg, src)) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  })
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message ?? String(e.reason ?? '')
    const src = e.reason?.stack ?? ''
    if (matchesCamera(msg, src)) {
      e.preventDefault()
    }
  })

  // schematic-renderer calls `console.error('FFmpeg not found')` from its
  // dispose path before throwing, and Next's dev overlay captures every
  // console.error call. Filter that one exact message (we already swallow
  // the thrown Error via try/catch in safeDispose).
  const originalConsoleError = console.error.bind(console)
  console.error = ((...args: unknown[]) => {
    if (args.some((a) => typeof a === 'string' && a === 'FFmpeg not found')) {
      return
    }
    originalConsoleError(...args)
  }) as typeof console.error
}

function ensureResourcePack(): Promise<ArrayBuffer> {
  if (!resourcePackPromise) {
    resourcePackPromise = fetch(RESOURCE_PACK_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Resource pack HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .catch((err) => {
        resourcePackPromise = null
        throw err
      })
  }
  return resourcePackPromise
}

function ensureThreeLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.THREE) return Promise.resolve()
  if (!threeLoadPromise) {
    threeLoadPromise = import(/* webpackIgnore: true */ /* @vite-ignore */ THREE_SRC)
      .then((mod: unknown) => {
        window.THREE = (mod as { default?: unknown }).default ?? mod
      })
      .catch((err) => {
        threeLoadPromise = null
        throw err
      })
  }
  return threeLoadPromise
}

type SchematicViewerProps = {
  schematicUrl: string
  schematicId?: string
  className?: string
  emptyLabel?: string
}

type Quality = 'performance' | 'quality'
const QUALITY_STORAGE_KEY = 'schematic-viewer-quality'
const DPR_BY_QUALITY: Record<Quality, number> = { performance: 1, quality: 2 }

function readStoredQuality(): Quality {
  if (typeof window === 'undefined') return 'performance'
  const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY)
  return stored === 'quality' ? 'quality' : 'performance'
}

function ThreeLoader({
  onReady,
  onFail,
}: {
  onReady: () => void
  onFail: (message: string) => void
}) {
  useEffect(() => {
    let cancelled = false
    ensureThreeLoaded()
      .then(() => {
        if (!cancelled) onReady()
      })
      .catch((err) => {
        if (cancelled) return
        onFail(err instanceof Error ? err.message : 'Failed to load Three.js.')
      })
    return () => {
      cancelled = true
    }
  }, [onReady, onFail])
  return null
}

function applyPixelRatioCap(instance: unknown, ratio: number) {
  if (!instance || typeof instance !== 'object') return
  const candidates = ['renderer', 'core', 'threeJsRenderer'] as const
  const record = instance as Record<string, unknown>
  for (const key of candidates) {
    const node = record[key]
    if (!node || typeof node !== 'object') continue
    const setPR = (node as Record<string, unknown>).setPixelRatio
    if (typeof setPR === 'function') {
      try {
        ;(setPR as (r: number) => void).call(node, ratio)
        return
      } catch {
        // best-effort; try next shape
      }
    }
    const innerRenderer = (node as Record<string, unknown>).renderer
    if (innerRenderer && typeof innerRenderer === 'object') {
      const innerSetPR = (innerRenderer as Record<string, unknown>).setPixelRatio
      if (typeof innerSetPR === 'function') {
        try {
          ;(innerSetPR as (r: number) => void).call(innerRenderer, ratio)
          return
        } catch {
          // fall through
        }
      }
    }
  }
}

export default function SchematicViewer({
  schematicUrl,
  schematicId = 'door',
  className,
  emptyLabel = 'Unable to load schematic.',
}: SchematicViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<SchematicRendererInstance | null>(null)
  const [inView, setInView] = useState(false)
  const [threeReady, setThreeReady] = useState(false)
  const [rendererReady, setRendererReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quality, setQuality] = useState<Quality>('performance')

  useEffect(() => {
    installSrErrorSuppressor()
    queueMicrotask(() => setQuality(readStoredQuality()))
  }, [])

  const toggleQuality = () => {
    setQuality((prev) => {
      const next = prev === 'performance' ? 'quality' : 'performance'
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(QUALITY_STORAGE_KEY, next)
      }
      return next
    })
  }

  useEffect(() => {
    const target = canvasRef.current
    if (!target) return
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => setInView(true))
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            observer.disconnect()
            return
          }
        }
      },
      { rootMargin: '256px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!inView || !threeReady || !rendererReady) return
    const canvas = canvasRef.current
    if (!canvas) return

    const Ctor = window.SchematicRenderer?.SchematicRenderer
    if (!Ctor) {
      console.error('SchematicRenderer global missing after load.')
      return
    }

    let cancelled = false
    let localInstance: SchematicRendererInstance | null = null
    let resizeObserver: ResizeObserver | null = null

    const safeDispose = (instance: SchematicRendererInstance | null) => {
      if (!instance) return
      try {
        instance.dispose?.()
      } catch {
        // sr.dispose() throws "FFmpeg not found" when the unused FFmpeg
        // subsystem was never initialized — swallow.
      }
    }

    const run = async () => {
      try {
        if (cancelled) return
        // Construct the renderer empty first (mirrors the pattern in
        // old-references/door-catalog-viewer.html). Loading the schematic
        // or resource pack in the constructor is unreliable across versions
        // of schematic-renderer; explicit calls after `rendererInitialized`
        // are the supported path.
        const ready = new Promise<void>((resolve, reject) => {
          let settled = false
          const done = () => {
            if (settled) return
            settled = true
            resolve()
          }
          canvas.addEventListener('rendererInitialized', done, { once: true })
          setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error('Renderer init timed out after 15s.'))
          }, 15_000)
        })

        const instance = new Ctor(canvas, {}, {}, {
          backgroundColor: 0x111111,
          showGrid: false,
          enableDragAndDrop: false,
          enableProgressBar: false,
          resourcePackOptions: { autoRebuild: false },
          cameraOptions: { position: [18, 18, 18], useTightBounds: true },
          callbacks: {
            onRendererInitialized: () => {
              canvas.dispatchEvent(new Event('rendererInitialized'))
            },
          },
        })
        if (cancelled) {
          safeDispose(instance)
          return
        }
        localInstance = instance
        rendererRef.current = instance

        const cap = DPR_BY_QUALITY[quality]
        const ratio = Math.min(
          typeof window !== 'undefined' ? window.devicePixelRatio : 1,
          cap,
        )
        applyPixelRatioCap(instance, ratio)

        await ready
        if (cancelled) return

        // RenderManager.updateCanvasSize runs once during async init; if the
        // parent was still 0×0 at that instant (paint race, WASM hit cache,
        // hidden ancestor) the canvas is locked to 0px and camera.aspect
        // becomes NaN. Observe the parent first so the ResizeObserver's
        // initial callback re-measures against current layout, and also
        // recovers later when the parent transitions to a non-zero size.
        const forceResize = () => {
          try {
            localInstance?.renderManager?.updateCanvasSize?.()
          } catch (err) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[SchematicViewer] updateCanvasSize threw', err)
            }
          }
        }
        const parent = canvas.parentElement
        if (parent && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (cancelled) return
            forceResize()
          })
          resizeObserver.observe(parent)
        } else {
          forceResize()
        }

        // Resource pack — required for the WASM texture atlas. Without it the
        // viewer throws "<illegal path>" while building its virtual FS.
        const packBuffer = await ensureResourcePack()
        if (cancelled) return
        const packFile = new File([packBuffer.slice(0)], 'pack.zip', {
          type: 'application/zip',
        })
        await instance.cubane?.loadResourcePack(packFile)
        const loader = instance.cubane?.getAssetLoader?.()
        if (loader && typeof loader.buildTextureAtlas === 'function') {
          await loader.buildTextureAtlas()
        }
        if (cancelled) return

        // Finally, fetch and load the actual schematic.
        await instance.schematicManager?.loadSchematicFromURL(schematicUrl, schematicId)
        if (cancelled) return
        instance.cameraManager?.focusOnSchematics?.()
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    queueMicrotask(run)

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      resizeObserver = null
      safeDispose(localInstance)
      if (rendererRef.current === localInstance) rendererRef.current = null
    }
  }, [inView, threeReady, rendererReady, schematicId, schematicUrl, quality])

  return (
    <div className={className} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggleQuality}
        aria-label="Toggle render quality"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 1,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding: '4px 8px',
          background: 'rgba(0,0,0,0.6)',
          color: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(255,255,255,0.2)',
          cursor: 'pointer',
        }}
      >
        {quality === 'performance' ? 'Perf' : 'Quality'}
      </button>
      {inView ? (
        <>
          <ThreeLoader onReady={() => setThreeReady(true)} onFail={setError} />
          {threeReady ? (
            <Script
              src={RENDERER_SRC}
              strategy="afterInteractive"
              onLoad={() => setRendererReady(true)}
              onError={() => setError('Failed to load schematic-renderer.')}
            />
          ) : null}
        </>
      ) : null}
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {error ? (
        <p role="alert" style={{ padding: 12, fontSize: 13 }}>
          {emptyLabel} <span style={{ opacity: 0.7 }}>({error})</span>
        </p>
      ) : null}
    </div>
  )
}
