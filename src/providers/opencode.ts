/**
 * OpenCode Go — Token Plan subscription usage (rolling 5h / weekly / monthly)
 * via the Convex RPC endpoint (function ref f=31).
 * Special config: workspace id (`wrk_...`) and the browser `auth` cookie.
 */
import { UsageError, type HttpTransport, type UsageProvider, type UsageLine } from '../types.ts'

// Convex deployment ID for OpenCode's Go usage query (function ref f=31).
const SERVER = 'c7389bd0e731f80f49593e5ee53835475f4e28594dd6bd83eb229bab753498cd'
// 窗口配额进度条标签：5h / 7d / 30d（底层键不变，仅展示用）。
const PERIODS: Array<[key: string, label: string]> = [
  ['5h', '5h'],
  ['weekly', '7d'],
  ['monthly', '30d'],
]

export interface OpenCodePeriod {
  percent: number
  resetInSec: number
}

export interface OpenCodeUsage {
  periods: Record<string, OpenCodePeriod>
}

export function createOpenCodeGoProvider(): UsageProvider<OpenCodeUsage> {
  return {
    id: 'opencode-go',
    name: 'OpenCode Go',
    description: '需要工作区 ID 与浏览器 Cookie。',
    configFields: [
      { key: 'workspaceId', label: 'Workspace ID', type: 'text', required: true, placeholder: 'wrk_...（从 opencode.ai 地址栏复制）' },
      { key: 'cookie', label: 'Cookie（auth）', type: 'password', required: true, placeholder: 'F12 → Application → Cookies → opencode.ai → auth' },
    ],
    // 模型调用 key 无法查询用量：需要额外配置 workspaceId + cookie 才算就绪。
    credentialRefs: ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
    usageConfigFields: ['workspaceId', 'cookie'],

    matchesModel(providerId: string): boolean {
      return providerId.toLowerCase().includes('opencode')
    },

    async fetchUsage(config: Record<string, string>, http: HttpTransport): Promise<OpenCodeUsage> {
      const cookie = config.cookie
      const workspaceId = config.workspaceId
      if (!cookie) throw new UsageError('no cookie', 'no_cookie', '请在「用量监控」设置中填写 OpenCode Cookie')
      if (!workspaceId) throw new UsageError('no workspaceId', 'no_workspace', '请在「用量监控」设置中填写 OpenCode Workspace ID')

      // Convex RPC: args = { t: query metadata, f: 31 (Go usage), m: [] }.
      // The response is a JS-expression blob, not JSON — see parseOpenCode().
      const args = JSON.stringify({
        t: { t: 9, i: 0, l: 1, a: [{ t: 1, s: workspaceId }], o: 0 },
        f: 31,
        m: [],
      })
      const url = `https://opencode.ai/_server?id=${SERVER}&args=${encodeURIComponent(args)}`
      const res = await http({
        method: 'GET',
        url,
        headers: {
          cookie: `auth=${cookie}`,
          'x-server-id': SERVER,
          'x-server-instance': 'server-fn:3',
        },
      })
      if (res.status !== 200) throw new UsageError(`HTTP ${res.status}`, `http_${res.status}`, httpHint(res.status))
      if (res.text.includes('/auth/authorize')) {
        throw new UsageError('cookie expired', 'auth_expired', 'OpenCode Cookie 已过期，请在设置中更新')
      }
      return parseOpenCode(res.text)
    },

    renderLines(data: OpenCodeUsage): UsageLine[] {
      const lines: UsageLine[] = []
      for (const [key, label] of PERIODS) {
        const p = data.periods[key]
        if (p === undefined) continue
        const note = p.resetInSec > 0 ? formatTime(p.resetInSec) : undefined
        lines.push({
          text: `${Math.round(p.percent)}%`,
          tone: toneForPercent(p.percent),
          bar: { label, percent: p.percent, note },
        })
      }
      return lines
    },
  }
}

function toneForPercent(percent: number): UsageLine['tone'] {
  if (percent >= 100) return 'error'
  if (percent >= 90) return 'warn'
  return 'ok'
}

function httpHint(status: number): string {
  if (status === 401 || status === 403) return '凭据无效或已过期'
  if (status >= 500) return '服务端暂时不可用'
  return `HTTP ${status}`
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  // 短格式：2h11m / 4d3h / 45m / 30s
  if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return `${s}s`
}

/**
 * Parse the Convex JS-expression response into OpenCodeUsage.
 * Wire format: `;0x...;((self.$R=...),($R=>$R[0]={...})($R[...]))` — extract
 * the object assigned to `$R[0]`, convert its JS-literal syntax to JSON,
 * then pick out rollingUsage / weeklyUsage / monthlyUsage.
 */
function parseOpenCode(raw: string): OpenCodeUsage {
  if (raw.includes('$R[0]=null')) {
    throw new UsageError('no subscription', 'no_subscription', '当前工作区没有 Go 订阅')
  }
  const idx = raw.indexOf('$R[0]=')
  if (idx === -1) throw new UsageError('parse', 'parse_error', 'OpenCode 响应无法解析')
  const start = raw.indexOf('{', idx)
  if (start === -1) throw new UsageError('parse', 'parse_error', 'OpenCode 响应无法解析')

  let depth = 0
  let end = start
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++
    else if (raw[i] === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }

  let obj: Record<string, unknown>
  try {
    obj = parseJsBlob(raw.slice(start, end))
  } catch {
    throw new UsageError('parse', 'parse_error', 'OpenCode 响应无法解析')
  }
  const inner = (obj.value as Record<string, unknown> | undefined) ?? obj
  const periods: OpenCodeUsage['periods'] = {}
  const map: Record<string, string> = {
    rollingUsage: '5h',
    hourly: '5h',
    weeklyUsage: 'weekly',
    monthlyUsage: 'monthly',
  }
  for (const [src, period] of Object.entries(map)) {
    const entry = inner[src] as Record<string, unknown> | undefined
    if (entry === undefined) continue
    const value = entry.usagePercent ?? entry.cost ?? entry.amount ?? entry.usage
    if (value != null) {
      periods[period] = {
        percent: Number(value),
        resetInSec: Number(entry.resetInSec ?? 0),
      }
    }
  }
  if (Object.keys(periods).length === 0) {
    throw new UsageError('no usage data', 'no_data', 'OpenCode 未返回用量数据')
  }
  return { periods }
}

/**
 * Convert a JS-literal object string to JSON.
 * Handles: `!0` / `!1` → true/false, unquoted keys → quoted,
 * `$R[N] = …` → stripped, `$R[N]` → null.
 */
function parseJsBlob(s: string): Record<string, unknown> {
  s = s.trim()
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1)
  s = s.replace(/\$R\[\d+\]=/g, '')
  s = s.replace(/\$R\[\d+\]/g, 'null')
  s = s.replace(/!0(?=[,}\s])/g, 'true')
  s = s.replace(/!1(?=[,}\s])/g, 'false')
  s = s.replace(/([{,]\s*)([a-zA-Z_$]\w*)(\s*:)/g, '$1"$2"$3')
  return JSON.parse(s)
}
