"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowDownRight, ExternalLink, FileText, Maximize2, RotateCcw, Trash2, X, ZoomIn, ZoomOut } from "lucide-react"
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
    onPointerDown={event => event.stopPropagation()}
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
    <button type="button" className={styles.preview} aria-label={"View image: " + caption} onClick={onView}>
      {isPdf(image) ? <span className={styles.placeholder}><FileText size={28} />PDF · Open preview</span>
        : failed ? <span className={styles.placeholder}>Preview unavailable · Open image</span>
        : <img src={artifactHref(project, image)} alt={caption} loading="lazy" draggable={false} onError={() => setFailed(true)} />}
    </button>
    <div className={styles.tools}>
      <button type="button" aria-label={"Expand image: " + caption} title="View full image" onClick={onView}><Maximize2 size={14} /></button>
      {!readOnly && <>
        <button type="button" aria-label={"Reset image size: " + caption} title="Full card width" onClick={() => onResize(100)}><RotateCcw size={14} /></button>
        <button type="button" aria-label={"Remove image from card: " + caption} title="Remove from card · Undo available" onClick={onRemove}><Trash2 size={14} /></button>
      </>}
    </div>
    {image.label && <figcaption title={image.label}>{image.label}</figcaption>}
    {!readOnly && <button type="button" className={styles.resize} role="slider" aria-label={"Image width: " + caption}
      aria-valuemin={25} aria-valuemax={100} aria-valuenow={Math.round(width)} aria-valuetext={Math.round(width) + "% of card width"}
      title="Drag to resize · Arrow keys adjust width"
      onPointerDown={event => {
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
        onResize(next)
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => { drag.current = null; setPreviewWidth(null) }}
      onKeyDown={event => {
        const next = event.key === "Home" ? 25 : event.key === "End" ? 100
          : ["ArrowLeft", "ArrowDown"].includes(event.key) ? Math.max(25, width - 5)
          : ["ArrowRight", "ArrowUp"].includes(event.key) ? Math.min(100, width + 5) : null
        if (next !== null) { event.preventDefault(); onResize(next) }
      }}><ArrowDownRight size={13} /></button>}
  </figure>
}

function ImageViewer({ project, active, onClose }: {
  project: string
  active: ArtifactRef
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement as HTMLElement | null
    element?.showModal()
    return () => { element?.close(); previous?.focus() }
  }, [])
  useEffect(() => setZoom(1), [active.id])
  const href = artifactHref(project, active)
  return createPortal(<dialog ref={dialog} className={styles.viewer} aria-label="Card image viewer" aria-modal="true"
    onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}
    onKeyDown={event => event.stopPropagation()}>
    <header>
      <span className={styles.viewerTitle}>{active.label || active.id.split("/").pop()}</span>
      {!isPdf(active) && <>
        <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}><ZoomOut size={18} /></button>
        <button type="button" onClick={() => setZoom(1)} aria-label="Fit image">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .5))}><ZoomIn size={18} /></button>
      </>}
      <a href={href} target="_blank" rel="noreferrer" aria-label="Open original image" title="Open original"><ExternalLink size={18} /></a>
      <button type="button" aria-label="Close image viewer" autoFocus onClick={onClose}><X size={20} /></button>
    </header>
    <div className={styles.viewerBody}>
      {isPdf(active) ? <iframe src={href} title={active.label || "PDF preview"} /> :
        <div className={styles.zoomSurface} style={{ width: zoom * 100 + "%", height: zoom * 100 + "%" }}>
          <img src={href} alt={active.label || "Card image"} draggable={false} />
        </div>}
    </div>
  </dialog>, document.body)
}
