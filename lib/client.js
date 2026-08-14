/**
 * dsh-billing browser half: a balance pill below the sidebar Settings button
 * with an expandable overview block fused into the sidebar foot, plus a
 * dedicated "计费" page inside the DSH settings dialog.
 *
 *   - settings.section (slot) -> "计费" settings page (anchor balance, prices,
 *     thresholds, official sync, data management)
 *   - sidebar foot (DOM)      -> pill + overview block appended after the
 *     settingsArea in the footArea, so both live below the Settings button as
 *     real sidebar blocks (not floating cards). The pill widens while the
 *     panel is open; in the collapsed rail the pill becomes a round dot that
 *     expands the sidebar on click, and the panel hides via CSS.
 *
 * Talks to the host half over same-origin fetch to /api/dsh-billing/*.
 */
window.__ModuleLoader__.load({
  id: 'dsh-billing',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createRoot } = require('react-dom/client')

    // ---------- styles ----------
    const STYLE_TEXT = `
.dbill-foot-pill{width:100%;flex:none;min-width:0;display:flex}
.dbill-pill{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border-radius:8px;background:transparent;border:1px solid transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;font-family:inherit}
.dbill-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbill-pill-active{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1)}
.dbill-pill-active .dbill-pill-label{font-size:15px}
.dbill-pill-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}
.dbill-pill-label{font-weight:700;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-sidebar-collapsed] .dbill-foot-pill{justify-content:center;width:auto}
[data-sidebar-collapsed] .dbill-pill{width:36px;height:36px;justify-content:center;padding:0;border-radius:8px;gap:0}
[data-sidebar-collapsed] .dbill-pill-label{display:none}
[data-sidebar-collapsed] .dbill-foot-panel{display:none}
@keyframes dbill-blink{0%,100%{opacity:1}50%{opacity:.25}}
.dbill-foot-panel{width:100%;flex:none;min-width:0;border-bottom:2px solid var(--dsw-alias-border-l1);margin-bottom:4px}
.dbill-panel-body{display:flex;flex-direction:column;gap:8px;padding:2px 4px 10px;max-height:min(52vh, 440px);overflow-y:auto}
.dbill-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.dbill-stat{background:var(--dsw-alias-bg-layer-1);border-radius:6px;padding:6px 8px;display:flex;flex-direction:column;gap:2px}
.dbill-stat-value{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.dbill-stat-label{color:var(--dsw-alias-label-secondary);font-size:11px}
.dbill-sec-title{color:var(--dsw-alias-label-secondary);font-weight:600;margin:2px 0 0;letter-spacing:.4px;font-size:11px}
.dbill-row{display:flex;align-items:center;gap:8px;padding:3px 0;min-width:0}
.dbill-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.dbill-cost{font-weight:600;font-variant-numeric:tabular-nums;font-size:12px}
.dbill-time{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11px}
.dbill-tag{padding:0 4px;border-radius:4px;font-size:10px;font-weight:600}
.dbill-note{color:var(--dsw-alias-label-secondary);line-height:1.5;font-size:11px}
.dbill-group{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dbill-group-title{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;background:transparent;border:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);text-align:left;font-family:inherit}
.dbill-group-title:hover{background:var(--dsw-alias-bg-layer-2)}
.dbill-group-arrow{color:var(--dsw-alias-label-secondary);font-size:12px;transition:transform .15s;display:inline-block}
.dbill-group-body{padding:2px 12px 12px;display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.dbill-field{display:flex;flex-direction:column;gap:4px}
.dbill-field-label{color:var(--dsw-alias-label-secondary);font-size:12px}
.dbill-input{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 9px;font-size:12px;outline:none;width:100%;box-sizing:border-box;font-family:inherit}
.dbill-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dbill-price-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.dbill-rows{display:flex;flex-direction:column;gap:6px}
.dbill-rows-line{display:grid;grid-template-columns:0.9fr 1.1fr 0.8fr 0.8fr 0.8fr auto;gap:6px;align-items:center}
.dbill-btn{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 11px;cursor:pointer;font-size:12px;align-self:flex-start;font-family:inherit}
.dbill-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.dbill-btn:disabled{opacity:.5;cursor:default}
.dbill-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:600}
.dbill-btn-primary:hover{filter:brightness(1.08)}
.dbill-btn-danger{background:transparent;border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dbill-actions{display:flex;gap:10px}
.dbill-sync-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dbill-sync-status{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.dbill-sync-input{max-width:180px}
.dbill-section{display:flex;flex-direction:column;gap:10px;width:100%}
`
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-billing"]') === null) {
      const styleEl = document.createElement('style')
      styleEl.dataset.pluginCss = 'dsh-billing'
      styleEl.textContent = STYLE_TEXT
      document.head.appendChild(styleEl)
    }

    // ---------- api ----------
    const API = {
      state: '/api/dsh-billing/state',
      config: '/api/dsh-billing/config',
      syncBalance: '/api/dsh-billing/sync-balance',
      reset: '/api/dsh-billing/reset',
      refreshOfficial: '/api/dsh-billing/refresh-official',
    }
    async function apiGet(path) {
      const res = await fetch(path, { headers: { accept: 'application/json' } })
      return res.json()
    }
    async function apiPost(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      return res.json()
    }

    // ---------- formatting ----------
    function money(v) {
      if (v === null || v === undefined) return '—'
      const a = Math.abs(v)
      return (a > 0 && a < 0.01) ? v.toFixed(4) : v.toFixed(2)
    }
    function tokens(v) {
      if (!Number.isFinite(v)) return '—'
      if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
      if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
      return String(v)
    }
    function timeText(ts) {
      const d = new Date(ts)
      const p = (n) => (n < 10 ? '0' : '') + n
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    }
    function dateTimeText(ts) {
      try { return new Date(ts).toLocaleString() } catch { return '' }
    }
    const STATUS = {
      ok: { dot: 'var(--dsw-alias-state-success-primary)', text: '余额充足' },
      low: { dot: 'var(--dsw-alias-state-warn-primary)', text: '余额不足' },
      exhausted: { dot: 'var(--dsw-alias-state-error-primary)', text: '余额耗尽' },
    }

    // ---------- shared stores (external-store shape for React) ----------
    const stateStore = { snap: null, listeners: new Set() }
    stateStore.getSnapshot = () => stateStore.snap
    stateStore.subscribe = (fn) => { stateStore.listeners.add(fn); return () => { stateStore.listeners.delete(fn) } }
    const emitState = () => { for (const f of stateStore.listeners) f() }
    async function refreshState() {
      try {
        const s = await apiGet(API.state)
        stateStore.snap = s
        emitState()
      } catch { /* keep last snapshot */ }
    }

    const panelStore = { open: false, listeners: new Set() }
    panelStore.getSnapshot = () => panelStore.open
    panelStore.subscribe = (fn) => { panelStore.listeners.add(fn); return () => { panelStore.listeners.delete(fn) } }
    function setPanelOpen(v) {
      if (panelStore.open !== v) { panelStore.open = v; for (const f of panelStore.listeners) f() }
    }
    const togglePanel = () => setPanelOpen(!panelStore.open)

    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot)
    }
    function isSidebarCollapsed() {
      return document.querySelector('[data-sidebar-collapsed]') !== null
    }

    // ---------- sidebar footer pill (below the Settings button) ----------
    function fallbackExpand() {
      const btn = document.querySelector('[data-pane="sidebar"] button[class*="toggle"], [class*="sidebarCol"] button[class*="toggle"]')
      if (btn !== null) btn.click()
    }
    let expandSidebar = fallbackExpand
    function BillingPill() {
      const snap = useStore(stateStore)
      const open = useStore(panelStore)
      const st = STATUS[(snap && snap.status) || 'ok'] || STATUS.ok
      const label = snap ? '¥' + money(snap.balance) : '¥—'
      const onClick = () => {
        if (isSidebarCollapsed()) { setPanelOpen(true); expandSidebar() }
        else togglePanel()
      }
      return React.createElement('button', {
        type: 'button',
        className: 'dbill-pill' + (open ? ' dbill-pill-active' : ''),
        'aria-label': '计费监控：' + label,
        title: '计费监控：点击查看余额与流水',
        onClick: onClick,
      },
        React.createElement('span', {
          className: 'dbill-pill-dot',
          style: { background: st.dot, animation: snap && snap.status !== 'ok' ? 'dbill-blink 1.1s ease-in-out infinite' : 'none' },
        }),
        React.createElement('span', { className: 'dbill-pill-label' }, label),
      )
    }

    // ---------- overview block (injected into the sidebar footArea) ----------
    function OverviewView() {
      const open = useStore(panelStore)
      const snap = useStore(stateStore)
      if (!open) return null
      const ledger = ((snap && snap.ledger) || []).slice(0, 5)
      return React.createElement('div', { className: 'dbill-panel-body' },
        snap ? React.createElement('div', { className: 'dbill-grid' },
          React.createElement('div', { className: 'dbill-stat' },
            React.createElement('div', { className: 'dbill-stat-value' }, '¥' + money(snap.cost)),
            React.createElement('div', { className: 'dbill-stat-label' }, '已消费')),
          React.createElement('div', { className: 'dbill-stat' },
            React.createElement('div', { className: 'dbill-stat-value' }, String(snap.calls)),
            React.createElement('div', { className: 'dbill-stat-label' }, '调用')),
          React.createElement('div', { className: 'dbill-stat' },
            React.createElement('div', { className: 'dbill-stat-value' }, tokens(snap.inputTokens)),
            React.createElement('div', { className: 'dbill-stat-label' }, '输入')),
          React.createElement('div', { className: 'dbill-stat' },
            React.createElement('div', { className: 'dbill-stat-value' }, tokens(snap.outputTokens)),
            React.createElement('div', { className: 'dbill-stat-label' }, '输出')),
        ) : null,
        ledger.length > 0 ? React.createElement('div', { className: 'dbill-sec-title' }, '最近流水') : null,
        ledger.map((e, i) => React.createElement('div', { key: 'l-' + e.ts + '-' + i, className: 'dbill-row' },
          React.createElement('span', { className: 'dbill-time' }, timeText(e.ts)),
          React.createElement('span', { className: 'dbill-name' }, (e.provider ? e.provider + '/' : '') + e.model + (e.estimated ? ' (估)' : '')),
          e.rate === 'peak' ? React.createElement('span', { className: 'dbill-tag', style: { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-state-warn-primary)' } }, '峰')
            : (e.rate === 'offpeak' ? React.createElement('span', { className: 'dbill-tag', style: { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-state-success-primary)' } }, '谷') : null),
          React.createElement('span', { className: 'dbill-cost' }, '¥' + money(e.cost)),
        )),
        React.createElement('div', { className: 'dbill-note' }, '单价、余额锚定与数据管理：设置 → 计费'),
      )
    }
    function mountSidebarFoot() {
      let pillHost = null
      let pillRoot = null
      let panelHost = null
      let panelRoot = null
      let disposed = false
      const ensure = () => {
        if (disposed) return
        if (pillHost !== null && !pillHost.isConnected) {
          try { pillRoot.unmount() } catch { /* noop */ }
          pillRoot = null
          pillHost = null
        }
        if (panelHost !== null && !panelHost.isConnected) {
          try { panelRoot.unmount() } catch { /* noop */ }
          panelRoot = null
          panelHost = null
        }
        if (pillHost !== null && panelHost !== null) return
        const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
        const foot = column?.querySelector('[class*="footArea"]')
        if (!foot) return
        const settings = foot.querySelector('[class*="settingsArea"]')
        if (pillHost === null) {
          pillHost = document.createElement('div')
          pillHost.dataset.dshBillingPill = ''
          pillHost.className = 'dbill-foot-pill'
          foot.insertBefore(pillHost, settings)
          pillRoot = createRoot(pillHost)
          pillRoot.render(React.createElement(BillingPill))
        }
        if (panelHost === null) {
          panelHost = document.createElement('div')
          panelHost.dataset.dshBillingPanel = ''
          panelHost.className = 'dbill-foot-panel'
          foot.insertBefore(panelHost, settings)
          panelRoot = createRoot(panelHost)
          panelRoot.render(React.createElement(OverviewView))
        }
      }
      const observer = new MutationObserver(() => {
        if (isSidebarCollapsed()) setPanelOpen(false)
        ensure()
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
      // Belt-and-braces: polling fallback so the panel always collapses with
      // the rail even if the attribute observer misses a React update.
      const collapseTimer = setInterval(() => {
        if (isSidebarCollapsed()) setPanelOpen(false)
      }, 500)
      ensure()
      return () => {
        disposed = true
        observer.disconnect()
        clearInterval(collapseTimer)
        try { if (pillRoot !== null) pillRoot.unmount() } catch { /* noop */ }
        try { if (panelRoot !== null) panelRoot.unmount() } catch { /* noop */ }
        if (pillHost !== null) pillHost.remove()
        if (panelHost !== null) panelHost.remove()
        pillRoot = null
        panelRoot = null
        pillHost = null
        panelHost = null
      }
    }

    // ---------- settings page: 计费 ----------
    function Group(props) {
      const [open, setOpen] = React.useState(!!props.defaultOpen)
      return React.createElement('div', { className: 'dbill-group' },
        React.createElement('button', { className: 'dbill-group-title', onClick: () => setOpen(!open) },
          React.createElement('span', { className: 'dbill-group-arrow', style: { transform: open ? 'rotate(90deg)' : 'none' } }, '▸'),
          React.createElement('span', null, props.title),
        ),
        open ? React.createElement('div', { className: 'dbill-group-body' }, props.children) : null,
      )
    }
    function fieldEl(label, value, onChange) {
      return React.createElement('label', { className: 'dbill-field' },
        React.createElement('span', { className: 'dbill-field-label' }, label),
        React.createElement('input', { className: 'dbill-input', type: 'number', step: '0.01', min: '0', value: value, onChange: (e) => onChange(e.target.value) }),
      )
    }
    function BillingSection() {
      const snap = useStore(stateStore)
      const [form, setForm] = React.useState(null)
      const [saved, setSaved] = React.useState(false)
      const [confirmReset, setConfirmReset] = React.useState(false)
      const [syncing, setSyncing] = React.useState(false)
      const [syncAmount, setSyncAmount] = React.useState('')
      const [balanceSynced, setBalanceSynced] = React.useState(false)

      React.useEffect(() => { refreshState() }, [])
      if (snap !== null && form === null) {
        const rows = []
        const prices = snap.config.prices || {}
        for (const prov of Object.keys(prices)) {
          const bucket = prices[prov]
          for (const key of Object.keys(bucket)) {
            rows.push({ provider: prov === '*' ? '' : prov, model: key === '__default' ? '' : key, hitInput: bucket[key].cacheHitInput, missInput: bucket[key].cacheMissInput, output: bucket[key].output })
          }
        }
        setForm({
          initialBalance: snap.config.initialBalance,
          lowBalanceThreshold: snap.config.lowBalanceThreshold,
          defaultHit: snap.config.defaultPrice.cacheHitInput,
          defaultMiss: snap.config.defaultPrice.cacheMissInput,
          defaultOutput: snap.config.defaultPrice.output,
          rows,
        })
      }

      if (snap === null || form === null) {
        return React.createElement('div', { className: 'dbill-section' }, '加载中…')
      }

      const set = (key, value) => setForm({ ...form, [key]: value })
      const setRow = (i, key, value) => {
        const rows = form.rows.slice()
        rows[i] = { ...rows[i], [key]: value }
        setForm({ ...form, rows })
      }
      const addRow = () => setForm({ ...form, rows: form.rows.concat([{ provider: 'deepseek', model: '', hitInput: 0.3, missInput: 9, output: 27 }]) })
      const removeRow = (i) => setForm({ ...form, rows: form.rows.filter((_, j) => j !== i) })

      const save = async () => {
        const prices = form.rows.map((r) => ({
          provider: String(r.provider || '').trim(),
          model: String(r.model || '').trim(),
          cacheHitInput: Number(r.hitInput) || 0,
          cacheMissInput: Number(r.missInput) || 0,
          output: Number(r.output) || 0,
        }))
        try {
          await apiPost(API.config, {
            initialBalance: Math.max(0, Number(form.initialBalance) || 0),
            lowBalanceThreshold: Math.max(0, Number(form.lowBalanceThreshold) || 0),
            defaultPrice: { cacheHitInput: Number(form.defaultHit) || 0, cacheMissInput: Number(form.defaultMiss) || 0, output: Number(form.defaultOutput) || 0 },
            prices,
          })
          await refreshState()
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        } catch { /* noop */ }
      }
      const reset = async () => {
        if (!confirmReset) {
          setConfirmReset(true)
          setTimeout(() => setConfirmReset(false), 3000)
          return
        }
        setConfirmReset(false)
        try { await apiPost(API.reset); await refreshState() } catch { /* noop */ }
      }
      const syncOfficial = async () => {
        setSyncing(true)
        try { await apiPost(API.refreshOfficial); await refreshState() } catch { /* noop */ }
        finally { setSyncing(false) }
      }
      const applyBalance = async () => {
        const n = Number(syncAmount)
        if (!Number.isFinite(n) || n < 0) return
        try {
          await apiPost(API.syncBalance, { balance: n })
          await refreshState()
          setSyncAmount('')
          setBalanceSynced(true)
          setTimeout(() => setBalanceSynced(false), 2000)
        } catch { /* noop */ }
      }

      const off = snap.official
      const pers = snap.persist

      return React.createElement('div', { className: 'dbill-section' },
        React.createElement(Group, { title: '余额', defaultOpen: true },
          React.createElement('div', { className: 'dbill-sync-row' },
            React.createElement('input', { className: 'dbill-input dbill-sync-input', type: 'number', step: '0.01', min: '0', placeholder: '粘贴官方余额（¥）', value: syncAmount, onChange: (e) => setSyncAmount(e.target.value) }),
            React.createElement('button', { className: 'dbill-btn dbill-btn-primary', onClick: applyBalance }, balanceSynced ? '✓ 已同步' : '应用'),
          ),
          React.createElement('div', { className: 'dbill-note' }, '从 platform.deepseek.com 复制当前余额粘贴于此，把余额锚定到该值后继续按用量扣减。'),
          React.createElement('div', { className: 'dbill-price-grid' },
            fieldEl('初始余额（¥）', form.initialBalance, (v) => set('initialBalance', v)),
            fieldEl('低余额告警阈值（¥）', form.lowBalanceThreshold, (v) => set('lowBalanceThreshold', v)),
          ),
        ),

        React.createElement(Group, { title: '计费单价' },
          React.createElement('div', { className: 'dbill-sync-row' },
            React.createElement('span', { className: 'dbill-sync-status', style: { color: off && off.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
              (off ? off.message : '尚未同步') + (off && off.syncedAt ? ' · ' + dateTimeText(off.syncedAt) : '')),
            React.createElement('button', { className: 'dbill-btn', onClick: syncOfficial, disabled: syncing }, syncing ? '同步中…' : '同步官方单价'),
          ),
          React.createElement('div', { className: 'dbill-field-label' }, '未知供应商默认单价（¥ / 1M tokens）'),
          React.createElement('div', { className: 'dbill-price-grid' },
            fieldEl('命中输入', form.defaultHit, (v) => set('defaultHit', v)),
            fieldEl('未命中输入', form.defaultMiss, (v) => set('defaultMiss', v)),
            fieldEl('输出', form.defaultOutput, (v) => set('defaultOutput', v)),
          ),
          React.createElement('div', { className: 'dbill-field-label' }, '按供应商/模型单价（高峰价，¥ / 1M tokens）'),
          React.createElement('div', { className: 'dbill-rows' },
            form.rows.map((r, i) => React.createElement('div', { key: 'r-' + i, className: 'dbill-rows-line' },
              React.createElement('input', { className: 'dbill-input', value: r.provider, placeholder: '供应商', onChange: (e) => setRow(i, 'provider', e.target.value) }),
              React.createElement('input', { className: 'dbill-input', value: r.model, placeholder: '模型（留空=默认）', onChange: (e) => setRow(i, 'model', e.target.value) }),
              React.createElement('input', { className: 'dbill-input', type: 'number', step: '0.01', min: '0', value: r.hitInput, onChange: (e) => setRow(i, 'hitInput', e.target.value) }),
              React.createElement('input', { className: 'dbill-input', type: 'number', step: '0.01', min: '0', value: r.missInput, onChange: (e) => setRow(i, 'missInput', e.target.value) }),
              React.createElement('input', { className: 'dbill-input', type: 'number', step: '0.01', min: '0', value: r.output, onChange: (e) => setRow(i, 'output', e.target.value) }),
              React.createElement('button', { className: 'dbill-btn dbill-btn-danger', onClick: () => removeRow(i) }, '删除'),
            )),
            React.createElement('button', { className: 'dbill-btn', onClick: addRow }, '+ 添加供应商单价'),
          ),
          React.createElement('div', { className: 'dbill-note' }, '匹配：供应商+模型 → 任意供应商同名模型 → 该供应商默认 → 全局默认。deepseek 供应商 v4 模型自 08-17 起峰谷定价（高峰=北京 9–12、14–18，空闲半价）。'),
        ),

        React.createElement(Group, { title: '数据' },
          pers ? React.createElement('span', { className: 'dbill-sync-status', style: { color: pers.path && !pers.error ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
            (pers.path ? '账本：' + pers.path : '未启用持久化') + (pers.savedAt > 0 ? ' · 已保存 ' + dateTimeText(pers.savedAt) : '') + (pers.error ? ' · ' + pers.error : ''),
          ) : null,
          React.createElement('div', { className: 'dbill-actions' },
            React.createElement('button', { className: 'dbill-btn dbill-btn-primary', onClick: save }, saved ? '✓ 已保存' : '保存配置'),
            React.createElement('button', { className: 'dbill-btn dbill-btn-danger', onClick: reset }, confirmReset ? '再次点击确认重置' : '重置用量'),
          ),
          React.createElement('div', { className: 'dbill-note' }, '余额、单价与流水持久化到工作区账本文件，DSH 重启后自动恢复。'),
        ),
      )
    }

    // ---------- boot ----------
    function apply(ctx) {
      const layout = ctx.get('layout')
      if (layout !== undefined && typeof layout.toggleSidebar === 'function') {
        expandSidebar = () => {
          try { layout.toggleSidebar() } catch { fallbackExpand() }
        }
      }
      const refreshTimer = setInterval(refreshState, 2000)
      refreshState()
      ctx.effect(() => () => { clearInterval(refreshTimer) }, 'dsh-billing: poller')
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'billing',
        order: 50,
        label: () => '计费',
      }, BillingSection)), 'dsh-billing: settings page')
      ctx.effect(() => mountSidebarFoot(), 'dsh-billing: sidebar foot pill + panel')
    }
    module.exports.apply = apply
    module.exports.inject = ['slots', 'layout']

    return module.exports
  },
})
