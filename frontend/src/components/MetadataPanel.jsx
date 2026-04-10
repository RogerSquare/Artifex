import { useState, useMemo, useEffect, useCallback } from 'react'
import { CaretRight, Sparkle, TreeStructure, Sliders, FileText, FilmStrip, Tag, X, Plus, CircleNotch, Eye } from '@phosphor-icons/react'
import CopyButton from './CopyButton'
import { API_URL } from '../config'

function Section({ title, icon: Icon, defaultOpen = false, children, actions }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-1 py-1.5 text-left group"
      >
        <CaretRight className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        {Icon && <Icon className="w-3.5 h-3.5 text-text-secondary" />}
        <span className="text-[12px] font-semibold text-text-secondary uppercase tracking-wide flex-1">{title}</span>
        {actions && <div onClick={e => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 transition-opacity">{actions}</div>}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

export default function MetadataPanel({ image, authHeaders = {}, onTagFilter }) {
  if (!image) return null

  const hasPrompt = image.prompt || image.negative_prompt
  const hasParams = image.model || image.sampler || image.steps || image.cfg_scale || image.seed
  const hasWorkflow = !!(image.prompt_json || image.workflow_json)
  const hasRaw = !!image.metadata_raw

  // Parse video metadata JSON
  const videoMeta = useMemo(() => {
    if (!image.video_metadata) return null
    try { return typeof image.video_metadata === 'string' ? JSON.parse(image.video_metadata) : image.video_metadata }
    catch { return null }
  }, [image.video_metadata])

  const hasVideoMeta = !!videoMeta

  if (!image.has_metadata && !hasPrompt && !hasParams && !hasWorkflow && !hasVideoMeta) {
    return (
      <div className="text-center py-8">
        <p className="text-[13px] text-text-muted">No generation data</p>
      </div>
    )
  }

  const fullMetadata = useMemo(() => {
    const parts = []
    if (image.prompt) parts.push(`Prompt: ${image.prompt}`)
    if (image.negative_prompt) parts.push(`Negative prompt: ${image.negative_prompt}`)
    if (image.model) parts.push(`Model: ${image.model}`)
    if (image.sampler) parts.push(`Sampler: ${image.sampler}`)
    if (image.steps) parts.push(`Steps: ${image.steps}`)
    if (image.cfg_scale) parts.push(`CFG Scale: ${image.cfg_scale}`)
    if (image.seed) parts.push(`Seed: ${image.seed}`)
    return parts.join('\n')
  }, [image])

  const workflowNodes = useMemo(() => {
    const src = image.prompt_json || image.workflow_json
    if (!src) return null
    try {
      const data = JSON.parse(src)
      if (data.nodes && Array.isArray(data.nodes)) {
        return data.nodes.map(node => ({ id: String(node.id), class_type: node.type || 'Unknown', inputs: (node.widgets_values || []).reduce((acc, val, i) => { if (val !== null && val !== undefined && val !== '') acc[`param_${i}`] = val; return acc }, {}) }))
      }
      if (typeof data === 'object' && !Array.isArray(data)) {
        return Object.entries(data).map(([id, node]) => ({ id, class_type: node.class_type || 'Unknown', inputs: node.inputs || {} }))
      }
    } catch (e) { /* invalid */ }
    return null
  }, [image.prompt_json, image.workflow_json])

  // Extract prompt text from workflow nodes as fallback when image.prompt is null
  const workflowPromptText = useMemo(() => {
    if (image.prompt) return image.prompt // already have it
    if (!workflowNodes) return null
    const textFields = ['prompt_text', 'text', 'string', 'value']
    const texts = []
    for (const node of workflowNodes) {
      // Look for text encode or prompt nodes
      const cls = (node.class_type || '').toLowerCase()
      if (cls.includes('text') || cls.includes('prompt') || cls.includes('string') || cls.includes('clip')) {
        for (const field of textFields) {
          const val = node.inputs[field]
          if (val && typeof val === 'string' && val.length > 10 && !val.startsWith('[') && !val.startsWith('{')) {
            texts.push(val)
          }
        }
      }
    }
    return texts.length > 0 ? texts[0] : null
  }, [image.prompt, workflowNodes])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-text-secondary uppercase tracking-wide">Generation</span>
        <CopyButton text={fullMetadata} label="Copy All" />
      </div>

      {/* 1. Tags */}
      {image.tags && image.tags.length > 0 && (
        <Section title="Tags" icon={Tag} defaultOpen>
          <div className="flex flex-wrap gap-1.5">
            {image.tags.map(tag => (
              <button
                key={tag.id}
                onClick={() => onTagFilter?.(tag.name)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-200 hover:scale-105
                  ${tag.source === 'vision' ? 'bg-accent/15 text-accent hover:bg-accent/25' :
                    tag.source === 'manual' ? 'bg-green/15 text-green hover:bg-green/25' :
                    'bg-white/[0.08] text-text-secondary hover:bg-white/[0.12] hover:text-text'}`}
                title={`${tag.category} · ${tag.source}`}
              >
                {tag.source === 'vision' && <Eye className="w-2.5 h-2.5" />}
                {tag.name}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* 2. Prompts */}
      {(hasPrompt || workflowPromptText) && (
        <Section title="Prompts" icon={Sparkle}>
          {(image.prompt || workflowPromptText) && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-green/80">Positive</span>
                <CopyButton text={image.prompt || workflowPromptText} />
              </div>
              <p className="text-[13px] text-text/70 bg-white/[0.03] rounded-xl px-3.5 py-3 break-words leading-relaxed max-h-44 overflow-y-auto">
                {image.prompt || workflowPromptText}
              </p>
            </div>
          )}
          {image.negative_prompt && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-red/80">Negative</span>
                <CopyButton text={image.negative_prompt} />
              </div>
              <p className="text-[13px] text-text/70 bg-white/[0.03] rounded-xl px-3.5 py-3 break-words leading-relaxed max-h-32 overflow-y-auto">
                {image.negative_prompt}
              </p>
            </div>
          )}
        </Section>
      )}

      {/* 3. TreeStructure (moved up from after Video Info) */}
      {hasWorkflow && (
        <Section
          title="Workflow"
          icon={TreeStructure}
          actions={
            (image.workflow_json || image.prompt_json) ? <CopyButton text={image.workflow_json || image.prompt_json} label="JSON" /> : null
          }
        >
          {workflowNodes ? (
            <div className="space-y-1.5">
              {workflowNodes.map(node => (
                <div key={node.id} className="bg-white/[0.03] rounded-xl px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-text-muted/60">#{node.id}</span>
                    <span className="text-[12px] font-medium text-accent">{node.class_type}</span>
                  </div>
                  {Object.keys(node.inputs).length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {Object.entries(node.inputs).map(([key, val]) => {
                        if (Array.isArray(val) || val === null || val === undefined || val === '' || typeof val === 'object') return null
                        const display = String(val)
                        if (display.length > 300) return null
                        return (
                          <div key={key} className="flex items-start gap-2 text-[11px]">
                            <span className="text-text-muted/50 shrink-0">{key}</span>
                            <span className="text-text-secondary break-all">{display}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <pre className="text-[11px] text-text-secondary/60 bg-white/[0.03] rounded-xl px-3.5 py-3 overflow-auto max-h-48 whitespace-pre-wrap break-words">
              {image.prompt_json || image.workflow_json}
            </pre>
          )}
        </Section>
      )}

      {/* 4. Parameters */}
      {hasParams && (
        <Section title="Parameters" icon={Sliders}>
          <div className="bg-bg-elevated rounded-xl overflow-hidden divide-y divide-white/[0.04]">
            {[
              ['Model', image.model],
              ['Sampler', image.sampler],
              ['Steps', image.steps],
              ['CFG Scale', image.cfg_scale],
              ['Seed', image.seed],
            ].filter(([, v]) => v !== null && v !== undefined).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-3.5 py-2.5 group/row">
                <span className="text-[13px] text-text-secondary">{label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[13px] text-text truncate max-w-[140px]">{String(value)}</span>
                  <div className="opacity-0 group-hover/row:opacity-100 transition-opacity">
                    <CopyButton text={String(value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 5. Video technical metadata */}
      {hasVideoMeta && (
        <Section title="Video Info" icon={FilmStrip}>
          <div className="bg-bg-elevated rounded-xl overflow-hidden divide-y divide-white/[0.04] mt-1">
            {[
              ['Codec', videoMeta.video_codec_long || videoMeta.video_codec],
              ['Resolution', videoMeta.width && videoMeta.height ? `${videoMeta.width} × ${videoMeta.height}` : null],
              ['Frame Rate', videoMeta.fps ? `${Math.round(videoMeta.fps * 100) / 100} fps` : null],
              ['Bitrate', videoMeta.bitrate ? `${(videoMeta.bitrate / 1000).toFixed(0)} kbps` : null],
              ['Duration', videoMeta.duration ? `${Math.floor(videoMeta.duration / 60)}:${String(Math.floor(videoMeta.duration % 60)).padStart(2, '0')}` : null],
              ['Container', videoMeta.container],
              ['Audio', videoMeta.audio_codec ? `${videoMeta.audio_codec}${videoMeta.audio_channels ? ` (${videoMeta.audio_channels}ch)` : ''}` : 'None'],
              videoMeta.seed ? ['Seed', videoMeta.seed] : null,
            ].filter(Boolean).filter(([, v]) => v !== null && v !== undefined).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-3.5 py-2.5 group/row">
                <span className="text-[13px] text-text-secondary">{label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[13px] text-text">{String(value)}</span>
                  <div className="opacity-0 group-hover/row:opacity-100 transition-opacity">
                    <CopyButton text={String(value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}



      {/* Raw */}
      {hasRaw && (
        <Section title="Raw" icon={FileText} defaultOpen={false} actions={<CopyButton text={image.metadata_raw} label="Copy" />}>
          <pre className="text-[11px] text-text-secondary/60 bg-white/[0.03] rounded-xl px-3.5 py-3 overflow-auto max-h-48 whitespace-pre-wrap break-words">
            {image.metadata_raw}
          </pre>
        </Section>
      )}
    </div>
  )
}
