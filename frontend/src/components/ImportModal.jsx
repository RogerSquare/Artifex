import { useState } from 'react'
import { FolderOpen, X, CircleNotch, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { API_URL } from '../config'

export default function ImportModal({ onClose, onImportComplete }) {
  const [folderPath, setFolderPath] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleImport = async () => {
    if (!folderPath.trim()) return
    setImporting(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch(`${API_URL}/images/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: folderPath.trim() })
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'Import failed')
      else { setResult(data); if (data.imported > 0) onImportComplete?.() }
    } catch (err) {
      setError(err.message || 'Connection failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-bg-card rounded-2xl shadow-2xl shadow-black/50 w-full max-w-md overflow-hidden border border-white/[0.06]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 h-12 border-b border-white/[0.06]">
          <h2 className="text-[15px] font-semibold">Import Folder</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-white/[0.06] transition-all duration-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-[13px] text-text-secondary mb-3">Enter the path to a folder of AI-generated images. Subfolders are scanned recursively.</p>
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !importing) handleImport() }}
              placeholder="C:\Users\...\ComfyUI\output"
              disabled={importing}
              className="w-full h-10 bg-bg-elevated rounded-xl px-4 text-[14px] text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 transition-all duration-200"
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red/10 rounded-xl">
              <WarningCircle className="w-4 h-4 text-red shrink-0" />
              <span className="text-[13px] text-red">{error}</span>
            </div>
          )}

          {result && (
            <div className="bg-bg-elevated rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-green" />
                <span className="text-[15px] font-semibold">Import Complete</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-bg-card rounded-xl">
                  <p className="text-xl font-bold text-green">{result.imported}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">Imported</p>
                </div>
                <div className="text-center p-3 bg-bg-card rounded-xl">
                  <p className="text-xl font-bold text-yellow">{result.skipped}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">Skipped</p>
                </div>
                <div className="text-center p-3 bg-bg-card rounded-xl">
                  <p className="text-xl font-bold text-red">{result.errors}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">Errors</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 h-14 border-t border-white/[0.06]">
          {result ? (
            <button onClick={onClose} className="h-8 px-4 bg-accent hover:bg-accent-hover text-white rounded-lg text-[13px] font-semibold transition-all duration-200">Done</button>
          ) : (
            <>
              <button onClick={onClose} className="h-8 px-4 text-text-secondary hover:text-text rounded-lg text-[13px] font-medium transition-colors">Cancel</button>
              <button
                onClick={handleImport}
                disabled={!folderPath.trim() || importing}
                className="h-8 px-4 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold transition-all duration-200 flex items-center gap-1.5"
              >
                {importing ? <CircleNotch className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
                {importing ? 'Importing...' : 'Import'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
