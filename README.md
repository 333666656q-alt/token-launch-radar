# Launch Radar

![make.fun bounty: Build the best token launch radar](https://make.fun/badge/token-radar-01.svg)

An entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty ($1,325 in USDC, paid from escrow on Solana).

Launch Radar reads the competition's sealed snapshot of every protocol DefiLlama tracks (758 protocols, fetched 2026-11-14), finds the ones that still record no token and are not a wrapped, staked, bridged or versioned product of a token that already trades, ranks them by what a token launch would be worth if the record stayed as it is, and hands in a dashboard a reader can farm from.

## The model: calibrated, not asserted

Most radars pick a multiple out of the air. This one reads it off the snapshot itself:

- For every category, the snapshot's own live-token protocols give a market cap per dollar of TVL. The board uses their **median**, shrunk toward the all-category median (0.21x) by the comp count — `(n x median + 5 x global) / (n + 5)` — and clamped to [0.02, 2.5], so a category priced by one wild comp cannot run away.
- `implied = round(TVL x category multiple x growth x maturity x reach)`, where growth is `1 + 0.6 x clamp(change_7d, -50, 100)/100`, maturity pays 0.78x–1.20x for up to four years run with no token, and reach adds 1.5% per extra chain up to twelve.
- No protocol name is special-cased: one function scores all **198 rows** — the whole 40-protocol watchlist plus 158 early finds below the watchlist's $50M floor. Protocols whose token already trades are never ranked; they are the calibration set, shown in the dashboard's Live comps view with the market's own values.
- The dashboard recomputes every row from the calibration table it ships and says whether the result matches `board.json`, so the page and the board cannot silently disagree.

## The dashboard

A static page (no framework, no network) in `dashboard/`: a sortable, filterable board (search, category, chain, radar segment, minimum TVL), a detail drawer for every protocol with the valuation step by step and a seven-step farm plan — each step with what it costs and how long it takes, plus the plan's capital, estimated fees and duration — a Live comps view, and a Method view that publishes the formula and the calibration table. Farm plans are generated per protocol from its category playbook, main chain (gas budget), TVL (position size) and age (qualifying hold).

## Run it

Node.js 22.18 or later, standard library only:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`main.ts` reads `/input/snapshot.json` by default (or `--input <file|dir>`), and writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (built with `vendor/makefun-board.ts`) to the output directory. Two runs write identical bytes.

## Layout

- `main.ts` — the entry point: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the calibration, the valuation, the farm-plan generator and the board's self-check.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored unmodified as the bounty requires.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page the judge reads.
- `screenshots/` — the board, a detail view and a filtered view, rendered from this dashboard.

## License

MIT — see `LICENSE`.
