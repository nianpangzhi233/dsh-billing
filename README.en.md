# dsh-billing — Realtime billing monitor for the DSH web GUI

A billing monitoring plugin for [DeepSeek Harness](https://github.com/deepseek-ai/dsh)
(DSH) web GUI: tracks local model-call usage and cost in real time, prices by
provider/model (DeepSeek v4 peak/off-peak), and supports balance anchoring,
official price sync and JSON ledger persistence. Built entirely on the official
interfaces and the client slots system — no DSH source changes.

## Features

| Feature | Description |
| --- | --- |
| Realtime balance | Balance pill at the sidebar footer, refreshes every 2 seconds; status dot (healthy / low / exhausted, blinks on alert) |
| Overview panel | Click the pill to expand it inside the sidebar: spent / calls / input / output tokens plus recent ledger rows (peak/off-peak tags); auto-collapses when the sidebar collapses; in the collapsed rail the pill becomes a dot that expands the sidebar on click |
| Provider pricing | Matching order: provider+model → same model under any provider → provider default → global default. DeepSeek v4 models use peak/off-peak pricing from 08-17 (peak = Beijing 9–12, 14–18; off-peak at half price); cache-hit input is billed at the low rate |
| Balance anchoring | Paste the official balance from platform.deepseek.com to calibrate, then keep deducting local usage |
| Official sync | One-click fetch of DeepSeek official model prices (built-in base prices + persisted overrides merged) |
| Settings page | DSH Settings → "计费" (billing) section: balance, low-balance threshold, default prices, per-provider price table, data management |
| Agent tool | `billing_balance`: query balance, cost, token usage and per-model breakdown |
| Persistence | Ledger JSON atomically written in the workspace; auto-restored after DSH restart (balance, prices, ledger) |

## Installation

The package ships pre-built plain JS (`lib/`) with **no build step**, so a git
install works as-is (no `prepare` script, no build authorization needed):

```sh
# from this repository
dsh plugin --profile web add github:nianpangzhi233/dsh-billing

# or from a local checkout / tarball
dsh plugin --profile web add ./dsh-billing
dsh plugin --profile web add ./dsh-billing-0.1.0.tgz
```

Restart `dsh web` afterwards: the balance pill appears at the sidebar footer
(above the Settings button), the "计费" section appears in DSH Settings, and
the agent gains the `billing_balance` tool.

## Configuration

DSH Settings → "计费" section (or the expanded sidebar pill panel):

- **Balance**: paste the official balance to anchor, initial balance,
  low-balance alert threshold (default ¥20)
- **Pricing**: default price for unknown providers (¥ / 1M tokens) plus a
  per-provider/model price table (add/remove rows); "sync official prices"
  fetches the DeepSeek price list in one click
- **Data**: ledger path and save time, save config, reset usage (double-click
  to confirm)

## Data

- Ledger file: `.dsh-billing-ledger.json` (workspace directory preferred,
  spRoot fallback), v2 shape: `config` (initial balance / threshold / nested
  price table) / `usage` (token split counters) / `ledger` (per-call rows with
  peak/off-peak rate) / `startedAt`
- Price matching: provider+model → same model under any provider → provider
  default → global default
- Peak pricing: peak = Beijing 9–12, 14–18; otherwise off-peak (half price);
  applies to deepseek v4 models from 08-17

## Notes

- **Only this machine's DSH model calls are metered**; the official balance
  includes other channels, so re-anchor it periodically.
- Token usage is counted split: cache-miss input (`inputTokens`), cache-hit
  input (`cacheReadTokens`), output (`outputTokens`).
- Billing is an estimate; rates follow the official DeepSeek price list.
  "Sync official prices" requires a usable platform web provider.
- Routes `/api/dsh-billing/*` are loopback-only (same-origin checked).

## License

[Apache-2.0](LICENSE)
