// Launch Radar's model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// The board covers every slug on the snapshot's watchlist (the floor, never a ceiling) and adds every
// other protocol that records no token and is not a wrapped, staked, bridged or versioned product of
// one that trades, at any TVL: the early finds are the radar's reason to exist. Protocols whose token
// already trades are never ranked; they are the calibration set, shown apart with the market's values.
//
// Implied value is calibrated, not asserted. The snapshot's own live-token protocols say what the
// market pays for a dollar of TVL in each category, so the model reads that multiple off them:
//
//   comps       = the snapshot's protocols with a token and a market cap
//   multiple(c) = the median market-cap/TVL of c's comps, shrunk toward the all-category median by
//                 the comp count: (n x median + 5 x global) / (n + 5), clamped to [0.02, 2.5];
//                 a category with no comps takes the global median
//   base        = tvl_usd x multiple(category)
//   growth      = 1 + 0.6 x clamp(change_7d, -50, 100) / 100     (unreported growth is neutral)
//   maturity    = 0.78 + 0.42 x min(age_days, 1460) / 1460       (unknown age counts as 300 days)
//   reach       = 1 + 0.015 x min(chains - 1, 12)
//   implied     = max(1, round(base x growth x maturity x reach))
//
// No protocol name is ever special-cased: one function scores every row, and the dashboard restates
// the calibration table so a reader can recompute any row from the snapshot's figures alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  maturity_base: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  shrink_weight: 5,
  multiple_floor: 0.02,
  multiple_cap: 2.5,
  growth_weight: 0.6,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  maturity_base: 0.78,
  maturity_range: 0.42,
  maturity_days: 1460,
  unknown_age_days: 300,
  reach_per_chain: 0.015,
  reach_max_extra_chains: 12,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'comps-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 48;

