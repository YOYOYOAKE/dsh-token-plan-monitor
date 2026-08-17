/**
 * dsh-token-plan-monitor — host half.
 *
 * Multi-provider balance / token-plan usage monitor for DeepSeek Harness.
 * The host half handles settings, credential detection, caching, HTTP queries
 * and API endpoints; each provider is one entry in PROVIDERS (src/types.ts).
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {
  EntryView,
  ProviderView,
  Snapshot,
  UsageProvider,
} from './types.ts'
import { UsageError } from './types.ts'
import { createDeepSeekProvider } from './providers/deepseek.ts'
import { createOpenCodeGoProvider } from './providers/opencode.ts'

export const name = 'token-plan-monitor'
export const inject = ['webServer']

const CACHE_MS = 60_000
const MASK = '********'
const REQUEST_TIMEOUT_MS = 20_000

// Harness deps are resolved from the DSH profile, not from this file's location.
let schemaModule: any = null
let settingsModule: any = null

function harnessRequire() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return createRequire(join(home, 'profiles', 'web', '__token_plan_monitor_noop__.cjs'))
}

function ensureHarnessDeps() {
  if (schemaModule && settingsModule) return
  const req = harnessRequire()
  const schemaPkg = req('@deepseek-ai/schemastery')
  schemaModule = schemaPkg && schemaPkg.object ? schemaPkg : (schemaPkg.default ?? schemaPkg)
  const settingsPkg = req('@deepseek-ai/dsh-settings')
  settingsModule = settingsPkg && typeof settingsPkg.installSettingsSection === 'function'
    ? settingsPkg
    : (settingsPkg.default ?? settingsPkg)
}

const http: (request: {
  method?: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}) => Promise<{ status: number; text: string }> = async (request) => {
  let res: Response
  try {
    res = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error), 'fetch_error', '网络请求失败')
  }
  const text = await res.text()
  return { status: res.status, text }
}

function httpHint(status: number): string {
  if (status === 401 || status === 403) return '凭据无效或已过期'
  if (status >= 500) return '服务端暂时不可用'
  return `HTTP ${status}`
}

// Append one entry per provider (see src/types.ts).
const PROVIDERS: UsageProvider[] = [
  createDeepSeekProvider(),
  createOpenCodeGoProvider(),
]

interface ProviderConfig {
  apiKey?: string
  cookie?: string
  workspaceId?: string
}

interface PluginConfig {
  providers: Record<string, ProviderConfig>
}

function maskConfig(provider: UsageProvider, config: ProviderConfig | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!config) return out
  for (const field of provider.configFields) {
    const value = config[field.key as keyof ProviderConfig]
    if (value === undefined || value === null) continue
    out[field.key] = field.type === 'password' ? MASK : String(value)
  }
  return out
}

// Show providers only when DSH has a credential or the user configured them.
interface LlmLike {
  listProviders(): Array<{ id: string; name?: string }>
  listConfigurableProviders(): Array<{
    provider: string
    displayName?: string
    settingsNs: string
    settingsPath: readonly string[]
  }>
}

interface SettingsLike {
  get(ns: string): unknown
  mutate(ns: string, ops: readonly unknown[]): Promise<void>
}

interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): unknown
}

export function apply(ctx: Context, entryConfig: unknown) {
  ensureHarnessDeps()
  const Schema = schemaModule
  const { installSettingsSection, settingsNamespace } = settingsModule

  const ProviderConfigSchema = Schema.object({
    apiKey: Schema.string(),
    cookie: Schema.string(),
    workspaceId: Schema.string(),
  })
  const ConfigSchema = Schema.object({
    providers: Schema.dict(ProviderConfigSchema).default({}),
  })
  const NS = settingsNamespace('token-plan-monitor')

  let current = () => (entryConfig ?? {}) as PluginConfig
  let cfg = (entryConfig ?? {}) as PluginConfig
  const refreshConfig = () => {
    const next = { ...current() }
    next.providers = next.providers ?? {}
    cfg = next
  }
  installSettingsSection(ctx, NS, ConfigSchema, entryConfig ?? {}, {
    setSource: (fn: () => PluginConfig) => { current = fn },
    onChange: refreshConfig,
  })
  refreshConfig()

  // Credentialed providers are visible; usage queries run only when all
  // required special-config fields are filled.
  const routeProfile = (
    settings: SettingsLike | undefined,
    ns: string,
    path: readonly string[],
  ): Record<string, unknown> | undefined => {
    try {
      const section = settings?.get(ns)
      let node: unknown = section
      for (const key of path) {
        if (!node || typeof node !== 'object') return undefined
        node = (node as Record<string, unknown>)[key]
      }
      return node && typeof node === 'object' ? (node as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }

  const configurableRoutes = (): Array<{ provider: string; settingsNs: string; settingsPath: readonly string[] }> => {
    try {
      const llm = ctx.get('llm') as LlmLike | undefined
      return (llm?.listConfigurableProviders() ?? [])
        .filter((p) => p?.provider)
        .map((p) => ({ provider: p.provider, settingsNs: p.settingsNs, settingsPath: p.settingsPath ?? [] }))
    } catch {
      return []
    }
  }

  const tryCredentialRef = async (ref: string): Promise<string | undefined> => {
    if (!ref) return undefined
    const credentials = ctx.get('credentials') as
      | { resolve(ref: string): Promise<{ value?: string } | undefined> }
      | undefined
    try {
      const hit = credentials ? await credentials.resolve(ref) : undefined
      if (hit?.value) return hit.value
    } catch {}
    return process.env[ref] || undefined
  }

  const resolveCredential = async (provider: UsageProvider): Promise<string | undefined> => {
    const settings = ctx.get('settings') as SettingsLike | undefined
    for (const route of configurableRoutes()) {
      if (!provider.matchesModel(route.provider)) continue
      const profile = routeProfile(settings, route.settingsNs, route.settingsPath)
      const ref = profile?.apiKeyEnv as string | undefined
      if (ref) {
        const value = await tryCredentialRef(ref)
        if (value) return value
      }
    }
    for (const ref of provider.credentialRefs ?? []) {
      const value = await tryCredentialRef(ref)
      if (value) return value
    }
    return undefined
  }

  const credentialed = new Map<string, boolean>()
  const credentialValues = new Map<string, string | undefined>()

  const invalidateCredentials = () => {
    credentialed.clear()
    credentialValues.clear()
  }

  const ensureCredential = async (provider: UsageProvider): Promise<boolean> => {
    if (credentialed.has(provider.id)) return credentialed.get(provider.id)!
    const value = await resolveCredential(provider)
    credentialValues.set(provider.id, value)
    const ok = value !== undefined
    credentialed.set(provider.id, ok)
    return ok
  }

  const onAny = (ctx as unknown as { on(event: string, listener: () => void): () => void }).on
  onAny('credentials/updated', invalidateCredentials)
  onAny('settings/updated', invalidateCredentials)

  const manuallyConfigured = (provider: UsageProvider): boolean => {
    const config = cfg.providers[provider.id]
    return !!config && Object.keys(config).length > 0
  }

  const usageConfiguredOf = (provider: UsageProvider): boolean => {
    const fields = provider.usageConfigFields ?? []
    if (fields.length === 0) return true
    const config = cfg.providers[provider.id]
    if (!config) return false
    return fields.every((key) => !!config[key as keyof ProviderConfig])
  }

  /** Show gate: credentialed, or the user manually configured it. */
  const isVisible = async (provider: UsageProvider): Promise<boolean> => {
    if (manuallyConfigured(provider)) return true
    return ensureCredential(provider)
  }

  const currentProviderId = (): string | undefined => {
    try {
      const settings = ctx.get('settings') as SettingsLike | undefined
      const def = settings?.get('agent-default-model') as { provider?: string } | undefined
      return def?.provider
    } catch {
      return undefined
    }
  }

  const cache = new Map<string, { at: number; snapshot: EntryView }>()
  const inflight = new Map<string, Promise<void>>()

  const toErrorView = (error: unknown) => {
    if (error instanceof UsageError) {
      return { code: error.code, message: error.message, hint: error.hint }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { code: 'internal', message, hint: '内部错误' }
  }

  const refreshOne = async (provider: UsageProvider, force: boolean): Promise<EntryView> => {
    const usageConfigured = usageConfiguredOf(provider)
    const idle: EntryView = { configured: usageConfigured, state: 'idle', lines: [], error: null, fetchedAt: 0 }
    if (!usageConfigured) return idle

    const cached = cache.get(provider.id)
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.snapshot

    const pending = inflight.get(provider.id)
    if (pending) {
      await pending
      return cache.get(provider.id)?.snapshot ?? idle
    }

    const task = (async () => {
      const fetchConfig: Record<string, string> = { ...(cfg.providers[provider.id] ?? {}) }
      if (!fetchConfig.apiKey) {
        const cred = credentialValues.get(provider.id)
        if (cred) fetchConfig.__credential = cred
      }
      try {
        const data = await provider.fetchUsage(fetchConfig, http)
        const snapshot: EntryView = {
          configured: true,
          state: 'ok',
          lines: provider.renderLines(data),
          error: null,
          fetchedAt: Date.now(),
        }
        cache.set(provider.id, { at: Date.now(), snapshot })
      } catch (error) {
        const snapshot: EntryView = {
          configured: true,
          state: 'error',
          lines: [],
          error: toErrorView(error),
          fetchedAt: 0,
        }
        cache.set(provider.id, { at: Date.now(), snapshot })
      }
    })()
    inflight.set(provider.id, task)
    try {
      await task
    } finally {
      inflight.delete(provider.id)
    }
    return cache.get(provider.id)?.snapshot ?? idle
  }

  const buildSnapshot = async (force = false): Promise<Snapshot> => {
    const current = currentProviderId()
    const visible: UsageProvider[] = []
    for (const p of PROVIDERS) {
      if (await isVisible(p)) visible.push(p)
    }
    await Promise.all(visible.map((p) => refreshOne(p, force)))
    return {
      currentProvider: current,
      providers: visible.map((p): ProviderView => {
        const config = cfg.providers[p.id]
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          configFields: p.configFields,
          config: maskConfig(p, config),
          credentialed: credentialValues.get(p.id) !== undefined || manuallyConfigured(p),
          usageConfigured: usageConfiguredOf(p),
          current: current !== undefined && p.matchesModel(current),
        }
      }),
      entries: Object.fromEntries(
        visible.map((p) => [p.id, cache.get(p.id)?.snapshot
          ?? { configured: usageConfiguredOf(p), state: 'idle', lines: [], error: null, fetchedAt: 0 } as EntryView]),
      ),
    }
  }

  const webServer = ctx.get('webServer') as WebServerLike | undefined
  if (!webServer) return

  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  const readBody = async (req: IncomingMessage): Promise<string> => {
    let body = ''
    for await (const chunk of req) body += chunk
    return body
  }

  webServer.register({
    kind: 'exact',
    path: '/api/token-plan-monitor',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        json(res, 405, { error: 'method-not-allowed' })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const providerId = url.searchParams.get('provider') ?? undefined
        const force = url.searchParams.get('force') === '1'
        if (providerId) {
          const provider = PROVIDERS.find((p) => p.id === providerId)
          if (provider && await isVisible(provider)) await refreshOne(provider, force)
        } else {
          await buildSnapshot(force)
        }
        json(res, 200, await buildSnapshot(false))
      } catch (error) {
        console.error('[token-plan-monitor] snapshot error:', error)
        json(res, 500, { error: String((error as Error)?.message ?? error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/token-plan-monitor/settings',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          json(res, 200, await buildSnapshot(false))
          return
        }
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, message: 'method-not-allowed' })
          return
        }
        const settings = ctx.get('settings') as SettingsLike | undefined
        if (!settings || typeof settings.mutate !== 'function') {
          json(res, 500, { ok: false, message: 'settings service unavailable' })
          return
        }
        const parsed = JSON.parse((await readBody(req)) || '{}') as {
          action?: string
          provider?: string
          config?: Record<string, string>
        }
        const provider = PROVIDERS.find((p) => p.id === parsed.provider)
        if (!provider) {
          json(res, 400, { ok: false, message: `unknown provider: ${parsed.provider}` })
          return
        }
        if (parsed.action === 'save') {
          if (provider.configFields.length === 0) {
            json(res, 400, { ok: false, message: `${provider.id} 无需额外配置` })
            return
          }
          const incoming = parsed.config ?? {}
          const prev = cfg.providers[provider.id] ?? {}
          const next: Record<string, string> = {}
          for (const field of provider.configFields) {
            const value = String(incoming[field.key] ?? '')
            if (field.type === 'password') {
              if (value === MASK || value === '') {
                const old = prev[field.key as keyof ProviderConfig]
                if (old) next[field.key] = old
              } else {
                next[field.key] = value
              }
            } else if (value) {
              next[field.key] = value
            }
          }
          await settings.mutate(NS, [{ op: 'set', path: ['providers', provider.id], value: next }])
          refreshConfig()
          const fresh = await refreshOne(provider, true)
          json(res, 200, { ok: true, entry: fresh, snapshot: await buildSnapshot(false) })
          return
        }
        if (parsed.action === 'clear') {
          await settings.mutate(NS, [{ op: 'unset', path: ['providers', provider.id] }])
          refreshConfig()
          cache.delete(provider.id)
          json(res, 200, { ok: true, snapshot: await buildSnapshot(false) })
          return
        }
        json(res, 400, { ok: false, message: `unknown action: ${parsed.action}` })
      } catch (error) {
        console.error('[token-plan-monitor] settings error:', error)
        json(res, 500, { ok: false, message: String((error as Error)?.message ?? error) })
      }
    },
  })
}
