/**
 * dsh-billing host half: real-time model-usage metering and account balance.
 * Hooks `llm/stream` to record every model call (cache hit/miss + output),
 * prices per provider x model (DeepSeek peak/off-peak), serves /api/dsh-billing
 * routes for the browser half, registers the billing_balance tool, and persists
 * the ledger to the workspace file .dsh-billing-ledger.json.
 */
import { existsSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'billing'
export const inject = ['webServer', 'tools', 'systemPrompt']

const FLAT_PRICES = {
  'deepseek-v4-flash': { cacheHitInput: 0.02, cacheMissInput: 1, output: 2 },
  'deepseek-v4-pro': { cacheHitInput: 0.025, cacheMissInput: 3, output: 6 },
}
const PEAK_START = Date.UTC(2026, 7, 16, 16, 0, 0)
const OFFICIAL_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
const DEFAULT_PRICES = {
  deepseek: {
    __default: { cacheHitInput: 0.3, cacheMissInput: 9, output: 27 },
    'deepseek-v4-flash': { cacheHitInput: 0.1, cacheMissInput: 3, output: 9 },
    'deepseek-v4-pro': { cacheHitInput: 0.3, cacheMissInput: 9, output: 27 },
  },
  '*': {
    'deepseek-chat': { cacheHitInput: 0.5, cacheMissInput: 2, output: 8 },
    'deepseek-reasoner': { cacheHitInput: 1, cacheMissInput: 4, output: 16 },
    'gpt-4o': { cacheHitInput: 18, cacheMissInput: 18, output: 72 },
    'gpt-4o-mini': { cacheHitInput: 1.1, cacheMissInput: 1.1, output: 4.4 },
    'claude-3-5-sonnet': { cacheHitInput: 22, cacheMissInput: 22, output: 110 },
  },
}

function pickNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function deepPrices() {
  const out = {}
  for (const prov of Object.keys(DEFAULT_PRICES)) {
    out[prov] = {}
    for (const k of Object.keys(DEFAULT_PRICES[prov])) out[prov][k] = { ...DEFAULT_PRICES[prov][k] }
  }
  return out
}

function inferProvider(model) {
  const m = String(model || '').toLowerCase()
  if (m.indexOf('deepseek') >= 0) return 'deepseek'
  if (m.indexOf('gpt') >= 0 || /^o[0-9]/.test(m)) return 'openai'
  if (m.indexOf('claude') >= 0) return 'anthropic'
  return '*'
}

function beijingHour(ts) {
  const d = new Date(ts + 8 * 3600 * 1000)
  return d.getUTCHours() + d.getUTCMinutes() / 60
}
function isPeakTime(ts) {
  const h = beijingHour(ts)
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

function readUsage(chunk) {
  if (!chunk || typeof chunk !== 'object') return null
  const u = chunk.usage || chunk.usageData || null
  if (!u || typeof u !== 'object') return null
  const cacheHit = pickNumber(
    u.cacheReadTokens !== undefined ? u.cacheReadTokens
      : u.prompt_cache_hit_tokens !== undefined ? u.prompt_cache_hit_tokens
        : (u.prompt_tokens_details ? u.prompt_tokens_details.cached_tokens : undefined),
  )
  let cacheMiss = pickNumber(
    u.inputTokens !== undefined ? u.inputTokens
      : u.prompt_cache_miss_tokens !== undefined ? u.prompt_cache_miss_tokens : undefined,
  )
  const output = pickNumber(
    u.outputTokens !== undefined ? u.outputTokens
      : u.completion_tokens !== undefined ? u.completion_tokens : undefined,
  )
  if (cacheMiss === 0 && cacheHit === 0) {
    const total = pickNumber(u.input_tokens !== undefined ? u.input_tokens : u.prompt_tokens)
    if (total > 0) cacheMiss = Math.max(0, total - cacheHit)
  }
  if (cacheHit === 0 && cacheMiss === 0 && output === 0) return null
  return { cacheHit, cacheMiss, output }
}

function deltaText(chunk) {
  if (!chunk || typeof chunk !== 'object') return ''
  const d = chunk.delta
  if (d && typeof d === 'object') {
    if (typeof d.content === 'string') return d.content
    if (typeof d.text === 'string') return d.text
  }
  if (typeof chunk.content === 'string') return chunk.content
  if (typeof chunk.text === 'string') return chunk.text
  return ''
}

function estimateInputTokens(options) {
  let chars = 0
  const messages = options && options.messages
  if (!Array.isArray(messages)) return 0
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const content = message.content
    if (typeof content === 'string') { chars += content.length; continue }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && typeof block.text === 'string') chars += block.text.length
      }
    }
  }
  return Math.ceil(chars / 4)
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&yen;|&#165;/gi, '¥')
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*元/g, '¥$1')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
}