/** One category's calibration: how many live comps, their median multiple, and the multiple used. */
export interface CategoryCal {
  category: string;
  comps: number;
  live_median: number | null;
  multiple: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The model's arithmetic for one row, as the detail view shows it. */
export interface RowModel {
  category_multiple: number;
  category_comps: number;
  base_value_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  age_days: number | null;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: RowModel;
  plan_capital_usd: number;
  plan_fees_usd: number;
  plan_weeks: number;
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row, its farm plan in structured steps. */
export interface RadarRow extends BoardRow {
  steps: FarmStep[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median_multiple: number;
  calibration: CategoryCal[];
  comps_size: number;
  scanned_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are products of a token that already trades, per the watchlist's own rule. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a product may begin with, per the watchlist's own rule. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is a wrapped, staked, bridged or versioned product of one whose token trades. */
export function isProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  const words = p.name.toLowerCase().split(/[^a-z]+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** Whether a protocol is one the board may rank: it records no token and is no token's product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isProduct(p);
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The calibration: what the market pays per TVL dollar in each category, read off the snapshot's own
 * live-token protocols. Categories with few comps are shrunk toward the global median, so one wild
 * comp cannot set a category's price; the multiple is clamped to a sane band either way.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): { globalMedian: number; table: CategoryCal[]; byCategory: Map<string, CategoryCal>; comps: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const table: CategoryCal[] = [];
  const byCategory = new Map<string, CategoryCal>();
  for (const [category, list] of ratios) {
    const med = median(list);
    const shrunk = (list.length * med + model.shrink_weight * globalMedian) / (list.length + model.shrink_weight);
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk));
    const cal: CategoryCal = { category, comps: list.length, live_median: round4(med), multiple: round4(multiple) };
    table.push(cal);
    byCategory.set(category, cal);
  }
  table.sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  return { globalMedian: round4(globalMedian), table, byCategory, comps: all.length };
}

/** The four multipliers and the implied value one protocol gets under `model` and `calibration`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibration: { globalMedian: number; byCategory: Map<string, CategoryCal> },
): { implied: number; rowModel: RowModel } {
  const cal = calibration.byCategory.get(protocol.category ?? 'Uncategorised');
  const multiple = cal === undefined ? calibration.globalMedian : cal.multiple;
  const comps = cal === undefined ? 0 : cal.comps;
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = protocol.change_7d ?? 0;
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_base + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const reachMult = 1 + model.reach_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.reach_max_extra_chains);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * reachMult));
  return {
    implied,
    rowModel: {
      category_multiple: multiple,
      category_comps: comps,
      base_value_usd: Math.round(base),
      growth_pct: round2(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      reach_multiplier: round4(reachMult),
      age_days: age,
    },
  };
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A rough gas budget for one transaction on a chain, in dollars: the figure the plan quotes. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 4;
  if (chain === 'Solana') return 0.05;
  if (chain === 'Bitcoin') return 1.5;
  return 0.4;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category playbook: the core position and the second action that points systems usually count. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      core: `Supply $${capital} of USDC as collateral to ${name} on ${chain}.`,
      second: `Borrow about $${Math.round(capital * 0.4)} of USDC against the position and re-supply it once, so both the supply and the borrow side of ${name} record your wallet.`,
      weekly: 'Repay and re-borrow a small amount, or top the collateral up by $10.',
    };
  if (c.includes('dex') || c.includes('leveraged farm'))
    return {
      core: `Provide $${capital} split evenly between ETH and USDC to ${name}'s busiest pool on ${chain}.`,
      second: `Make two swaps of about $${Math.round(capital * 0.2)} each through ${name}'s own interface, so the wallet carries trade volume as well as liquidity.`,
      weekly: 'Rebalance the position once, or add $10 of liquidity.',
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager'))
    return {
      core: `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the wallet.`,
      second: `Split a second $${Math.round(capital * 0.5)} across a second ${name} vault on another chain it curates, if it lists one, so the wallet is active in two of its markets.`,
      weekly: 'Move $10 between vaults, or claim and re-deposit any rewards shown.',
    };
  if (c.includes('rwa'))
    return {
      core: `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the wallet.`,
      second: `Use the minted asset where ${name} lists it as accepted (a lending market or a second vault) with about $${Math.round(capital * 0.3)}, so the wallet shows both a mint and a use.`,
      weekly: 'Mint or redeem a token amount of $10 to keep the wallet current.',
    };
  if (c.includes('basis') || c.includes('cede') || c.includes('yield'))
    return {
      core: `Deposit $${capital} of USDC into ${name}'s main strategy on ${chain} and keep the receipt token.`,
      second: `Stake the receipt token in ${name}'s staking or points contract if it offers one, which is the step most farmers skip.`,
      weekly: 'Add $10 to the position, or claim and restake any points shown.',
    };
  if (c.includes('derivative') || c.includes('perpetual'))
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position (long and short the same size).`,
      second: `Close and reopen the hedge once a week so the wallet builds trade count without directional risk.`,
      weekly: 'Trade about $50 of volume in one hedged pair.',
    };
  if (c.includes('insurance'))
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} for a protocol you actually use, and keep the policy NFT.`,
      second: `Stake $${Math.round(capital * 0.5)} into ${name}'s capital pool as well, so the wallet appears on both the buyer and the underwriter side.`,
      weekly: 'Renew or extend the cover once before it lapses.',
    };
  if (c.includes('staking') || c.includes('restak'))
    return {
      core: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`,
      second: `Restake or delegate the receipt where ${name} offers it, rather than leaving it idle in the wallet.`,
      weekly: 'Claim rewards and restake them once.',
    };
  if (c.includes('chain') || c.includes('payment'))
    return {
      core: `Bridge $${capital} of USDC to ${chain} and hold it in a wallet on ${name}'s network.`,
      second: `Make two small payments or transfers between your own wallets on the network, so the wallet has native activity, not just a bridge-in.`,
      weekly: 'Make one transfer of about $5 on the network.',
    };
  if (c.includes('stable') || c.includes('wrapper'))
    return {
      core: `Mint $${capital} of ${name}'s stable asset on ${chain} from USDC and hold it.`,
      second: `Deposit about $${Math.round(capital * 0.4)} of the minted asset into a market that accepts it, so the wallet shows the asset in use.`,
      weekly: 'Mint or redeem about $10 to keep the position current.',
    };
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `Repeat the deposit with a second $${Math.round(capital * 0.5)} after the first week, so the wallet's activity spans more than one snapshot.`,
    weekly: 'Make one deposit, withdrawal or claim of about $10.',
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A protocol's farm plan: seven steps with a cost and a time each, plus the plan's totals. */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: FarmStep[]; capital: number; fees: number; weeks: number } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const gasText = gas < 0.1 ? 'under $0.10' : gas < 1 ? 'about $0.40' : `about $${gas.toFixed(gas % 1 === 0 ? 0 : 2)}`;
  const play = playbook(p, capital, chain);
  const weeks = Math.max(4, Math.round(hold / 7));
  const fees = Math.round((gas * (4 + weeks) + weeks * gas) * 100) / 100;
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet for ${p.name} alone, fund it from an exchange (never from a wallet you farm other protocols with), and keep the seed phrase offline.`,
      cost: `${gasText} of gas for the first funding transaction`,
      time: '10 minutes',
    },
    {
      text: play.core,
      cost: `$${capital} of capital, plus ${gasText} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: play.second,
      cost: `${gasText} of gas, no new capital beyond the amounts named`,
      time: '10 minutes',
    },
    {
      text: `Repeat a small qualifying action every week: ${play.weekly}`,
      cost: `${gasText} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days without emptying it, so the wallet appears in several weekly snapshots of ${p.name}'s TVL rather than one.`,
      cost: `the $${capital} stays in the position for the whole period`,
      time: `${hold} days`,
    },
    {
      text: `Each month, open ${p.name}'s own points or rewards page from the link in its app and screenshot your balance; never follow a claim link from a message or a search ad.`,
      cost: 'nothing to check; never pay a fee to claim',
      time: '5 minutes a month',
    },
    {
      text: `Keep a farm log (wallet, dates, transaction hashes, amounts) and, when you decide to leave, unwind in two withdrawals a week apart so the exit does not read as a one-day farm.`,
      cost: `${gasText} of gas for each withdrawal`,
      time: '10 minutes, twice',
    },
  ];
  return { steps, capital, fees, weeks };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { rows: RadarRow[]; calibration: { globalMedian: number; table: CategoryCal[]; comps: number } } {
  const calibration = calibrate(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const { implied, rowModel } = impliedValue(p, snapshot.as_of, model, calibration);
    const plan = farmPlan(p, rowModel.age_days);
    return { p, implied, rowModel, plan };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.rowModel.age_days,
    implied_value_usd: s.implied,
    model: s.rowModel,
    plan_capital_usd: s.plan.capital,
    plan_fees_usd: s.plan.fees,
    plan_weeks: s.plan.weeks,
    farm_steps: s.plan.steps.map(stepText),
    steps: s.plan.steps,
  }));
  return { rows, calibration };
}

/** The live-token protocols, by market cap, for the dashboard's Live view: the calibration set. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { rows, calibration } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const board: BoardRow[] = rows.map(({ steps, ...rest }) => rest);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median_multiple: calibration.globalMedian,
    calibration: calibration.table,
    comps_size: calibration.comps,
    scanned_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: rows.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
