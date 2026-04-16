'use client'

import dynamic from 'next/dynamic'

const SchematicViewer = dynamic(() => import('./schematic-viewer'), {
  ssr: false,
  loading: () => (
    <div className="bg-muted text-muted-foreground flex h-full w-full items-center justify-center text-xs tracking-widest uppercase">
      Loading viewer…
    </div>
  ),
})

export default SchematicViewer
