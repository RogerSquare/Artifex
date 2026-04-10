import { useState, useRef, useCallback, useEffect } from 'react'
import { UploadSimple, X, CheckCircle, WarningCircle, Image, CircleNotch, Copy } from '@phosphor-icons/react'
import { API_URL } from '../config'

const ACCEPTED = '.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov'
const MAX_FILE_SIZE = 500 * 1024 * 1024

export default function UploadZone({ onClose, onUploadComplete, authHeaders = {}, initialFiles }) {
  const [files, setFiles] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)
  const initialProcessed = useRef(false)

  const addFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(f => {
      const ext = f.name.toLowerCase().split('.').pop()
      return ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov'].includes(ext) && f.size <= MAX_FILE_SIZE
    })
    setFiles(prev => [...prev, ...valid.map(file => ({ file, preview: URL.createObjectURL(file), status: 'pending', result: null }))])
  }, [])

  const removeFile = useCallback((index) => {
    setFiles(prev => { const next = [...prev]; if (next[index].preview) URL.revokeObjectURL(next[index].preview); next.splice(index, 1); return next })
  }, [])

  // Pre-populate with pasted files on mount
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && !initialProcessed.current) {
      initialProcessed.current = true
      addFiles(initialFiles)
    }
  }, [initialFiles, addFiles])

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files) }
  const handleFileSelect = (e) => { if (e.target.files.length > 0) addFiles(e.target.files); e.target.value = '' }

  const handleUpload = async () => {
    const pending = files.filter(f => f.status === 'pending')
    if (pending.length === 0) return
    setUploading(true)

    for (let i = 0; i < pending.length; i += 5) {
      const batch = pending.slice(i, i + 5)
      const batchNames = batch.map(entry => entry.file.name)
      const formData = new FormData()
      batch.forEach(entry => formData.append('images', entry.file))

      setFiles(prev => prev.map(f => batchNames.includes(f.file.name) && f.status === 'pending' ? { ...f, status: 'uploading' } : f))

      try {
        const res = await fetch(`${API_URL}/images/upload`, { method: 'POST', body: formData, headers: authHeaders })
        const data = await res.json()
        if (res.ok) {
          setFiles(prev => prev.map(f => {
            const batchIdx = batchNames.indexOf(f.file.name)
            if (batchIdx === -1 || f.status !== 'uploading') return f
            const result = data.images?.[batchIdx]
            if (!result) return { ...f, status: 'error', result: { error: 'No result' } }
            if (result.duplicate) return { ...f, status: 'duplicate', result }
            if (result.error) return { ...f, status: 'error', result }
            return { ...f, status: 'done', result }
          }))
        } else {
          setFiles(prev => prev.map(f => batchNames.includes(f.file.name) && f.status === 'uploading' ? { ...f, status: 'error', result: { error: data.error || 'UploadSimple failed' } } : f))
        }
      } catch (err) {
        setFiles(prev => prev.map(f => batchNames.includes(f.file.name) && f.status === 'uploading' ? { ...f, status: 'error', result: { error: err.message } } : f))
      }
    }

    setUploading(false)
    onUploadComplete?.()
  }

  const pendingCount = files.filter(f => f.status === 'pending').length
  const doneCount = files.filter(f => f.status === 'done').length
  const dupCount = files.filter(f => f.status === 'duplicate').length
  const errorCount = files.filter(f => f.status === 'error').length
  const allDone = files.length > 0 && pendingCount === 0 && !uploading

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-bg-card rounded-2xl shadow-2xl shadow-black/50 w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden border border-white/[0.06]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 h-12 border-b border-white/[0.06]">
          <h2 className="text-[15px] font-semibold">Upload Images</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-white/[0.06] transition-all duration-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => inputRef.current?.click()}
            className={`rounded-2xl p-10 text-center cursor-pointer transition-all duration-300 border-2 border-dashed
              ${dragOver ? 'border-accent bg-accent/5 scale-[1.01]' : 'border-white/[0.1] hover:border-white/[0.2] hover:bg-white/[0.02]'}`}
          >
            <div className={`w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center transition-colors duration-300 ${dragOver ? 'bg-accent/15' : 'bg-bg-elevated'}`}>
              <Image className={`w-7 h-7 ${dragOver ? 'text-accent' : 'text-text-muted'}`} />
            </div>
            <p className="text-[15px] font-medium text-text mb-1">
              {dragOver ? 'Drop to upload' : 'Drop images here'}
            </p>
            <p className="text-[13px] text-text-muted">or click to browse — images and videos</p>
            <input ref={inputRef} type="file" accept={ACCEPTED} multiple onChange={handleFileSelect} className="hidden" />
          </div>

          {files.length > 0 && (
            <div className="mt-4 bg-bg-elevated/50 rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
              {files.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-3 px-4 py-3">
                  <img src={entry.preview} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-text truncate">{entry.file.name}</p>
                    {entry.status === 'duplicate' ? (
                      <p className="text-[11px] text-yellow">Duplicate — already exists</p>
                    ) : (
                      <p className="text-[11px] text-text-muted">{(entry.file.size / 1024).toFixed(0)} KB</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {entry.status === 'pending' && (
                      <button onClick={(e) => { e.stopPropagation(); removeFile(idx) }} className="p-1.5 text-text-muted hover:text-red rounded-lg transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    {entry.status === 'uploading' && <CircleNotch className="w-4 h-4 text-accent animate-spin" />}
                    {entry.status === 'done' && <CheckCircle className="w-4 h-4 text-green" />}
                    {entry.status === 'duplicate' && <Copy className="w-4 h-4 text-yellow" />}
                    {entry.status === 'error' && <WarningCircle className="w-4 h-4 text-red" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 h-14 border-t border-white/[0.06]">
          {allDone ? (
            <>
              <span className="text-[13px] font-medium">
                <span className="text-green">{doneCount} uploaded</span>
                {dupCount > 0 && <span className="text-yellow ml-1.5">· {dupCount} skipped</span>}
                {errorCount > 0 && <span className="text-red ml-1.5">· {errorCount} failed</span>}
              </span>
              <button onClick={onClose} className="h-8 px-4 bg-accent hover:bg-accent-hover text-white rounded-lg text-[13px] font-semibold transition-all duration-200">Done</button>
            </>
          ) : (
            <>
              <span className="text-[13px] text-text-muted">{pendingCount > 0 ? `${pendingCount} ready` : 'Add images above'}</span>
              <button
                onClick={handleUpload}
                disabled={pendingCount === 0 || uploading}
                className="h-8 px-4 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold transition-all duration-200 flex items-center gap-1.5"
              >
                {uploading ? <CircleNotch className="w-4 h-4 animate-spin" /> : <UploadSimple className="w-4 h-4" />}
                {uploading ? 'Uploading...' : 'UploadSimple'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
