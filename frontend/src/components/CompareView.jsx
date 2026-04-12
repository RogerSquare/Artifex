import { useState, useRef, useCallback, useEffect } from 'react'
import { X, ArrowsLeftRight, CaretLeft, CaretRight, MagnifyingGlassPlus, MagnifyingGlassMinus, ArrowsOut, DotsSixVertical } from '@phosphor-icons/react'
import { UPLOADS_URL } from '../config'

const Btn = ({ onClick, active, children, ...props }) => (
  <button onClick={onClick} className={`p-1.5 rounded-md transition-all duration-200 ${active ? 'text-white bg-white/[0.1]' : 'text-white/40 hover:text-white/80 hover:bg-white/[0.06]'}`} {...props}>{children}</button>
)

export default function CompareView({ imageA, imageB, onClose }) {
  const [mode, setMode] = useState('side') // 'side' | 'slider'
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [sliderPos, setSliderPos] = useState(50)
  const [draggingSlider, setDraggingSlider] = useState(false)
  const [draggingPan, setDraggingPan] = useState(false)
  const [swapped, setSwapped] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panStart = useRef({ x: 0, y: 0 })
  const sliderRef = useRef(null)

  const a = swapped ? imageB : imageA
  const b = swapped ? imageA : imageB
  const srcA = `${UPLOADS_URL}/${a.filepath}`
  const srcB = `${UPLOADS_URL}/${b.filepath}`

  // Keyboard
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 's') setSwapped(prev => !prev)
      else if (e.key === 'm') setMode(prev => prev === 'side' ? 'slider' : 'side')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Zoom
  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  const handleWheel = useCallback((e) => { e.preventDefault(); setZoom(prev => Math.min(5, Math.max(0.5, prev + (e.deltaY > 0 ? -0.15 : 0.15)))) }, [])

  // Pan (synced)
  const handleMouseDown = (e) => {
    if (zoom <= 1) return
    setDraggingPan(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    panStart.current = { ...pan }
  }
  const handleMouseMove = useCallback((e) => {
    if (draggingPan) {
      setPan({ x: panStart.current.x + (e.clientX - dragStart.current.x), y: panStart.current.y + (e.clientY - dragStart.current.y) })
    }
    if (draggingSlider && sliderRef.current) {
      const rect = sliderRef.current.getBoundingClientRect()
      const pos = Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100))
      setSliderPos(pos)
    }
  }, [draggingPan, draggingSlider])
  const handleMouseUp = useCallback(() => { setDraggingPan(false); setDraggingSlider(false) }, [])

  useEffect(() => {
    if (draggingPan || draggingSlider) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
    }
  }, [draggingPan, draggingSlider, handleMouseMove, handleMouseUp])

  // Metadata comparison
  const metaFields = ['model', 'sampler', 'steps', 'cfg_scale', 'seed']
  const hasDiffs = metaFields.some(f => a[f] !== b[f])

  const imageStyle = { transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transition: draggingPan ? 'none' : 'transform 0.15s ease-out' }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col animate-in fade-in duration-200">
      {/* Toolbar */}
      <div className="shrink-0 bg-black/60 backdrop-blur-xl border-b border-white/[0.04] z-10">
        <div className="h-11 flex items-center px-4 gap-3">
          <Btn onClick={onClose} title="Close (Esc)"><X className="w-4 h-4" /></Btn>
          <span className="text-[14px] font-medium text-white/90">Compare</span>
          <span className="text-[12px] text-white/25">{a.original_name} vs {b.original_name}</span>

          <div className="flex-1" />

          {/* Mode toggle */}
          <div className="flex items-center bg-white/[0.06] rounded-md p-[2px]">
            <button onClick={() => setMode('side')} className={`px-2.5 py-1 rounded text-[12px] font-medium transition-all ${mode === 'side' ? 'bg-white/[0.12] text-white' : 'text-white/40 hover:text-white/70'}`}>Side by Side</button>
            <button onClick={() => setMode('slider')} className={`px-2.5 py-1 rounded text-[12px] font-medium transition-all ${mode === 'slider' ? 'bg-white/[0.12] text-white' : 'text-white/40 hover:text-white/70'}`}>Slider</button>
          </div>

          <div className="w-px h-4 bg-white/[0.08]" />

          <Btn onClick={() => setSwapped(prev => !prev)} title="Swap A/B (S)"><ArrowsLeftRight className="w-4 h-4" /></Btn>
          <Btn onClick={() => setZoom(prev => Math.min(5, prev + 0.5))} title="Zoom in"><MagnifyingGlassPlus className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => setZoom(prev => Math.max(0.5, prev - 0.5))} title="Zoom out"><MagnifyingGlassMinus className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={resetZoom} title="Fit"><ArrowsOut className="w-3.5 h-3.5" /></Btn>
          {zoom !== 1 && <span className="text-[11px] text-white/25 tabular-nums">{Math.round(zoom * 100)}%</span>}
        </div>
      </div>

      {/* Image area */}
      <div className="flex-1 relative overflow-hidden" onWheel={handleWheel}>
        {mode === 'side' ? (
          /* Side by side */
          <div className="flex w-full h-full">
            <div className="flex-1 flex items-center justify-center overflow-hidden border-r border-white/[0.06]" onMouseDown={handleMouseDown}>
              <div style={imageStyle} className={zoom > 1 ? 'cursor-grab' : ''}>
                {a.media_type === 'video' ? (
                  <video src={srcA} muted autoPlay loop playsInline className="max-h-[calc(100vh-8rem)] max-w-full object-contain" />
                ) : (
                  <img src={srcA} alt={a.original_name} className="max-h-[calc(100vh-8rem)] max-w-full object-contain select-none" draggable={false} />
                )}
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center overflow-hidden" onMouseDown={handleMouseDown}>
              <div style={imageStyle} className={zoom > 1 ? 'cursor-grab' : ''}>
                {b.media_type === 'video' ? (
                  <video src={srcB} muted autoPlay loop playsInline className="max-h-[calc(100vh-8rem)] max-w-full object-contain" />
                ) : (
                  <img src={srcB} alt={b.original_name} className="max-h-[calc(100vh-8rem)] max-w-full object-contain select-none" draggable={false} />
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Slider overlay */
          <div ref={sliderRef} className="w-full h-full relative flex items-center justify-center" onMouseDown={handleMouseDown}>
            {/* Image B (full background) */}
            <div className="absolute inset-0 flex items-center justify-center" style={imageStyle}>
              {b.media_type === 'video' ? (
                <video src={srcB} muted autoPlay loop playsInline className="max-h-[calc(100vh-8rem)] max-w-full object-contain" />
              ) : (
                <img src={srcB} alt={b.original_name} className="max-h-[calc(100vh-8rem)] max-w-full object-contain select-none" draggable={false} />
              )}
            </div>
            {/* Image A (clipped by slider) */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ ...imageStyle, clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
              {a.media_type === 'video' ? (
                <video src={srcA} muted autoPlay loop playsInline className="max-h-[calc(100vh-8rem)] max-w-full object-contain" />
              ) : (
                <img src={srcA} alt={a.original_name} className="max-h-[calc(100vh-8rem)] max-w-full object-contain select-none" draggable={false} />
              )}
            </div>
            {/* Slider handle */}
            <div
              className="absolute top-0 bottom-0 z-20 cursor-col-resize flex items-center"
              style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
              onMouseDown={(e) => { e.stopPropagation(); setDraggingSlider(true) }}
            >
              <div className="w-[2px] h-full bg-white/60" />
              <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-8 h-8 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/30">
                <DotsSixVertical className="w-4 h-4 text-white/80" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Metadata comparison bar */}
      {hasDiffs && (
        <div className="shrink-0 bg-black/60 backdrop-blur-xl border-t border-white/[0.04] px-6 py-2.5">
          <div className="flex items-center gap-6 justify-center overflow-x-auto">
            {metaFields.map(field => {
              const valA = a[field]
              const valB = b[field]
              if (!valA && !valB) return null
              const isDiff = valA !== valB
              return (
                <div key={field} className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-white/30 capitalize">{field.replace('_', ' ')}</span>
                  <span className={`text-[11px] font-medium ${isDiff ? 'text-accent' : 'text-white/50'}`}>{valA || '—'}</span>
                  {isDiff && (
                    <>
                      <span className="text-[10px] text-white/20">→</span>
                      <span className="text-[11px] font-medium text-accent">{valB || '—'}</span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
