/**
 * dsh-token-plan-monitor — client half (browser bundle).
 *
 * Renders the sidebar usage card and the「用量监控」settings page.
 * Data comes from the host over same-origin HTTP endpoints.
 */

declare const require: (id: string) => any
declare const window: any
declare const document: any
declare const fetch: any
declare const Response: any
declare const URL: any
declare const URLSearchParams: any
declare const setInterval: (fn: () => void, ms: number) => number
declare const clearInterval: (handle: number) => void

/** Minimal React surface used by this bundle (the loader's `require('react')`). */
interface ReactLike {
  useState<S>(initial: S): [S, (next: S | ((prev: S) => S)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useCallback<F extends (...args: any[]) => any>(fn: F, deps: readonly unknown[]): F
  createElement(type: any, props: any | null, ...children: any[]): any
}

const React: ReactLike = require('react')
const { useState, useEffect, useCallback } = React
const h = React.createElement

import type { EntryView, ProviderView, Snapshot, UsageLine } from './types'

const WIDGET_CSS = `
.tpm-card{box-sizing:border-box;border-radius:12px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));background:var(--dsw-alias-bg-module-platform, rgba(128,128,128,.06));padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-family:inherit;font-size:12px;color:var(--dsw-alias-label-primary, inherit);text-align:left;cursor:pointer;width:100%;min-width:0;flex:1;transition:background .15s ease,border-color .15s ease}
.tpm-card:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.09))}
.tpm-card:focus-visible{outline:2px solid var(--dsw-alias-border-l3, rgba(128,128,128,.5));outline-offset:2px;border-radius:12px}
.tpm-head{display:flex;align-items:center;gap:6px;min-width:0}
.tpm-title{font-weight:600;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.tpm-chevron{margin-left:auto;color:var(--dsw-alias-label-tertiary, rgba(128,128,128,.65));font-size:10px;flex:none}
.tpm-provider{display:flex;flex-direction:column;gap:5px;min-width:0}
.tpm-provider+.tpm-provider{border-top:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.15));padding-top:8px}
.tpm-prow{display:flex;align-items:center;gap:6px;min-width:0}
.tpm-pname{font-weight:500;font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tpm-pbadge{font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-brand-primary, #4f8cff);color:#fff;flex:none}
.tpm-prefresh{margin-left:auto;cursor:pointer;background:transparent;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));color:var(--dsw-alias-label-tertiary, rgba(128,128,128,.65));border-radius:6px;font-size:11px;line-height:1;padding:3px 6px;flex:none}
.tpm-prefresh:hover{color:var(--dsw-alias-label-primary)}
.tpm-prefresh:disabled{opacity:.5;cursor:default}
.tpm-lines{display:flex;flex-direction:column;gap:2px}
.tpm-line-ok{color:var(--dsw-alias-label-secondary, rgba(128,128,128,.85))}
.tpm-line-muted{color:var(--dsw-alias-label-tertiary, rgba(128,128,128,.65))}
.tpm-line-warn{color:var(--dsw-alias-state-warn-label, #f59e0b)}
.tpm-line-error{color:var(--dsw-alias-state-error-primary, #ef4444)}
.tpm-err{color:var(--dsw-alias-state-error-primary, #ef4444);font-size:11px;line-height:16px;word-break:break-all}
.tpm-empty{color:var(--dsw-alias-label-tertiary, rgba(128,128,128,.65));font-size:11px;line-height:16px}
.tpm-bars{display:grid;grid-template-columns:max-content max-content minmax(2em,1fr);gap:2px .25em;align-items:center;min-width:0;font-size:11px;line-height:1.6;font-family:var(--ds-font-family-code, ui-monospace,'SF Mono',Consolas,'Courier New',monospace)}
.tpm-brow{display:contents}
.tpm-time{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;color:var(--dsw-alias-label-tertiary, rgba(128,128,128,.65));font-variant-numeric:tabular-nums}
.tpm-percent{white-space:nowrap;text-align:right;color:var(--dsw-alias-label-secondary, rgba(128,128,128,.85));font-variant-numeric:tabular-nums}
.tpm-btrack{height:.3em;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));overflow:hidden;min-width:0}
.tpm-bfill{height:100%;border-radius:999px;transition:width .3s ease}
.tpm-bfill-ok{background:var(--dsw-alias-state-success-primary, #22c55e)}
.tpm-bfill-warn{background:var(--dsw-alias-state-warn-label, #f59e0b)}
.tpm-bfill-error{background:var(--dsw-alias-state-error-primary, #ef4444)}
@media (prefers-reduced-motion:reduce){.tpm-card{transition:none}.tpm-bfill{transition:none}.tpm-chev{transition:none}}

.tpm-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}
.tpm-pageHeader{padding:0 0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:12px;flex-direction:column;gap:4px;display:flex}
.tpm-pageTitle{color:var(--dsw-alias-label-primary);font-size:18px;font-weight:600;line-height:1.4;margin:0}
.tpm-pageDesc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5;margin:0}
.tpm-providerBlock{flex-direction:column;display:flex;min-width:0;padding:0 0 12px}
.tpm-providerBlock+.tpm-providerBlock{border-top:1px solid var(--dsw-alias-border-l2);padding-top:12px}
.tpm-blockHead{align-items:center;gap:8px;padding:0 0 6px;display:flex}
.tpm-blockName{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:14px;font-weight:600;line-height:1.5}
.tpm-stateBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.tpm-rowDesc{color:var(--dsw-alias-label-tertiary);margin:0 0 12px;font-size:12px;line-height:1.5}
.tpm-field{flex-direction:column;gap:6px;padding:0 0 12px;display:flex}
.tpm-fieldLabel{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.tpm-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.tpm-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.tpm-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.tpm-fieldNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.tpm-blockFooter{justify-content:flex-end;align-items:center;gap:8px;margin-top:4px;padding:0;display:flex}
.tpm-blockActions{align-items:center;gap:8px;display:inline-flex}
.tpm-btnSave,.tpm-btnDiscard{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.tpm-btnDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.tpm-btnDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.tpm-btnSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.tpm-btnSave:disabled,.tpm-btnDiscard:disabled{opacity:.4;cursor:default}
.tpm-btnSave:focus-visible,.tpm-btnDiscard:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
`

function ensureWidgetCss() {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-token-plan-monitor/widget.css'
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-token-plan-monitor'
  tag.dataset.pluginCss = tagId
  tag.textContent = WIDGET_CSS
  document.head.appendChild(tag)
}

async function fetchSnapshot(force = false, providerId?: string): Promise<Snapshot | null> {
  try {
    const query = new URLSearchParams()
    if (force) query.set('force', '1')
    if (providerId) query.set('provider', providerId)
    const qs = query.toString()
    const res = await fetch(`/api/token-plan-monitor${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return null
  }
}

async function saveProvider(providerId: string, config: Record<string, string>): Promise<Snapshot | null> {
  try {
    const res = await fetch('/api/token-plan-monitor/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'save', provider: providerId, config }),
    })
    const data = await res.json()
    return data?.snapshot ?? null
  } catch {
    return null
  }
}

async function clearProvider(providerId: string): Promise<Snapshot | null> {
  try {
    const res = await fetch('/api/token-plan-monitor/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'clear', provider: providerId }),
    })
    const data = await res.json()
    return data?.snapshot ?? null
  } catch {
    return null
  }
}

function toneClass(tone: UsageLine['tone']): string {
  if (tone === 'warn') return 'tpm-line-warn'
  if (tone === 'error') return 'tpm-line-error'
  if (tone === 'muted') return 'tpm-line-muted'
  return 'tpm-line-ok'
}

function barToneClass(tone: UsageLine['tone']): string {
  if (tone === 'warn') return 'tpm-bfill-warn'
  if (tone === 'error') return 'tpm-bfill-error'
  return 'tpm-bfill-ok'
}

function BarRow(props: { line: UsageLine }) {
  const bar = props.line.bar!
  const width = Math.min(100, Math.max(0, bar.percent))
  const time = bar.note ? `${bar.note}/${bar.label}` : bar.label
  return h('div', { className: 'tpm-brow' },
    h('span', { className: 'tpm-time' }, time),
    h('span', { className: 'tpm-percent' }, props.line.text),
    h('div', { className: 'tpm-btrack' },
      h('div', { className: `tpm-bfill ${barToneClass(props.line.tone)}`, style: { width: `${width}%` } })),
  )
}

function ProviderSection(props: {
  provider: ProviderView
  entry: EntryView
  busy: boolean
  onRefresh: (id: string) => void
}) {
  const { provider, entry, busy, onRefresh } = props
  const head = h('div', { className: 'tpm-prow' },
    h('span', { className: 'tpm-pname' }, provider.name),
    provider.current ? h('span', { className: 'tpm-pbadge' }, '当前') : null,
    h('button', {
      className: 'tpm-prefresh',
      title: '立即刷新',
      disabled: busy,
      onClick: (ev: any) => {
        ev.stopPropagation()
        onRefresh(provider.id)
      },
    }, busy ? '…' : '↻'),
  )

  let body: any
  if (!provider.usageConfigured) {
    body = h('div', { className: 'tpm-empty' },
      '未配置用量查询 · 到设置「用量监控」中填写参数')
  } else if (entry.state === 'error' && entry.error) {
    body = h('div', { className: 'tpm-err' }, entry.error.hint || entry.error.message || entry.error.code)
  } else if (entry.lines.length > 0) {
    const bars = entry.lines.filter((line) => line.bar)
    const texts = entry.lines.filter((line) => !line.bar)
    body = h('div', { className: 'tpm-lines' },
      ...texts.map((line, i) => h('div', { key: `text-${i}`, className: toneClass(line.tone) }, line.text)),
      bars.length > 0 ? h('div', { className: 'tpm-bars' },
        ...bars.map((line, i) => h(BarRow, { key: `bar-${i}`, line }))) : null,
    )
  } else {
    body = h('div', { className: 'tpm-empty' }, '暂无数据')
  }

  return h('div', { className: 'tpm-provider' }, head, body)
}

function Widget(props: any) {
  const wide = props.wide !== false
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const s = await fetchSnapshot(false)
    if (s) setSnap(s)
  }, [])

  useEffect(() => {
    if (!wide) return
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load, wide])

  const refresh = (id: string) => {
    setBusy((prev) => ({ ...prev, [id]: true }))
    fetchSnapshot(true, id).then((s) => {
      setBusy({})
      if (s) setSnap(s)
    })
  }

  // 侧边栏折叠（56px rail）时不展示用量卡片。
  if (!wide) return null

  if (!snap || snap.providers.length === 0) return null

  const shown = expanded
    ? snap.providers
    : snap.providers.filter((p) => p.current).length > 0
      ? snap.providers.filter((p) => p.current)
      : snap.providers.slice(0, 1)

  const sections = shown.map((p) => h(ProviderSection, {
    key: p.id,
    provider: p,
    entry: snap.entries[p.id] ?? { configured: false, state: 'idle', lines: [], error: null, fetchedAt: 0 },
    busy: !!busy[p.id],
    onRefresh: refresh,
  }))

  return h('div', {
    className: 'tpm-card',
    role: 'button',
    tabIndex: 0,
    onClick: () => setExpanded(!expanded),
    onKeyDown: (ev: any) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        setExpanded(!expanded)
      }
    },
  },
    h('div', { className: 'tpm-head' },
      h('span', { className: 'tpm-title' }, '用量监控'),
      h('span', { className: 'tpm-chevron' }, expanded ? '收起 ▾' : '展开 ▴'),
    ),
    ...sections,
  )
}

// 设置页组件会在每次打开时重新挂载，这里用模块级缓存避免每次都先显示“加载中”。
let settingsSnapshotCache: Snapshot | null = null

function SettingsSection() {
  const [snap, setSnap] = useState<Snapshot | null>(settingsSnapshotCache)
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const applySnapshot = (s: Snapshot | null) => {
    if (!s) return
    settingsSnapshotCache = s
    setSnap(s)
  }

  const load = useCallback(async () => {
    applySnapshot(await fetchSnapshot(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Seed one form per provider from the current (masked) config.
  useEffect(() => {
    if (!snap) return
    setForms((prev) => {
      let next: Record<string, Record<string, string>> | null = null
      for (const p of snap.providers) {
        if (prev[p.id] !== undefined) continue
        if (next === null) next = { ...prev }
        const seed: Record<string, string> = {}
        for (const f of p.configFields) {
          const v = p.config[f.key]
          if (v !== undefined) seed[f.key] = f.type === 'password' ? '' : v
        }
        next[p.id] = seed
      }
      return next ?? prev
    })
  }, [snap])

  const setField = (id: string, key: string, value: string) => {
    setForms((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [key]: value } }))
  }

  const save = async (p: ProviderView) => {
    setSaving((prev) => ({ ...prev, [p.id]: true }))
    applySnapshot(await saveProvider(p.id, forms[p.id] ?? {}))
    setSaving((prev) => ({ ...prev, [p.id]: false }))
  }

  const clear = async (id: string) => {
    applySnapshot(await clearProvider(id))
  }

  const blocks = snap?.providers.map((p) => {
    const e = snap.entries[p.id] ?? { configured: false, state: 'idle', lines: [], error: null, fetchedAt: 0 }
    const form = forms[p.id] ?? {}

    const statusText = e.configured ? '已配置' : '未配置用量查询'

    const fields = p.configFields.map((f) => h('label', { key: f.key, className: 'tpm-field' },
      h('span', { className: 'tpm-fieldLabel' }, f.label),
      h('input', {
        className: 'tpm-input',
        type: f.type === 'password' ? 'password' : 'text',
        placeholder: f.placeholder ?? '',
        value: form[f.key] !== undefined ? form[f.key] : '',
        onChange: (ev: any) => setField(p.id, f.key, ev.target.value),
      }),
      f.type === 'password' && p.config[f.key]
        ? h('span', { className: 'tpm-fieldNote' }, '已保存，留空则保持不变')
        : null,
    ))

    const hasSaved = p.configFields.some((f) => p.config[f.key] !== undefined)

    const actions = h('div', { className: 'tpm-blockActions' },
      p.configFields.length > 0
        ? h('button', {
          className: 'tpm-btnSave',
          disabled: !!saving[p.id],
          onClick: () => save(p),
        }, saving[p.id] ? '保存中…' : '保存')
        : null,
      hasSaved
        ? h('button', { className: 'tpm-btnDiscard', onClick: () => clear(p.id) }, '清除配置')
        : null,
    )

    return h('div', { key: p.id, className: 'tpm-providerBlock' },
      h('div', { className: 'tpm-blockHead' },
        h('span', { className: 'tpm-blockName' }, p.name),
        h('span', { className: 'tpm-stateBadge' }, statusText),
      ),
      h('p', { className: 'tpm-rowDesc' }, p.description),
      ...fields,
      h('div', { className: 'tpm-blockFooter' }, actions),
    )
  }) ?? []

  return h('div', { className: 'tpm-section' },
    h('div', { className: 'tpm-pageHeader' },
      h('h2', { className: 'tpm-pageTitle' }, '用量监控'),
      h('p', { className: 'tpm-pageDesc' }, '配置各供应商的用量查询参数。'),
    ),
    snap ? blocks : h('div', { className: 'tpm-empty' }, '加载中…'),
  )
}

export const inject = ['slots']

export function apply(ctx: any) {
  ensureWidgetCss()
  const slots = ctx.get('slots')
  if (!slots) return
  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'token-plan-monitor' },
    Widget,
  ))
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'token-plan-monitor-settings', order: 30, label: '用量监控' },
    SettingsSection,
  ))
}
