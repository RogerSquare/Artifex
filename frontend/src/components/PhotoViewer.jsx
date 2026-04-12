import { useState, useEffect, useCallback, useRef } from 'react'
import { X, CaretLeft, CaretRight, MagnifyingGlassPlus, MagnifyingGlassMinus, ArrowsOut, DownloadSimple, Trash, Lock, Globe, ShareNetwork, Check, Heart, Info, FolderPlus } from '@phosphor-icons/react'
import { UPLOADS_URL, API_URL } from '../config'
import { useAuth } from '../context/AuthContext'
import MetadataPanel from './MetadataPanel'
import CommentSection from './CommentSection'

const Btn = ({ onClick, active, children, ...props }) => (
  <button onClick={onClick} className={`p-1.5 rounded-md transition-all duration-200 ${active ? 'text-white' : 'text-white/40 hover:text-white/80 hover:bg-white/[0.06]'}`} {...props}>{children}</button>
)

export default function PhotoViewer({ image, images, onClose, onNavigate, onDelete, onToggleVisibility, onToggleFavorite, currentUserId, onViewProfile, onTagFilter }) {
  const { authHeaders } = useAuth()
  const [shareCopied, setShareCopied] = useState(false)
  const [showCollectionPicker, setShowCollectionPicker] = useState(false)
  const [collections, setCollections] = useState([])
  const [addedToCollection, setAddedToCollection] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [showInfo, setShowInfo] = useState(true)
  const [imageLoaded, setImageLoaded] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef(null)

  const currentIndex = images.findIndex(i => i.id === image.id)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < images.length - 1
  const isRemote = !!image.is_remote
  const fullSrc = isRemote ? `${API_URL}/federation/proxy/${image.peer_id}/${image.id}/full` : `${UPLOADS_URL}/${image.filepath}`
  const isOwner = !isRemote && image.user_id === currentUserId

  // Fetch full metadata from peer for remote images
  const [remoteDetail, setRemoteDetail] = useState(null)
  useEffect(() => {
    if (isRemote && image.peer_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when switching images
      setRemoteDetail(null)
      fetch(`${API_URL}/federation/proxy/${image.peer_id}/${image.id}/detail`)
        .then(r => r.json())
        .then(d => setRemoteDetail(d.image || d))
        .catch(() => {})
    }
  }, [isRemote, image.peer_id, image.id])

  // Merge remote detail into image for display
  const displayImage = isRemote && remoteDetail ? { ...image, ...remoteDetail, is_remote: true, peer_name: image.peer_name } : image

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  const goPrev = useCallback(() => { if (hasPrev) { resetZoom(); setImageLoaded(false); onNavigate(images[currentIndex - 1]) } }, [hasPrev, currentIndex, images, onNavigate, resetZoom])
  const goNext = useCallback(() => { if (hasNext) { resetZoom(); setImageLoaded(false); onNavigate(images[currentIndex + 1]) } }, [hasNext, currentIndex, images, onNavigate, resetZoom])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'i') setShowInfo(prev => !prev)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, goPrev, goNext])

  const handleWheel = useCallback((e) => { e.preventDefault(); setZoom(prev => Math.min(5, Math.max(0.5, prev + (e.deltaY > 0 ? -0.2 : 0.2)))) }, [])

  const handleImageClick = (e) => {
    if (dragging) return
    if (zoom > 1) resetZoom()
    else {
      setZoom(2.5)
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) setPan({ x: (rect.width / 2 - (e.clientX - rect.left)) * 1.5, y: (rect.height / 2 - (e.clientY - rect.top)) * 1.5 })
    }
  }

  const handleMouseDown = (e) => { if (zoom <= 1) return; setDragging(true); dragStart.current = { x: e.clientX, y: e.clientY }; panStart.current = { ...pan } }
  const handleMouseMove = useCallback((e) => { if (!dragging) return; setPan({ x: panStart.current.x + (e.clientX - dragStart.current.x), y: panStart.current.y + (e.clientY - dragStart.current.y) }) }, [dragging])
  const handleMouseUp = useCallback(() => setDragging(false), [])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  const formatSize = (bytes) => {
    if (!bytes) return '—'
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1048576).toFixed(1)} MB`
  }

  const openCollectionPicker = async () => {
    try {
      const res = await fetch(`${API_URL}/collections`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setCollections(data.filter(c => c.user_id === currentUserId))
      }
    } catch {}
    setShowCollectionPicker(true)
  }

  const addToCollection = async (collectionId) => {
    try {
      await fetch(`${API_URL}/collections/${collectionId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ imageIds: [image.id] })
      })
      const col = collections.find(c => c.id === collectionId)
      setAddedToCollection(col?.name || 'collection')
      setTimeout(() => setAddedToCollection(null), 2000)
    } catch {}
    setShowCollectionPicker(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex animate-in fade-in duration-200">
      {/* Image area */}
      <div className="flex-1 relative flex flex-col overflow-hidden" ref={containerRef}>

        {/* Toolbar — 2 rows matching header pattern */}
        <div className="shrink-0 bg-black/60 backdrop-blur-xl border-b border-white/[0.04] z-10">
          {/* Row 1: Close + Title + Actions */}
          <div className="h-11 flex items-center px-4 border-b border-white/[0.04]">
            <button onClick={onClose} className="p-1.5 -ml-1 rounded-md text-white/50 hover:text-white hover:bg-white/[0.06] transition-all duration-200 mr-3" title="Close (Esc)">
              <X className="w-4 h-4" />
            </button>
            <span className="text-[14px] font-medium text-white/90 truncate max-w-[260px]">{image.title || image.original_name}</span>
            {images.length > 1 && <span className="text-[12px] text-white/25 ml-2 tabular-nums shrink-0">{currentIndex + 1} of {images.length}</span>}

            <div className="flex-1" />

            {/* Primary actions */}
            <div className="flex items-center gap-0.5">
              {!isRemote && (
                <Btn onClick={() => onToggleFavorite?.(image.id)} active={image.is_favorited} title={image.is_favorited ? 'Unfavorite' : 'Favorite'}>
                  <Heart className="w-4 h-4" weight={image.is_favorited ? 'fill' : 'regular'} style={image.is_favorited ? { color: 'var(--color-red)' } : {}} />
                </Btn>
              )}
              {isRemote && image.peer_name && (
                <span className="px-2.5 py-1 rounded-full bg-accent/15 text-accent text-[11px] font-medium flex items-center gap-1">
                  <ShareNetwork className="w-3 h-3" /> {image.peer_name}
                </span>
              )}
              <div className="relative">
                <Btn onClick={openCollectionPicker} active={showCollectionPicker} title="Add to collection">
                  {addedToCollection ? <Check className="w-4 h-4" style={{ color: 'var(--color-green)' }} /> : <FolderPlus className="w-4 h-4" />}
                </Btn>
                {showCollectionPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowCollectionPicker(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-50 w-52 bg-bg-elevated/95 backdrop-blur-xl rounded-xl shadow-2xl shadow-black/40 border border-white/[0.08] overflow-hidden">
                      {collections.length === 0 ? (
                        <div className="px-3.5 py-3 text-[13px] text-text-muted text-center">No collections yet</div>
                      ) : collections.map(col => (
                        <button key={col.id} onClick={() => addToCollection(col.id)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-white hover:bg-white/[0.06] transition-colors text-left">
                          <FolderPlus className="w-4 h-4 text-white/40 shrink-0" />
                          <span className="truncate">{col.name}</span>
                          <span className="text-[11px] text-white/25 ml-auto shrink-0">{col.image_count}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {isOwner && (
                <Btn onClick={() => onToggleVisibility?.(image.id, image.visibility === 'public' ? 'private' : 'public')} title={image.visibility === 'public' ? 'Make private' : 'Make public'}>
                  {image.visibility === 'public' ? <Globe className="w-4 h-4" style={{ color: 'var(--color-green)' }} /> : <Lock className="w-4 h-4" />}
                </Btn>
              )}
              {image.visibility === 'public' && (
                <Btn onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?image=${image.id}`); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000) }} title="Copy link">
                  {shareCopied ? <Check className="w-4 h-4" style={{ color: 'var(--color-green)' }} /> : <ShareNetwork className="w-4 h-4" />}
                </Btn>
              )}
              <a href={fullSrc} download={image.original_name} className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-all duration-200" title="Download">
                <DownloadSimple className="w-4 h-4" />
              </a>
              {isOwner && (
                <Btn onClick={() => { if (window.confirm('Delete this image permanently?')) onDelete?.(image.id) }} title="Delete">
                  <Trash className="w-4 h-4 text-white/30 hover:text-red" />
                </Btn>
              )}
            </div>
          </div>

          {/* Row 2: Zoom controls + Info toggle + Image info */}
          <div className="h-8 flex items-center px-4 gap-3">
            <div className="flex items-center gap-0.5">
              <Btn onClick={() => setZoom(prev => Math.min(5, prev + 0.5))} title="Zoom in"><MagnifyingGlassPlus className="w-3.5 h-3.5" /></Btn>
              <Btn onClick={() => setZoom(prev => Math.max(0.5, prev - 0.5))} title="Zoom out"><MagnifyingGlassMinus className="w-3.5 h-3.5" /></Btn>
              <Btn onClick={resetZoom} title="Fit"><ArrowsOut className="w-3.5 h-3.5" /></Btn>
              {zoom !== 1 && <span className="text-[11px] text-white/25 tabular-nums ml-1">{Math.round(zoom * 100)}%</span>}
            </div>

            <div className="flex-1" />

            <span className="text-[11px] text-white/20">{image.width}×{image.height}</span>
            <span className="text-[11px] text-white/20">{formatSize(image.file_size)}</span>
            <span className="text-[11px] text-white/20">{image.format?.toUpperCase()}</span>
            {image.model && <span className="text-[11px] text-white/25 truncate max-w-[120px]">{image.model}</span>}

            <div className="w-px h-3 bg-white/[0.08] mx-1" />

            <Btn onClick={() => setShowInfo(prev => !prev)} active={showInfo} title="Details (I)">
              <Info className="w-3.5 h-3.5" />
            </Btn>
          </div>

          {/* AI Caption */}
          {(displayImage.caption || image.caption) && (
            <div className="h-7 flex items-center justify-center px-4 border-t border-white/[0.04]">
              <span className="text-[12px] text-white/40 italic truncate">{displayImage.caption || image.caption}</span>
            </div>
          )}
        </div>

        {/* Image area — click deadspace to dismiss */}
        <div
          className="flex-1 relative flex items-center justify-center overflow-hidden"
          onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
          {/* Nav arrows — appear on hover */}
          {hasPrev && (
            <button onClick={goPrev} className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.12] backdrop-blur-md text-white/40 hover:text-white flex items-center justify-center transition-all duration-200">
              <CaretLeft className="w-5 h-5" />
            </button>
          )}
          {hasNext && (
            <button onClick={goNext} className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.12] backdrop-blur-md text-white/40 hover:text-white flex items-center justify-center transition-all duration-200">
              <CaretRight className="w-5 h-5" />
            </button>
          )}

          {/* Image */}
          {image.media_type === 'video' ? (
            /* Video player — autoplay, loop, with controls */
            <video
              src={fullSrc}
              autoPlay
              loop
              muted
              controls
              className="max-h-[calc(100vh-7.5rem)] max-w-full object-contain select-none rounded-lg"
              onLoadedData={() => setImageLoaded(true)}
            />
          ) : (
            /* Image with zoom/pan */
            <div
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onClick={handleImageClick}
              className={`transition-transform duration-200 ease-out ${zoom > 1 ? 'cursor-grab' : 'cursor-zoom-in'} ${dragging ? 'cursor-grabbing' : ''}`}
              style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` }}
            >
              {!imageLoaded && <div className="w-48 h-48 bg-white/[0.03] rounded-2xl animate-pulse" />}
              <img
                src={fullSrc}
                alt={image.title || image.original_name}
                onLoad={() => setImageLoaded(true)}
                className={`max-h-[calc(100vh-7.5rem)] max-w-full object-contain select-none ${imageLoaded ? '' : 'hidden'}`}
                draggable={false}
              />
            </div>
          )}
        </div>
      </div>

      {/* Sidebar — Details panel */}
      {showInfo && (
        <div className="w-[340px] shrink-0 bg-bg-card border-l border-white/[0.04] overflow-y-auto hidden sm:flex flex-col">
          {/* Panel header — matches toolbar row 1 */}
          <div className="h-11 flex items-center px-5 border-b border-white/[0.04] shrink-0">
            <h2 className="text-[14px] font-semibold text-text">Details</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* File info — grouped list (iOS Settings style) */}
            <div className="bg-bg-elevated rounded-xl overflow-hidden divide-y divide-white/[0.04]">
              {[
                ['Name', image.original_name],
                ['Dimensions', `${image.width} × ${image.height}`],
                ['Size', formatSize(image.file_size)],
                ['Format', image.format?.toUpperCase()],
                image.uploaded_by ? ['Uploaded by', image.uploaded_by, true] : null,
              ].filter(Boolean).map(([label, value, isProfile]) => (
                <div key={label} className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[13px] text-text-secondary">{label}</span>
                  {isProfile && onViewProfile ? (
                    <button onClick={() => onViewProfile(value)} className="text-[13px] text-accent hover:underline truncate ml-3 max-w-[160px] cursor-pointer">{value}</button>
                  ) : (
                    <span className="text-[13px] text-text truncate ml-3 max-w-[160px]">{value}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Generation metadata */}
            <MetadataPanel image={displayImage} onTagFilter={(tag) => { onTagFilter?.(tag); onClose() }} />

            {/* Comments */}
            <div className="mt-5 pt-5 border-t border-white/[0.04]">
              <CommentSection imageId={image.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
