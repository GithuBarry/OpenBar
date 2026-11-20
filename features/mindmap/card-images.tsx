"use client"

import { useEffect, useRef, useState } from "react"
import { FastTooltip } from "@/components/fast-tooltip";
import { Modal } from "@/components/modal"
import { ExternalLink, FileText, Maximize2, MoveHorizontal, Trash2, X, ZoomIn, ZoomOut } from "lucide-react"
import type { ArtifactRef } from "@/lib/types"
import { artifactHref } from "@/lib/research/artifact-link"
import { detachMindmapImage } from "@/lib/mindmap/image-refs"
import styles from "./card-images.module.css"

export function imageFilesFromTransfer(data: DataTransfer): File[] {
  const files = Array.from(data.files || [])
  const candidates = files.length ? files : Array.from(data.items || []).map(item => item.getAsFile()).filter((file): file is File => Boolean(file))
  return candidates.filter(file => file.type.startsWith("image/") || file.type === "application/pdf" || /\.(png|jpe?g|webp|gif|svg|pdf)$/i.test(file.name))
}

export function hasImageTransfer(data: DataTransfer): boolean {
  return Array.from(data.items || []).some(item => item.kind === "file" && (item.type.startsWith("image/") || item.type === "application/pdf"))
    || data.types.includes("Files") || imageFilesFromTransfer(data).length > 0
}

function isPdf(ref: ArtifactRef) { return /\.pdf$/i.test(ref.id) }

export function CardImages({ project, refs, readOnly, uploading = 0, onChange }: {
  project: string
  refs: ArtifactRef[]
  readOnly: boolean
  uploading?: number
  onChange: (update: (refs: ArtifactRef[]) => ArtifactRef[]) => void
}) {
  const image = refs.find(ref => ref.kind === "figure")
  const [viewing, setViewing] = useState(false)
  return <div className={styles.gallery + " nodrag nopan"} data-card-images
    onPointerDown={event => { if (event.currentTarget.contains(event.target as Node)) event.stopPropagation() }}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}>
    {image && <CardImage key={image.id} project={project} image={image} readOnly={readOnly}
      onView={() => setViewing(true)}
      onResize={imageWidth => onChange(current => current.map(item => item.kind === "figure" && item.id === image.id ? { ...item, imageWidth } : item))}
      onRemove={() => onChange(current => detachMindmapImage(current, image.id))} />}
    {uploading > 0 && <p className={styles.status} role="status">Adding {uploading} image{uploading === 1 ? "" : "s"}…</p>}
    {viewing && image && <ImageViewer project={project} active={image} onClose={() => setViewing(false)} />}
  </div>
}

function CardImage({ project, image, readOnly, onView, onResize, onRemove }: {
  project: string
  image: ArtifactRef
  readOnly: boolean
  onView: () => void
  onResize: (width: number) => void
  onRemove: () => void
}) {
  const figure = useRef<HTMLElement>(null)
  const drag = useRef<{ x: number, width: number, parentWidth: number } | null>(null)
  const [previewWidth, setPreviewWidth] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const width = previewWidth ?? image.imageWidth ?? 100
  const caption = image.label || image.id.split("/").pop() || "Card image"
  return <figure ref={figure} className={styles.image} style={{ width: width + "%" }} data-card-image={image.id}>
    <div className={styles.frame}>
    <button type="button" className={styles.preview} aria-label={"View image: " + caption} onClick={onView}>
      {isPdf(image) ? <span className={styles.placeholder}><FileText size={28} />Open PDF preview</span>
        : failed ? <span className={styles.placeholder}>Open image (preview unavailable)</span>
        : <img src={artifactHref(project, image)} alt={caption} loading="lazy" draggable={false} onError={() => setFailed(true)} />}
    </button>
    <div className={styles.tools}>
      <FastTooltip label="View full image"><button type="button" aria-label={"Expand image: " + caption} onClick={onView}><Maximize2 size={14} /></button></FastTooltip>
      {!readOnly && <>
        {width < 100 && <FastTooltip label="Fit full card width"><button type="button" aria-label={"Fit full card width: " + caption} onClick={() => onResize(100)}><MoveHorizontal size={14} /></button></FastTooltip>}
        <FastTooltip label="Remove from card (undo available)"><button type="button" aria-label={"Remove image from card: " + caption} onClick={onRemove}><Trash2 size={14} /></button></FastTooltip>
      </>}
    </div>
    {!readOnly && <FastTooltip label="Drag to resize or use arrow keys"><button type="button" className={styles.resize} role="slider" aria-label={"Image width: " + caption}
      aria-valuemin={25} aria-valuemax={100} aria-valuenow={Math.round(width)} aria-valuetext={Math.round(width) + "% of card width"}
      onPointerDown={event => {
        if (event.button !== 0) return
        const parentWidth = figure.current?.parentElement?.getBoundingClientRect().width
        if (!parentWidth) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, width, parentWidth }
      }}
      onPointerMove={event => {
        const start = drag.current
        if (start) setPreviewWidth(Math.round(Math.max(25, Math.min(100, start.width + (event.clientX - start.x) / start.parentWidth * 100))))
      }}
      onPointerUp={event => {
        if (!drag.current) return
        const start = drag.current
        const next = Math.round(Math.max(25, Math.min(100, start.width + (event.clientX - start.x) / start.parentWidth * 100)))
        drag.current = null
        setPreviewWidth(null)
        if (next !== start.width) onResize(next)
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
      }}
      onPointerCancel={() => { drag.current = null; setPreviewWidth(null) }}
      onLostPointerCapture={() => { drag.current = null; setPreviewWidth(null) }}
      onKeyDown={event => {
        const next = event.key === "Home" ? 25 : event.key === "End" ? 100
          : ["ArrowLeft", "ArrowDown"].includes(event.key) ? Math.max(25, width - 5)
          : ["ArrowRight", "ArrowUp"].includes(event.key) ? Math.min(100, width + 5) : null
        if (next !== null) { event.preventDefault(); if (next !== width) onResize(next) }
      }}><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12.91 8.04A6 6 0 0 1 8.04 12.91" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" /></svg></button></FastTooltip>}
    </div>
    {image.label && <figcaption title={image.label}>{image.label}</figcaption>}
  </figure>
}

function ImageViewer({ project, active, onClose }: {
  project: string
  active: ArtifactRef
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setZoom(1); setFailed(false) }, [active.id])
  const href = artifactHref(project, active)
  return <Modal open onClose={onClose} title="Card image viewer" className={styles.viewer}>
    <header>
      <span className={styles.viewerTitle}>{active.label || active.id.split("/").pop()}</span>
      {!isPdf(active) && <>
        <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}><ZoomOut size={18} /></button>
        <button type="button" onClick={() => setZoom(1)} aria-label="Fit image">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .5))}><ZoomIn size={18} /></button>
      </>}
      <FastTooltip label="Open original"><a href={href} target="_blank" rel="noreferrer" aria-label="Open original image"><ExternalLink size={18} /></a></FastTooltip>
      <button type="button" aria-label="Close image viewer" onClick={onClose}><X size={20} /></button>
    </header>
    <div className={styles.viewerBody}>
      {isPdf(active) ? <iframe src={href} title={active.label || "PDF preview"} /> : failed ?
        <p className={styles.placeholder} role="status">Image unavailable. The card’s image reference is preserved.</p> :
        <div className={styles.zoomSurface} style={{ width: zoom * 100 + "%", height: zoom * 100 + "%" }}>
          <img src={href} alt={active.label || "Card image"} draggable={false} onError={() => setFailed(true)} />
        </div>}
    </div>
  </Modal>
}