function parseOfficialPrices(content) {
  const text = stripHtml(content).toLowerCase()
  const modelTokens = Array.from(new Set((text.match(/deepseek[a-z0-9._-]*/g) || [])))
  const result = {}
  for (const model of modelTokens) {
    if (model === 'deepseek') continue
    let best = null
    let pos = 0
    while (true) {
      const idx = text.indexOf(model, pos)
      if (idx < 0) break
      const windowText = text.slice(idx, idx + 1200)
      const peakIdx = windowText.indexOf('高峰')
      if (peakIdx < 0) { pos = idx + model.length; continue }
      const after = windowText.slice(peakIdx)
      const nums = (after.match(/¥\s*([0-9]+(?:\.[0-9]+)?)/g) || []).map((s) => parseFloat(s.replace(/[^0-9.]/g, '')))
      if (nums.length >= 3) { best = nums.slice(0, 3); break }
      pos = idx + model.length
    }
    if (best) result[model] = { cacheHitInput: best[0], cacheMissInput: best[1], output: best[2] }
  }
  return result
}

function apply(ctx, config) {
  const state = {
    config: {
      initialBalance: 100,
      lowBalanceThreshold: 20,
      defaultPrice: { cacheHitInput: 2, cacheMissInput: 2, output: 8 },
      prices: deepPrices(),
    },
    usage: { cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0, calls: 0, cost: 0, perModel: {} },
    ledger: [],
    startedAt: Date.now(),
    official: { syncedAt: 0, ok: false, message: '尚未同步', models: {} },
  }

  const fs = ctx.get('fs')
  const sp = ctx.get('sandboxPolicy')
  const spRoot = (sp && typeof sp.workspaceRoot === 'string') ? sp.workspaceRoot : ''
  const cwdRoot = process.cwd()
  const ledgerFile = (() => {
    const candidates = [cwdRoot, spRoot].filter((r) => typeof r === 'string' && r.length > 0)
    for (const r of candidates) {
      const p = r.replace(/[\\/]+$/, '') + '/.dsh-billing-ledger.json'
      try { if (existsSync(p)) return p } catch { /* noop */ }
    }
    const base = candidates[0] || '.'
    return base.replace(/[\\/]+$/, '') + '/.dsh-billing-ledger.json'
  })()
  const persist = { path: ledgerFile, savedAt: 0, loaded: false, error: '' }
  let ready = false
  let saveChain = Promise.resolve()

  function bucketFor(provider) {
    const prov = provider || ''
    if (state.config.prices[prov]) return state.config.prices[prov]
    for (const key of Object.keys(state.config.prices)) {
      if (key === '*') continue
      if (key && (prov.indexOf(key) >= 0 || key.indexOf(prov) >= 0)) return state.config.prices[key]
    }
    return {}
  }
  function resolvePrice(provider, model) {
    const bucket = bucketFor(provider)
    const star = state.config.prices['*'] || {}
    const p = bucket[model] || star[model] || bucket.__default || star.__default || state.config.defaultPrice
    return { cacheHitInput: pickNumber(p.cacheHitInput), cacheMissInput: pickNumber(p.cacheMissInput), output: pickNumber(p.output) }
  }
  function priceOf(provider, model, ts) {
    const deepV4 = /deepseek/i.test(provider || '') && /^deepseek-v4-/i.test(model)
    if (deepV4 && ts < PEAK_START) {
      const f = FLAT_PRICES[model] || state.config.defaultPrice
      return { cacheHitInput: pickNumber(f.cacheHitInput), cacheMissInput: pickNumber(f.cacheMissInput), output: pickNumber(f.output), rate: null }
    }
    const p = resolvePrice(provider, model)
    if (deepV4) {
      const peak = isPeakTime(ts)
      const mul = peak ? 1 : 0.5
      return { cacheHitInput: p.cacheHitInput * mul, cacheMissInput: p.cacheMissInput * mul, output: p.output * mul, rate: peak ? 'peak' : 'offpeak' }
    }
    return { cacheHitInput: p.cacheHitInput, cacheMissInput: p.cacheMissInput, output: p.output, rate: null }
  }
  function costOfCall(provider, model, cacheHit, cacheMiss, output, ts) {
    const p = priceOf(provider, model, ts)
    return (cacheHit / 1e6) * p.cacheHitInput + (cacheMiss / 1e6) * p.cacheMissInput + (output / 1e6) * p.output
  }
  function totalCost() { return state.usage.cost }
  function balanceOf() { return state.config.initialBalance - totalCost() }
  function statusOf() {
    const b = balanceOf()
    if (b <= 0) return 'exhausted'
    if (b <= state.config.lowBalanceThreshold) return 'low'
    return 'ok'
  }

  function snapshot() {
    const perModel = Object.keys(state.usage.perModel).map((key) => {
      const m = state.usage.perModel[key]
      const idx = key.indexOf('/')
      const provider = idx >= 0 ? key.slice(0, idx) : ''
      const model = idx >= 0 ? key.slice(idx + 1) : key
      return { provider, model, cacheHitTokens: m.cacheHitTokens, cacheMissTokens: m.cacheMissTokens, outputTokens: m.outputTokens, calls: m.calls, cost: m.cost }
    }).sort((a, b) => b.cost - a.cost)
    const ledger = state.ledger.slice(-20).reverse().map((entry) => ({
      ts: entry.ts,
      provider: entry.provider || '',
      model: entry.model || '',
      cacheHit: entry.cacheHit,
      cacheMiss: entry.cacheMiss,
      output: entry.output,
      cost: entry.cost,
      estimated: !!entry.estimated,
      rate: entry.rate === undefined ? null : entry.rate,
    }))
    const prices = {}
    for (const prov of Object.keys(state.config.prices)) {
      prices[prov] = {}
      for (const k of Object.keys(state.config.prices[prov])) prices[prov][k] = { ...state.config.prices[prov][k] }
    }
    return {
      balance: balanceOf(),
      status: statusOf(),
      cost: totalCost(),
      calls: state.usage.calls,
      inputTokens: state.usage.cacheHitTokens + state.usage.cacheMissTokens,
      cacheHitTokens: state.usage.cacheHitTokens,
      cacheMissTokens: state.usage.cacheMissTokens,
      outputTokens: state.usage.outputTokens,
      startedAt: state.startedAt,
      config: {
        initialBalance: state.config.initialBalance,
        lowBalanceThreshold: state.config.lowBalanceThreshold,
        defaultPrice: { ...state.config.defaultPrice },
        prices,
      },
      official: {
        syncedAt: state.official.syncedAt,
        ok: state.official.ok,
        message: state.official.message,
        models: { ...state.official.models },
      },
      persist: {
        path: persist.path,
        loaded: persist.loaded,
        savedAt: persist.savedAt,
        error: persist.error,
      },
      perModel,
      ledger,
    }
  }

  function record(provider, model, cacheHit, cacheMiss, output, estimated, ts) {
    const cost = costOfCall(provider, model, cacheHit, cacheMiss, output, ts)
    const p = priceOf(provider, model, ts)
    const key = provider ? (provider + '/' + model) : model
    let m = state.usage.perModel[key]
    if (!m) { m = { cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0, calls: 0, cost: 0 }; state.usage.perModel[key] = m }
    m.cacheHitTokens += cacheHit
    m.cacheMissTokens += cacheMiss
    m.outputTokens += output
    m.calls += 1
    m.cost += cost
    state.usage.cacheHitTokens += cacheHit
    state.usage.cacheMissTokens += cacheMiss
    state.usage.outputTokens += output
    state.usage.calls += 1
    state.usage.cost += cost
    state.ledger.push({ ts, provider, model, cacheHit, cacheMiss, output, cost, estimated, rate: p.rate })
    if (state.ledger.length > 200) state.ledger = state.ledger.slice(-200)
    schedulePersist()
  }

  function applyOfficialPrices(models) {
    let applied = 0
    if (!state.config.prices.deepseek) state.config.prices.deepseek = {}
    for (const model of Object.keys(models)) {
      const p = models[model]
      if (p && p.cacheHitInput >= 0 && p.cacheMissInput >= 0 && p.output >= 0) {
        state.config.prices.deepseek[model] = { cacheHitInput: p.cacheHitInput, cacheMissInput: p.cacheMissInput, output: p.output }
        applied++
      }
    }
    if (applied > 0) schedulePersist()
    return applied
  }

  async function loadPersisted() {
    try {
      if (!fs || !ledgerFile) { persist.error = '无 fs 服务或工作区根目录，持久化不可用'; return }
      const target = await fs.resolve(ledgerFile)
      const st = await fs.stat(target)
      if (!st) return
      const text = await fs.readText(target)
      const data = JSON.parse(text)
      if (!data || (data.v !== 1 && data.v !== 2)) { persist.error = '账本版本不匹配，保留默认值'; return }
      if (data.config) {
        if (data.config.initialBalance !== undefined) state.config.initialBalance = Math.max(0, pickNumber(data.config.initialBalance))
        if (data.config.lowBalanceThreshold !== undefined) state.config.lowBalanceThreshold = Math.max(0, pickNumber(data.config.lowBalanceThreshold))
        if (data.config.defaultPrice && typeof data.config.defaultPrice === 'object') {
          state.config.defaultPrice = { cacheHitInput: pickNumber(data.config.defaultPrice.cacheHitInput), cacheMissInput: pickNumber(data.config.defaultPrice.cacheMissInput), output: pickNumber(data.config.defaultPrice.output) }
        }
        let rawPrices = data.config.prices
        if (data.v === 1 && rawPrices && typeof rawPrices === 'object' && !Array.isArray(rawPrices)) {
          const prices = {}
          for (const k of Object.keys(rawPrices)) {
            const v = rawPrices[k]
            if (v && typeof v === 'object') {
              const prov = inferProvider(k)
              if (!prices[prov]) prices[prov] = {}
              prices[prov][k] = { cacheHitInput: pickNumber(v.cacheHitInput), cacheMissInput: pickNumber(v.cacheMissInput), output: pickNumber(v.output) }
            }
          }
          if (!prices.deepseek) prices.deepseek = {}
          if (!prices.deepseek.__default && prices.deepseek['deepseek-v4-pro']) prices.deepseek.__default = { ...prices.deepseek['deepseek-v4-pro'] }
          rawPrices = prices
        }
        if (rawPrices && typeof rawPrices === 'object' && !Array.isArray(rawPrices)) {
          const prices = deepPrices()
          for (const prov of Object.keys(rawPrices)) {
            const bucket = rawPrices[prov]
            if (bucket && typeof bucket === 'object') {
              if (!prices[prov]) prices[prov] = {}
              for (const k of Object.keys(bucket)) {
                const v = bucket[k]
                if (v && typeof v === 'object') prices[prov][k] = { cacheHitInput: pickNumber(v.cacheHitInput), cacheMissInput: pickNumber(v.cacheMissInput), output: pickNumber(v.output) }
              }
            }
          }
          state.config.prices = prices
        }
      }
      if (data.usage && typeof data.usage === 'object') {
        state.usage.cacheHitTokens = pickNumber(data.usage.cacheHitTokens)
        state.usage.cacheMissTokens = pickNumber(data.usage.cacheMissTokens)
        state.usage.outputTokens = pickNumber(data.usage.outputTokens)
        state.usage.calls = pickNumber(data.usage.calls)
        state.usage.cost = pickNumber(data.usage.cost)
        state.usage.perModel = {}
        if (data.usage.perModel && typeof data.usage.perModel === 'object') {
          for (const k of Object.keys(data.usage.perModel)) {
            const v = data.usage.perModel[k]
            if (v && typeof v === 'object') state.usage.perModel[k] = { cacheHitTokens: pickNumber(v.cacheHitTokens), cacheMissTokens: pickNumber(v.cacheMissTokens), outputTokens: pickNumber(v.outputTokens), calls: pickNumber(v.calls), cost: pickNumber(v.cost) }
          }
        }
      }
      if (Array.isArray(data.ledger)) state.ledger = data.ledger.filter((e) => e && typeof e === 'object').slice(-200)
      if (data.startedAt) state.startedAt = pickNumber(data.startedAt)
      persist.loaded = true
      persist.savedAt = pickNumber(data.savedAt)
      persist.error = ''
    } catch (err) {
      persist.error = err && err.message ? err.message : String(err)
    } finally {
      ready = true
    }
  }

  async function savePersisted() {
    if (!fs || !ledgerFile) return
    const prices = {}
    for (const prov of Object.keys(state.config.prices)) {
      prices[prov] = {}
      for (const k of Object.keys(state.config.prices[prov])) prices[prov][k] = { ...state.config.prices[prov][k] }
    }
    const perModel = {}
    for (const k of Object.keys(state.usage.perModel)) perModel[k] = { ...state.usage.perModel[k] }
    const data = {
      v: 2,
      savedAt: Date.now(),
      config: {
        initialBalance: state.config.initialBalance,
        lowBalanceThreshold: state.config.lowBalanceThreshold,
        defaultPrice: { ...state.config.defaultPrice },
        prices,
      },
      usage: {
        cacheHitTokens: state.usage.cacheHitTokens,
        cacheMissTokens: state.usage.cacheMissTokens,
        outputTokens: state.usage.outputTokens,
        calls: state.usage.calls,
        cost: state.usage.cost,
        perModel,
      },
      ledger: state.ledger.slice(-200),
      startedAt: state.startedAt,
    }
    try {
      const target = await fs.resolve(ledgerFile)
      const policy = sp ? sp.resolve() : undefined
      await fs.writeText(target, JSON.stringify(data), undefined, undefined, policy)
      persist.savedAt = data.savedAt
      persist.error = ''
    } catch (err) {
      persist.error = err && err.message ? err.message : String(err)
    }
  }
  function schedulePersist() {
    if (!ready) return
    saveChain = saveChain.then(savePersisted).catch(() => {})
  }

  async function fetchOfficial() {
    const web = ctx.get('web')
    if (web === undefined) {
      state.official = { syncedAt: Date.now(), ok: false, message: 'web 服务不可用，保留内置官方单价', models: state.official.models }
      return snapshot()
    }
    try {
      const res = await web.fetch({ url: OFFICIAL_URL })
      const content = (res && res.body && res.body.content) ? res.body.content : ''
      const models = parseOfficialPrices(content)
      const applied = applyOfficialPrices(models)
      state.official = {
        syncedAt: Date.now(),
        ok: applied > 0,
        message: applied > 0 ? ('已同步 ' + applied + ' 个 DeepSeek 模型高峰单价（官方文档，HTTP ' + res.statusCode + '）') : ('未能从官方页面解析出单价（HTTP ' + res.statusCode + '），保留现有单价'),
        models,
        source: res.url,
      }
    } catch (err) {
      state.official = { syncedAt: Date.now(), ok: false, message: '同步失败：' + (err && err.message ? err.message : String(err)), models: state.official.models }
    }
    return snapshot()
  }

  // Real-time metering: pass through every streaming model call, settle on stream end.
  ctx.on('llm/stream', (options, next) => {
    const provider = String((options && options.provider) || '')
    const model = String((options && options.model) || 'unknown')
    const ts = Date.now()
    const upstream = next()
    return (async function* passthrough() {
      let usage = null
      let chars = 0
      try {
        for await (const chunk of upstream) {
          if (usage === null) usage = readUsage(chunk)
          chars += deltaText(chunk).length
          yield chunk
        }
        let cacheHit
        let cacheMiss
        let output
        let estimated = false
        if (usage !== null) {
          cacheHit = usage.cacheHit
          cacheMiss = usage.cacheMiss
          output = usage.output
        } else {
          estimated = true
          cacheHit = 0
          cacheMiss = estimateInputTokens(options)
          output = Math.ceil(chars / 4)
        }
        if (cacheHit > 0 || cacheMiss > 0 || output > 0) record(provider, model, cacheHit, cacheMiss, output, estimated, ts)
      } catch (err) {
        throw err
      }
    })()
  })

  // ---- /api/dsh-billing routes (browser half talks plain fetch) ----
  function isLoopbackRequest(req) {
    const address = req.socket && req.socket.remoteAddress
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
    const host = req.headers.host
    if (typeof host !== 'string') return false
    let hostUrl
    try { hostUrl = new URL('http://' + host) } catch { return false }
    if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = req.headers.origin
    if (origin === undefined) return true
    try { return new URL(origin).host === hostUrl.host } catch { return false }
  }
  function writeJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
    res.end(JSON.stringify(body))
  }
  async function readJsonBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 64 * 1024) return undefined
      chunks.push(chunk)
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      return (typeof parsed === 'object' && parsed !== null) ? parsed : undefined
    } catch { return undefined }
  }
  const guard = (req, res, method) => {
    if (req.method !== method) { writeJson(res, 405, { error: 'method not allowed' }); return false }
    if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return false }
    return true
  }

  function setConfig(args) {
    if (!args || typeof args !== 'object') return snapshot()
    if (args.initialBalance !== undefined) state.config.initialBalance = Math.max(0, pickNumber(args.initialBalance))
    if (args.lowBalanceThreshold !== undefined) state.config.lowBalanceThreshold = Math.max(0, pickNumber(args.lowBalanceThreshold))
    if (args.defaultPrice && typeof args.defaultPrice === 'object') {
      state.config.defaultPrice = { cacheHitInput: pickNumber(args.defaultPrice.cacheHitInput), cacheMissInput: pickNumber(args.defaultPrice.cacheMissInput), output: pickNumber(args.defaultPrice.output) }
    }
    if (args.prices !== undefined && args.prices !== null) {
      if (Array.isArray(args.prices)) {
        const prices = {}
        for (const row of args.prices) {
          if (!row || typeof row !== 'object') continue
          const prov = String(row.provider || '').trim() || '*'
          const key = String(row.model || '').trim() || '__default'
          if (!prices[prov]) prices[prov] = {}
          prices[prov][key] = { cacheHitInput: pickNumber(row.cacheHitInput), cacheMissInput: pickNumber(row.cacheMissInput), output: pickNumber(row.output) }
        }
        state.config.prices = prices
      } else if (typeof args.prices === 'object') {
        const prices = deepPrices()
        for (const prov of Object.keys(args.prices)) {
          const bucket = args.prices[prov]
          if (bucket && typeof bucket === 'object') {
            if (!prices[prov]) prices[prov] = {}
            for (const k of Object.keys(bucket)) {
              const v = bucket[k]
              if (v && typeof v === 'object') prices[prov][k] = { cacheHitInput: pickNumber(v.cacheHitInput), cacheMissInput: pickNumber(v.cacheMissInput), output: pickNumber(v.output) }
            }
          }
        }
        state.config.prices = prices
      }
    }
    schedulePersist()
    return snapshot()
  }

  const routes = [
    { kind: 'exact', path: '/api/dsh-billing/state', handler: (req, res) => { if (!guard(req, res, 'GET')) return; writeJson(res, 200, snapshot()) } },
    { kind: 'exact', path: '/api/dsh-billing/config', handler: async (req, res) => { if (!guard(req, res, 'POST')) return; const body = await readJsonBody(req); writeJson(res, 200, body === undefined ? { error: 'bad json' } : setConfig(body)) } },
    { kind: 'exact', path: '/api/dsh-billing/sync-balance', handler: async (req, res) => { if (!guard(req, res, 'POST')) return; const body = await readJsonBody(req); if (body && typeof body === 'object' && body.balance !== undefined) { const target = Math.max(0, pickNumber(body.balance)); state.config.initialBalance = target + totalCost(); schedulePersist() } writeJson(res, 200, snapshot()) } },
    { kind: 'exact', path: '/api/dsh-billing/reset', handler: (req, res) => { if (!guard(req, res, 'POST')) return; state.usage = { cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0, calls: 0, cost: 0, perModel: {} }; state.ledger = []; state.startedAt = Date.now(); schedulePersist(); writeJson(res, 200, snapshot()) } },
    { kind: 'exact', path: '/api/dsh-billing/refresh-official', handler: async (req, res) => { if (!guard(req, res, 'POST')) return; writeJson(res, 200, await fetchOfficial()) } },
  ]
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'billing: routes')

  // Model-facing tool.
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'billing_balance',
    description: '查询本机 DSH 计费监控的实时状态：当前余额、累计费用、token 用量、按供应商/模型费用明细与最近流水。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (args, value) => {
        const money = (v) => { const a = Math.abs(v); return (a > 0 && a < 0.01) ? v.toFixed(4) : v.toFixed(2) }
        const statusText = value.status === 'ok' ? '余额充足' : value.status === 'low' ? '余额偏低' : '余额已耗尽'
        const models = (value.perModel || []).slice(0, 8).map((m) => (m.provider ? m.provider + '/' : '') + m.model + ': ¥' + money(m.cost) + '（' + m.calls + ' 次）').join('；') || '暂无'
        return [{ type: 'text', text: '当前余额 ¥' + money(value.balance) + '（' + statusText + '）。累计消费 ¥' + money(value.cost) + '，共 ' + value.calls + ' 次调用，输入 ' + value.inputTokens + ' / 输出 ' + value.outputTokens + ' tokens。按供应商/模型：' + models + '。' }]
      },
    },
    execute: async () => snapshot(),
  })), 'billing: tool')

  // Agent announcement.
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'plugin:dsh-billing',
    order: 150,
    text: '本机已安装 dsh-billing 计费插件：实时统计本机模型调用用量与费用（按供应商/模型单价，DeepSeek v4 峰谷价），侧边栏底部有余额入口；可用 billing_balance 工具查询余额与账单；配置在侧边栏计费面板中。',
  }), 'billing: announcement')

  loadPersisted().then(() => { fetchOfficial().catch(() => {}) }).catch(() => {})
}

export { apply }
