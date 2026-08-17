/**
 * dsh-token-plan-monitor — shared provider contract.
 *
 * Every provider is one object implementing {@link UsageProvider}; the host
 * half derives transport, caching, auto-detection, RPC endpoints and the
 * client UI from this registry.
 */

/** One rendered line in the card / settings status. */
export interface UsageLine {
  text: string
  /** Card coloring: ok → secondary text, warn → amber, error → red, muted → faint. */
  tone: 'ok' | 'warn' | 'error' | 'muted'
  /**
   * Present → render as a progress bar (window-quota providers like
   * OpenCode Go): `label` (e.g. 5h / 7d / 30d), `percent` = USED
   * share (0–100), optional `note` (e.g. reset countdown).
   */
  bar?: {
    label: string
    percent: number
    note?: string
  }
}

/** One per-provider special config field rendered in the settings form. */
export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'password'
  required: boolean
  placeholder?: string
}

/** A network request issued by a provider (backed by global fetch on the host). */
export interface HttpRequest {
  method?: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface HttpResponse {
  status: number
  text: string
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>

/**
 * Typed usage-fetch failure. `code` is a machine-routable short string;
 * `hint` is a user-facing Chinese message shown on the card and settings page.
 */
export class UsageError extends Error {
  override readonly name = 'UsageError'
  readonly code: string
  readonly hint: string

  constructor(message: string, code: string, hint = '') {
    super(message)
    this.code = code
    this.hint = hint
  }
}

/**
 * The provider contract. One instance per provider (see src/providers/).
 * Adding a provider = implementing this interface and registering it in
 * `PROVIDERS` inside src/index.ts.
 *
 * Two orthogonal facts drive what is shown:
 *  - "credentialed": DSH has an API key for this provider (detected from the
 *    credentials service / LLM config, see `credentialRefs`) — only
 *    credentialed providers are shown on the card and in the settings page.
 *  - "usage-configured": the provider's usage query can actually run —
 *    `usageConfigFields` are all filled in (empty list = the API key alone is
 *    enough, e.g. DeepSeek's balance endpoint).
 */
export interface UsageProvider<T = unknown> {
  /** Stable registry key (also the settings `providers` key). */
  id: string
  /** Display name shown on the card and in settings. */
  name: string
  /** One-line description shown in the settings form. */
  description: string
  /**
   * Candidate credential reference names (env var / credentials namespace
   * keys) the host probes to decide whether DSH has an API key for this
   * provider. The host also reads the LLM config's own `apiKeyEnv` field for
   * the matching route first; `credentialRefs` is the fallback for routes
   * without a stored LLM profile (e.g. a key added directly to credentials).
   */
  credentialRefs: string[]
  /**
   * Special-config keys that must all be filled before the usage query can
   * run. Empty array means the API key alone is sufficient. When not
   * usage-configured the card shows a "configure the usage query" hint
   * instead of querying.
   */
  usageConfigFields: string[]
  /** Per-provider special config fields (Cookie / Workspace ID / …). */
  configFields: ConfigField[]
  /**
   * Whether this provider corresponds to a DSH-configured provider id
   * (from `agent-default-model.provider`, `llm.listProviders()` or
   * `llm.listConfigurableProviders()`).
   */
  matchesModel(providerId: string): boolean
  /**
   * Query the provider's usage. `config` holds the saved special-config
   * values; when the provider's API key is used directly for the query (no
   * `usageConfigFields`), the host injects the resolved key as
   * `config.__credential`. Throw {@link UsageError} on any failure.
   */
  fetchUsage(config: Record<string, string>, http: HttpTransport): Promise<T>
  /** Render the fetched data as card lines. */
  renderLines(data: T): UsageLine[]
}

/** One provider's fetch failure, as sent to the client. */
export interface ProviderErrorView {
  code: string
  message: string
  hint: string
}

/** Provider catalog row for the widget / settings form. */
export interface ProviderView {
  id: string
  name: string
  description: string
  configFields: ConfigField[]
  /** Saved special config with secrets masked (`********`). */
  config: Record<string, string>
  /** True when DSH has an API key for this provider (the show/hide gate). */
  credentialed: boolean
  /** True when the usage query can actually run (usageConfigFields filled). */
  usageConfigured: boolean
  /** True when this provider matches the current default model provider. */
  current: boolean
}

/** One provider's usage entry state. */
export interface EntryView {
  configured: boolean
  state: 'idle' | 'ok' | 'error'
  lines: UsageLine[]
  error: ProviderErrorView | null
  fetchedAt: number
}

/** Full snapshot served by GET /api/token-plan-monitor. */
export interface Snapshot {
  currentProvider: string | undefined
  providers: ProviderView[]
  entries: Record<string, EntryView>
}
