import { useState, useCallback } from 'react'
import { Copy, Check } from '@phosphor-icons/react'

export default function CopyButton({ text, label, className = '' }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback((e) => {
    e?.stopPropagation?.()
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      disabled={!text}
      className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md transition-all duration-200
        ${copied ? 'text-green' : 'text-text-muted hover:text-text-secondary hover:bg-white/[0.06]'}
        ${!text ? 'opacity-20 cursor-not-allowed' : ''}
        ${className}
      `}
      title={copied ? 'Copied' : `Copy${label ? ` ${label}` : ''}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}
