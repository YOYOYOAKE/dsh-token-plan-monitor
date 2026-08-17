/**
 * DeepSeek Platform — account balance (GET https://api.deepseek.com/user/balance).
 * Special config: platform API Key (sent as `Authorization: Bearer`).
 */
import { UsageError, type HttpTransport, type UsageProvider, type UsageLine } from '../types.ts'

const API = 'https://api.deepseek.com/user/balance'

export interface DeepSeekUsage {
  totalBalance: number
  currency: string
}

export function createDeepSeekProvider(): UsageProvider<DeepSeekUsage> {
  return {
    id: 'deepseek',
    name: 'DeepSeek Platform',
    description: 'DeepSeek 开放平台账户余额（user/balance），直接使用 DSH 已配置的 API Key 查询，无需额外配置。',
    configFields: [],
    credentialRefs: ['DEEPSEEK_API_KEY'],
    usageConfigFields: [],

    matchesModel(providerId: string): boolean {
      return providerId.toLowerCase().includes('deepseek')
    },

    async fetchUsage(config: Record<string, string>, http: HttpTransport): Promise<DeepSeekUsage> {
      const apiKey = config.__credential
      if (!apiKey) throw new UsageError('no api key', 'no_key', 'DSH 未配置 DeepSeek API Key')
      const res = await http({
        method: 'GET',
        url: API,
        headers: { Authorization: `Bearer ${apiKey}`, 'Accept-Encoding': 'identity' },
      })
      if (res.status !== 200) throw new UsageError(`HTTP ${res.status}`, `http_${res.status}`, httpHint(res.status))

      let body: { balance_infos?: Array<{ currency: string; total_balance: string }> }
      try {
        body = JSON.parse(res.text)
      } catch {
        throw new UsageError('bad json', 'bad_json', 'DeepSeek 返回了无法解析的数据')
      }
      const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
      const info = infos.find((b) => b.currency === 'CNY')
        ?? infos.find((b) => b.currency === 'USD')
        ?? infos[0]
      if (!info) throw new UsageError('no balance', 'no_data', 'DeepSeek 未返回余额数据')
      return { totalBalance: Number(info.total_balance), currency: info.currency }
    },

    renderLines(data: DeepSeekUsage): UsageLine[] {
      return [{ text: `余额 ${data.totalBalance.toFixed(2)} ${data.currency}`, tone: 'ok' }]
    },
  }
}

function httpHint(status: number): string {
  if (status === 401 || status === 403) return 'API Key 无效或已过期'
  if (status >= 500) return '服务端暂时不可用'
  return `HTTP ${status}`
}
