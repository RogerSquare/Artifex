import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Globe, Lock, PencilSimple, Check, X, DotsSixVertical, CircleNotch } from '@phosphor-icons/react'
import { useAuth } from '../context/AuthContext'
import { API_URL } from '../config'
import ImageCard from './ImageCard'

export default function CollectionDetail({ collection, onBack, onSelectImage, selectMode, selectedIds = [], onToggleSelect, onImagesChange }) {
  const { user, authHeaders } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(collection.name)
  const [editDesc, setEditDesc] = useState(collection.description || '')

  // Reorder mode (internal — only toggle lives here)
  const [reorderMode, setReorderMode] = useState(false)
  const [reorderedImages, setReorderedImages] = useState(null)
  const [reorderSaving, setReorderSaving] = useState(false)
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)

  const isOwner = collection.user_id === user?.id

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/collections/${collection.id}`, { headers: authHeaders })
      if (res.ok) setData(await res.json())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [collection.id, authHeaders])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  // Notify parent of images list so App can do Select All / track images
  useEffect(() => {
    if (data?.images) onImagesChange?.(data.images)
  }, [data?.images, onImagesChange])

  const handleSave = async () => {
    try {
      await fetch(`${API_URL}/collections/${collection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null })
      })
      setEditing(false)
      fetchDetail()
    } catch (e) { console.error(e) }
  }

  // Reorder mode helpers
  const enterReorderMode = useCallback(() => {
    if (!data) return
    setReorderedImages([...data.images])
    setReorderMode(true)
  }, [data])

  const cancelReorder = useCallback(() => {
    setReorderMode(false)
    setReorderedImages(null)
    setDragIdx(null)
    setOverIdx(null)
  }, [])

  const saveReorder = useCallback(async () => {
    if (!reorderedImages) return
    setReorderSaving(true)
    try {
      const res = await fetch(`${API_URL}/collections/${collection.id}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ imageIds: reorderedImages.map(i => i.id) })
      })
      if (res.ok) {
        setReorderMode(false)
        setReorderedImages(null)
        fetchDetail()
      }
    } catch (e) { fetchDetail() }
    finally { setReorderSaving(false) }
  }, [reorderedImages, collection.id, authHeaders, fetchDetail])

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

  // Exit reorder if select mode activates
  useEffect(() => {
    if (selectMode && reorderMode) cancelReorder()
  }, [selectMode, reorderMode, cancelReorder])

  if (loading) return <div className="text-center py-16 text-text-muted text-[14px]">Loading...</div>
  if (!data) return <div className="text-center py-16 text-text-muted text-[14px]">Collection not found</div>

  const displayImages = reorderMode && reorderedImages ? reorderedImages : data.images

  return (
    <div className="max-w-[1400px] mx-auto px-5 sm:px-8 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1.5 -ml-1 rounded-md text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-[20px] font-bold text-text bg-transparent focus:outline-none border-b border-accent/30 pb-0.5" autoFocus />
              <button onClick={handleSave} className="p-1.5 text-green hover:bg-green/10 rounded-md transition-colors"><Check className="w-4 h-4" /></button>
              <button onClick={() => setEditing(false)} className="p-1.5 text-text-muted hover:text-text rounded-md transition-colors"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-[20px] font-bold text-text truncate">{data.name}</h2>
              {data.visibility === 'public' ? <Globe className="w-4 h-4 text-green shrink-0" /> : <Lock className="w-4 h-4 text-text-muted shrink-0" />}
              {isOwner && !selectMode && !reorderMode && (
                <button onClick={() => setEditing(true)} className="p-1.5 text-text-muted hover:text-text rounded-md hover:bg-white/[0.06] transition-colors">
                  <PencilSimple className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          {data.description && !editing && <p className="text-[13px] text-text-muted mt-0.5">{data.description}</p>}
          <p className="text-[12px] text-text-muted/60 mt-1">{data.image_count} image{data.image_count !== 1 ? 's' : ''}{data.owner_username ? ` · by ${data.owner_username}` : ''}</p>
        </div>

        {/* Reorder toggle — only shows for owners when not in select mode */}
        {isOwner && !editing && !selectMode && data.images.length > 0 && (
          <div className="flex items-center gap-2">
            {reorderMode ? (
              <>
                <button
                  onClick={cancelReorder}
                  disabled={reorderSaving}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={saveReorder}
                  disabled={reorderSaving}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent-hover transition-all duration-200 flex items-center gap-1.5"
                >
                  {reorderSaving && <CircleNotch className="w-3 h-3 animate-spin" />}
                  Save Order
                </button>
              </>
            ) : (
              <button
                onClick={enterReorderMode}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all duration-200"
              >
                Reorder
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="mb-6">
          <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full bg-bg-card rounded-xl px-4 py-3 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none" />
        </div>
      )}

      {/* Images grid */}
      {data.images.length === 0 ? (
        <div className="text-center py-20 text-text-muted">
          <p className="text-[15px]">No images in this collection</p>
          <p className="text-[13px] text-text-muted/60 mt-1">Add images from the gallery using the "Add to Collection" action</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {displayImages.map((img, idx) => (
              <div
                key={img.id}
                className={`relative group transition-all duration-200
                  ${reorderMode && dragIdx === idx ? 'opacity-40 scale-95' : ''}
                  ${reorderMode && overIdx === idx && dragIdx !== idx ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg rounded-2xl' : ''}`}
                draggable={reorderMode}
                onDragStart={reorderMode ? (e) => handleDragStart(e, idx) : undefined}
                onDragOver={reorderMode ? (e) => handleDragOver(e, idx) : undefined}
                onDrop={reorderMode ? (e) => handleDrop(e, idx) : undefined}
                onDragEnd={reorderMode ? handleDragEnd : undefined}
              >
                <ImageCard
                  image={img}
                  onClick={selectMode ? () => onToggleSelect?.(img.id) : reorderMode ? () => {} : () => onSelectImage?.(img)}
                  selectable={selectMode}
                  selected={selectedIds.includes(img.id)}
                  onToggleSelect={selectMode ? onToggleSelect : undefined}
                />
                {reorderMode && (
                  <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-grab active:cursor-grabbing">
                    <DotsSixVertical className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {reorderMode && (
            <p className="text-center text-text-muted/50 text-xs py-6">
              Drag to reorder · {displayImages.length} image{displayImages.length !== 1 ? 's' : ''}
            </p>
          )}
        </>
      )}
    </div>
  )
}
