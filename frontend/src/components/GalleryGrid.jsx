import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { CircleNotch, DotsSixVertical } from '@phosphor-icons/react'
import ImageCard from './ImageCard'
import { API_URL } from '../config'

// Grid density presets: max columns on desktop
const GRID_SIZES = { compact: 5, comfortable: 4, large: 3 }

// Hook to track responsive column count based on grid size preference
function useColumnCount(gridSize = 'comfortable') {
  const maxCols = GRID_SIZES[gridSize] || 4

  const [cols, setCols] = useState(() => {
    if (typeof window === 'undefined') return Math.min(maxCols, 4)
    const w = window.innerWidth
    if (w < 640) return 2
    if (w < 1024) return Math.min(maxCols, 3)
    return maxCols
  })

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      if (w < 640) setCols(2)
      else if (w < 1024) setCols(Math.min(maxCols, 3))
      else setCols(maxCols)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [maxCols])

  return cols
}

const PAGE_SIZE = 50

export default function GalleryGrid({ filters, galleryTab = 'all', gridSize = 'comfortable', onSelectImage, onImagesChange, authHeaders = {}, selectable, selectedIds = [], onToggleSelect, onToggleFavorite, onContextMenu, reorderMode, onReorderChange, currentUserId }) {
  const [images, setImages] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const loaderRef = useRef(null)

  const fetchImages = useCallback(async (offset = 0, append = false) => {
    if (!append) setLoading(true)
    else setLoadingMore(true)

    try {
      // Build query string from filters
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset })
      if (filters?.model) params.set('model', filters.model)
      if (filters?.sampler) params.set('sampler', filters.sampler)
      if (filters?.has_metadata !== undefined) params.set('has_metadata', filters.has_metadata)
      if (filters?.media_type) params.set('media_type', filters.media_type)
      if (filters?.sort) params.set('sort', filters.sort)
      if (filters?.tag) params.set('tag', filters.tag)

      // Select endpoint based on gallery tab
      let baseUrl
      if (filters?.query) {
        baseUrl = `${API_URL}/images/search?q=${encodeURIComponent(filters.query)}&${params}`
      } else if (galleryTab === 'public') {
        baseUrl = `${API_URL}/images/public?${params}`
      } else if (galleryTab === 'mine') {
        baseUrl = `${API_URL}/images/mine?${params}`
      } else if (galleryTab === 'favorites') {
        baseUrl = `${API_URL}/images/favorites?${params}`
      } else {
        baseUrl = `${API_URL}/images?${params}`
      }

      const res = await fetch(baseUrl, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setImages(prev => append ? [...prev, ...data.images] : data.images)
        setTotal(data.total)
      }
    } catch { /* ignore */ }
    finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filters, galleryTab, authHeaders])

  // Refetch when filters change
  useEffect(() => {
    setImages([])
    fetchImages(0, false)
  }, [fetchImages])

  // Notify parent of images list for viewer navigation
  useEffect(() => {
    onImagesChange?.(images)
  }, [images, onImagesChange])

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const el = loaderRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingMore && !loading && images.length < total) {
          fetchImages(images.length, true)
        }
      },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [images.length, total, loading, loadingMore, fetchImages])

  // Wrap favorite toggle to update local images state optimistically
  const handleToggleFavorite = useCallback((imageId) => {
    setImages(prev => prev.map(img =>
      img.id === imageId
        ? { ...img, is_favorited: !img.is_favorited, favorite_count: (img.favorite_count || 0) + (img.is_favorited ? -1 : 1) }
        : img
    ))
    onToggleFavorite?.(imageId)
  }, [onToggleFavorite])

  // Drag-and-drop reorder state (favorites only)
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const [reorderedImages, setReorderedImages] = useState(null)

  // When reorderMode activates, snapshot the current images for reordering
  useEffect(() => {
    if (reorderMode) setReorderedImages([...images])
    else setReorderedImages(null)
  }, [reorderMode])

  // Keep reorderedImages in sync if images load while reorder mode is already on
  useEffect(() => {
    if (reorderMode && images.length > 0 && !reorderedImages) {
      setReorderedImages([...images])
    }
  }, [images, reorderMode, reorderedImages])

  // Notify parent of reordered image IDs whenever they change
  useEffect(() => {
    if (reorderedImages) onReorderChange?.(reorderedImages.map(i => i.id))
  }, [reorderedImages, onReorderChange])

  const handleDragStart = useCallback((e, idx) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', idx)
  }, [])

  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverIdx(idx)
  }, [])

  const handleDrop = useCallback((e, dropIdx) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setOverIdx(null); return }
    setReorderedImages(prev => {
      const imgs = [...prev]
      const [moved] = imgs.splice(dragIdx, 1)
      imgs.splice(dropIdx, 0, moved)
      return imgs
    })
    setDragIdx(null)
    setOverIdx(null)
  }, [dragIdx])

  const handleDragEnd = useCallback(() => {
    setDragIdx(null)
    setOverIdx(null)
  }, [])

  const columnCount = useColumnCount(gridSize)

  // Distribute images into columns by shortest-column-first (even height distribution)
  const columns = useMemo(() => {
    const cols = Array.from({ length: columnCount }, () => ({ items: [], height: 0 }))
    images.forEach(image => {
      // Find the shortest column
      let shortest = 0
      for (let i = 1; i < cols.length; i++) {
        if (cols[i].height < cols[shortest].height) shortest = i
      }
      cols[shortest].items.push(image)
      // Estimate height from aspect ratio (or default to 1:1)
      const aspect = image.width && image.height ? image.height / image.width : 1
      cols[shortest].height += aspect
    })
    return cols
  }, [images, columnCount])

  if (loading) {
    return (
      <div className="flex gap-4" style={{ columns: columnCount }}>
        {Array.from({ length: columnCount }).map((_, col) => (
          <div key={col} className="flex-1 flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-bg-card animate-pulse" style={{ height: `${200 + (i * 40)}px` }} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (images.length === 0) return null

  // Reorder mode: flat grid with drag handles (like CollectionDetail)
  if (reorderMode && reorderedImages) {
    return (
      <div>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
          {reorderedImages.map((image, idx) => (
            <div
              key={image.id}
              className={`relative group transition-all duration-200 ${dragIdx === idx ? 'opacity-40 scale-95' : ''} ${overIdx === idx && dragIdx !== idx ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg rounded-2xl' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
            >
              <ImageCard image={image} onClick={() => {}} />
              <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-grab active:cursor-grabbing">
                <DotsSixVertical className="w-3 h-3 text-white" />
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-text-muted/50 text-xs py-6">
          Drag to reorder · {reorderedImages.length} image{reorderedImages.length !== 1 ? 's' : ''}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-4">
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="flex-1 flex flex-col gap-4">
            {col.items.map(image => (
              <ImageCard
                key={image.id}
                image={image}
                onClick={onSelectImage}
                selectable={selectable}
                selected={selectedIds.includes(image.id)}
                onToggleSelect={onToggleSelect}
                onToggleFavorite={handleToggleFavorite}
                onContextMenu={onContextMenu}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Infinite scroll trigger */}
      {images.length < total && (
        <div ref={loaderRef} className="flex justify-center py-8">
          {loadingMore && (
            <div className="flex items-center gap-2 text-text-muted">
              <CircleNotch className="w-4 h-4 animate-spin" />
              <span className="text-xs">Loading more...</span>
            </div>
          )}
        </div>
      )}

      {/* End of results */}
      {images.length >= total && images.length > 0 && (
        <p className="text-center text-text-muted/50 text-xs py-6">
          {total} image{total !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
