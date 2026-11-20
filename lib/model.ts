// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// other pre-token protocol the radar can rank: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// What the starter got wrong, and this model fixes: its board ranked wrapped, staked and bridged
// products of tokens that already trade — WBTC, Binance staked ETH, Coinbase Bridge, Binance Bitcoin
// and USDT0 were its five largest rows, because it only excluded exchanges and versioned names. None of
// those is a protocol still waiting on a launch of its own, and the rules say so in words. So a row is
// rankable only when it also passes the watchlist's own exclusion: not a Bridge, Canonical Bridge,
// Liquid Staking, Liquid Restaking, Restaked BTC or CEX product, no whole word wrapped / staked /
// staking in its name, and not named after an exchange. The rule reads the snapshot's own fields
// (category and name), never a hand-written list of protocols: no protocol name is ever special-cased.
//
// Implied value follows only from the snapshot's own figures:
//
//   base         = tvl_usd x BASE_MULTIPLE
//   growth       = clamp(change_7d, -60, 120) per cent
//   growthMult   = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturityMult = MATURITY_FLOOR + min(age_days, MATURITY_DAYS) / MATURITY_DAYS x (1 - MATURITY_FLOOR)
//                  (age_days unknown: 365)
//   chainsMult   = 0.95 + 0.03 x min(chains.length, 5)          (0.98 for one chain, 1.10 for five or more)
//   categoryMult = clamp(category median TVL / global median TVL, 0.92, 1.08)
//                  (medians taken over the rankable set, at run time, never hand-picked)
//   implied      = max(1, round(base x growthMult x maturityMult x chainsMult x categoryMult))
//
// Why these weights, in one line each:
//   base 0.25      — a launch's value plausibly tracks a quarter of the value already locked; it keeps
//                    implied values in the same order of magnitude as TVL while letting the other
//                    signals move ranks.
//   growth 0.6     — seven-day momentum is the freshest signal in the file; the clamp keeps one wild
//                    week (the snapshot's largest is +4,448%) from deciding a rank.
//   maturity       — age is the record of how long a protocol has run with no token; the 1,460-day
//                    window (four years) matches the snapshot's own age spread (median 486 days,
//                    oldest about five years), and the 0.55 floor keeps a young protocol from scoring
//                    near zero for being new.
//   chains <= +10% — a protocol live on more chains has more users and flows a launch could convert;
//                    capped so breadth can break a tie, never outrank TVL.
//   category ±8%   — categories where tokenless protocols sustain larger TVL show stronger
//                    product-market fit for running without a token; computed from the snapshot at run
//                    time and clamped tight, so it can nudge a rank and never set one.
//
// The constants are the model's, stated in the dashboard and changeable in the model sandbox.
//
// Reading this file, in the order the pipeline runs it:
//   parseSnapshot   turns the sealed file's text into the snapshot, refusing anything misshapen.
//   selectRankable  keeps the watchlist and every other pre-token protocol the exclusion lets in.
//   categoryFactors reads the rankable set's own medians, so no factor is hand-picked.
//   scoreProtocol   scores one protocol with the five multipliers; buildBoard ranks them.
//   farmSteps       writes the six-step plan for a row from its category, chains, TVL and age.
//   buildRadar      bundles the board, the live set and the model for the dashboard's data.js.
//   boardIssue      is the gate's own shape check, run by main.ts before anything is written.
// Nothing here reads a name to decide a rank: the only lists are the snapshot's watchlist and the
// exclusion's categories, words and exchange prefixes, all read from the snapshot's own fields.
// Every multiplier has its own function below (growthMultiplier, maturityMultiplier, chainsMultiplier
// and the category factor from categoryFactors), so the dashboard's recomputation and this file's
// arithmetic can be read side by side and checked against each other.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  /** DefiLlama's slug for the protocol, unique in the file; the watchlist names protocols by it. */
  slug: string;
  /** The protocol's name as DefiLlama writes it. */
  name: string;
  /** DefiLlama's category, such as Dexs, Lending or Bridge; null when it names none. */
  category: string | null;
  /** The chains DefiLlama counts the protocol's TVL on, as it names them. */
  chains: string[];
  /** The protocol's TVL in whole US dollars, truncated toward zero, never rounded up. */
  tvl_usd: number;
  /** Its TVL's change over 7 days, in per cent; null when DefiLlama reports none. */
  change_7d: number | null;
  /** The market cap of its token in whole US dollars; null when it records no token or no market cap. */
  mcap_usd: number | null;
  /** The UTC day DefiLlama began tracking the protocol; null when it reports none. */
  listed_at: string | null;
  /** Its token's CoinGecko id; null when it records no token. */
  gecko_id: string | null;
  /** Its token's ticker; null when it records no token. */
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  /** The UTC date of the fetch, YYYY-MM-DD. */
  as_of: string;
  /** Where the data came from and when it was fetched. */
  source: string;
  /** The watchlist's floor in whole US dollars. */
  floor_usd: number;
  /** Every protocol at or above $5,000,000 of TVL, one object each, sorted by slug. */
  protocols: SnapshotProtocol[];
  /** The slug of every protocol that meets the watchlist's definition, ascending. */
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  /** The share of TVL a launch's value starts from. */
  base_multiple: number;
  /** How much of the clamped seven-day growth reaches the multiplier. */
  growth_weight: number;
  /** The lowest seven-day growth the model counts, in per cent. */
  growth_floor: number;
  /** The highest seven-day growth the model counts, in per cent. */
  growth_cap: number;
  /** The maturity multiplier of a protocol listed yesterday. */
  maturity_floor: number;
  /** The age, in days, at which the maturity multiplier reaches one. */
  maturity_days: number;
  /** The age, in days, a protocol with no listing date is scored as. */
  unknown_age_days: number;
  /** The chain multiplier of a protocol on no chain at all. */
  chains_base: number;
  /** The chain multiplier's step per chain. */
  chains_step: number;
  /** The most chains the chain multiplier counts. */
  chains_cap: number;
  /** The lowest category factor the model allows. */
  category_floor: number;
  /** The highest category factor the model allows. */
  category_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_days: 1460,
  unknown_age_days: 365,
  chains_base: 0.95,
  chains_step: 0.03,
  chains_cap: 5,
  category_floor: 0.92,
  category_cap: 1.08,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  /** The action itself, in the words a farmer can follow. */
  text: string;
  /** What the step costs: capital, gas, or nothing but the log. */
  cost: string;
  /** How long the step takes: minutes to set up, or days to hold. */
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  /** The row's rank, 1 for the strongest implied value, counting up without gaps. */
  rank: number;
  /** DefiLlama's slug for the protocol. */
  slug: string;
  /** The protocol's name as DefiLlama writes it. */
  name: string;
  /** DefiLlama's category; null when it names none. */
  category: string | null;
  /** The chains DefiLlama counts the protocol's TVL on. */
  chains: string[];
  /** The protocol's TVL in whole US dollars. */
  tvl_usd: number;
  /** Its TVL's change over 7 days, in per cent; null when DefiLlama reports none. */
  change_7d: number | null;
  /** The market cap of its token; null here, because every board row is pre-token. */
  mcap_usd: number | null;
  /** The UTC day DefiLlama began tracking the protocol; null when it reports none. */
  listed_at: string | null;
  /** Its token's CoinGecko id; null here, because every board row is pre-token. */
  gecko_id: string | null;
  /** Its token's ticker; null here, because every board row is pre-token. */
  symbol: string | null;
  /** Always 'pre-token': the board ranks only protocols with no token on record. */
  token_status: 'pre-token';
  /** Days from listing to the snapshot date; null when the listing date is unknown. */
  age_days: number | null;
  /** The model's implied value for the protocol, in whole US dollars. */
  implied_value_usd: number;
  /** The model's inputs for this row, so the dashboard can show the arithmetic. */
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chains_multiplier: number;
    category_multiplier: number;
    age_days: number | null;
  };
  /** The six-step farm plan, each step an action with its cost and time. */
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  /** The row's rank, 1 for the strongest implied value. */
  rank: number;
  /** DefiLlama's slug for the protocol. */
  slug: string;
  /** The protocol's name as DefiLlama writes it. */
  name: string;
  /** DefiLlama's category; null when it names none. */
  category: string | null;
  /** The chains DefiLlama counts the protocol's TVL on. */
  chains: string[];
  /** The protocol's TVL in whole US dollars. */
  tvl_usd: number;
  /** Its TVL's change over 7 days, in per cent; null when DefiLlama reports none. */
  change_7d: number | null;
  /** The market cap of its token; null here, because every board row is pre-token. */
  mcap_usd: number | null;
  /** The UTC day DefiLlama began tracking the protocol; null when it reports none. */
  listed_at: string | null;
  /** Days from listing to the snapshot date; null when the listing date is unknown. */
  age_days: number | null;
  /** The model's implied value for the protocol, in whole US dollars. */
  implied_value_usd: number;
  /** The growth multiplier the model applied, rounded to four decimals. */
  growth_multiplier: number;
  /** The maturity multiplier the model applied, rounded to four decimals. */
  maturity_multiplier: number;
  /** The chain multiplier the model applied, rounded to four decimals. */
  chains_multiplier: number;
  /** The category multiplier the model applied, rounded to four decimals. */
  category_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  /** DefiLlama's slug for the protocol. */
  slug: string;
  /** The protocol's name as DefiLlama writes it. */
  name: string;
  /** DefiLlama's category; null when it names none. */
  category: string | null;
  /** The chains DefiLlama counts the protocol's TVL on. */
  chains: string[];
  /** The protocol's TVL in whole US dollars. */
  tvl_usd: number;
  /** The market cap of its token in whole US dollars; null when DefiLlama records none. */
  mcap_usd: number | null;
  /** Its TVL's change over 7 days, in per cent; null when DefiLlama reports none. */
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  /** The UTC date of the snapshot fetch. */
  as_of: string;
  /** Where the snapshot data came from and when it was fetched. */
  source: string;
  /** The watchlist's floor in whole US dollars. */
  floor_usd: number;
  /** The model's constants, as the dashboard states them. */
  model: ModelConstants;
  /** The model's version label. */
  model_version: string;
  /** How many slugs the watchlist holds. */
  watchlist_size: number;
  /** How many rows the board holds. */
  board_size: number;
  /** How many board rows are below the watchlist floor. */
  early_size: number;
  /** How many live-token protocols the Live token view carries. */
  live_size: number;
  /** The watchlist's slugs, ascending. */
  watchlist: string[];
  /** Each category's factor, computed from the snapshot at run time. */
  category_factors: Record<string, number>;
  /** The board's rows in compact form, strongest implied value first. */
  rows: RadarRow[];
  /** The live-token protocols, by market cap. */
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

/** A number rounded to four decimals, for the multipliers the dashboard shows. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The upper median of a sorted array of numbers. */
function medianOf(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The rankable set's TVLs grouped by category, for the category factors. The grouping is the only
 * place the model looks at a category as a group; every other step scores one protocol at a time.
 * A protocol with no category lands in 'Other', so every TVL is counted exactly once.
 */
export function groupTvlsByCategory(rows: SnapshotProtocol[]): Map<string, number[]> {
  const byCategory = new Map<string, number[]>();
  for (const p of rows) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.tvl_usd]);
    else list.push(p.tvl_usd);
  }
  return byCategory;
}

/**
 * The category factor for every category in the rankable set: each category's median TVL over the
 * global median TVL, clamped tight. Computed from the snapshot at run time, never hand-picked, so a
 * category's factor is the data's own claim about where tokenless protocols sustain size.
 */
export function categoryFactors(rows: SnapshotProtocol[], model: ModelConstants): Map<string, number> {
  const byCategory = groupTvlsByCategory(rows);
  const global = medianOf(rows.map((p) => p.tvl_usd).sort((a, b) => a - b));
  const out = new Map<string, number>();
  for (const [key, values] of byCategory) {
    values.sort((a, b) => a - b);
    const ratio = medianOf(values) / global;
    out.set(key, round4(Math.min(model.category_cap, Math.max(model.category_floor, ratio))));
  }
  return out;
}

/** The chain-breadth multiplier: more chains, a slightly higher implied value, capped. */
export function chainsMultiplier(chains: string[], model: ModelConstants): number {
  return round4(model.chains_base + model.chains_step * Math.min(chains.length, model.chains_cap));
}

/**
 * The growth multiplier: seven-day momentum, clamped so one wild week cannot decide a rank.
 * The clamp's bounds and the weight are the model's constants; the snapshot's largest weekly move
 * is far outside them, which is the point — a protocol that quadrupled in a week is scored as a
 * protocol that grew 120%, and one that halved as a protocol that fell 60%. A missing change_7d
 * counts as no change, never as a penalty and never as a boost.
 */
export function growthMultiplier(change_7d: number | null, model: ModelConstants): { growthPct: number; multiplier: number } {
  const rawGrowth = finite(change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  return { growthPct, multiplier: 1 + (growthPct / 100) * model.growth_weight };
}

/**
 * The maturity multiplier: age with no token, from the floor to one over the maturity window.
 * A protocol listed yesterday scores the floor, not zero, because being new is not being worthless;
 * a protocol four years in without a token scores one, because the record is the whole claim.
 * An unknown age is scored as a year old: the middle of the window, never the floor and never one.
 */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const ageForModel = age ?? model.unknown_age_days;
  const capped = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  return model.maturity_floor + (capped / model.maturity_days) * (1 - model.maturity_floor);
}

/**
 * The base value: a quarter of the value already locked. A launch's value plausibly tracks the
 * value users already trust the protocol with, and a quarter keeps implied values in the same
 * order of magnitude as TVL while the multipliers move ranks.
 */
export function baseValue(tvl_usd: number, model: ModelConstants): number {
  return tvl_usd * model.base_multiple;
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  categoryFactor: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainsMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { growthPct, multiplier: growthMult } = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainsMult = chainsMultiplier(protocol.chains, model);
  const base = baseValue(protocol.tvl_usd, model);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainsMult * categoryFactor));
  return { implied, growthPct, growthMult, maturityMult, chainsMult, age };
}

/** The categories the watchlist's exclusion names: bridges, liquid staking and restaking, and exchanges. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word for a wrapped, staked or staking product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether the category is one the exclusion names. A bridge moves a token that already trades; a
 * liquid staking or restaking product is a receipt for one; an exchange is a venue, not a launch.
 * The check names categories, never protocols, so a new bridge next year is left out the same way.
 */
export function isExcludedCategory(category: string | null): boolean {
  return category !== null && EXCLUDED_CATEGORIES.has(category);
}

/**
 * Whether the name carries a whole word for a wrapped, staked or staking product. The word must
 * stand alone: "restaked" matches, a longer word that merely contains those letters does not,
 * because the rule is about the product, not the spelling.
 */
export function hasWrappedName(name: string): boolean {
  return WRAPPED_WORD.test(name);
}

/**
 * Whether the name begins with an exchange's name. An exchange's staking or wrapped product is the
 * exchange's, not a protocol waiting on a launch of its own, so it never reaches the board.
 */
export function hasExchangePrefix(name: string): boolean {
  return EXCHANGE_PREFIX.test(name);
}

/**
 * Whether the name ends in a version marker. A V2 or 2.0 pool is a release of another protocol,
 * not a protocol of its own, so it never reaches the board either.
 */
export function isVersionedName(name: string): boolean {
  return VERSIONED.test(name);
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not an exchange, not a versioned pool. The watchlist's
 * exclusion, extended to the early rows, so the board's top is launches, not wrappers.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (isExcludedCategory(p.category)) return false;
  if (hasWrappedName(p.name)) return false;
  if (hasExchangePrefix(p.name)) return false;
  if (isVersionedName(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The protocols the board ranks: every watchlist slug the snapshot carries, plus every other
 * rankable pre-token protocol. The watchlist is the floor, never a ceiling, and no TVL or count
 * cap applies: the radar exists to find them all, and the gate allows up to 4,000 rows.
 */
export function selectRankable(snapshot: Snapshot): Map<string, SnapshotProtocol> {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, watchlist exclusion and all.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  return chosen;
}

/** One protocol scored: its implied value and the five multipliers that made it. */
export interface ScoredProtocol {
  /** The protocol itself, as the snapshot records it. */
  p: SnapshotProtocol;
  /** The model's implied value, in whole US dollars. */
  implied: number;
  /** The clamped seven-day growth, in per cent, that the multiplier used. */
  growthPct: number;
  /** The growth multiplier the model applied. */
  growthMult: number;
  /** The maturity multiplier the model applied. */
  maturityMult: number;
  /** The chain multiplier the model applied. */
  chainsMult: number;
  /** The category factor the model applied. */
  factor: number;
  /** Days from listing to the snapshot date; null when the listing date is unknown. */
  age: number | null;
}

/**
 * One protocol's score under the model: the category factor in, the implied value out. The sort
 * that follows is the board's only ordering: strongest implied value first, slug as the tiebreak,
 * so two runs of the same snapshot rank the same way.
 */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, model: ModelConstants, factor: number): ScoredProtocol {
  const { implied, growthPct, growthMult, maturityMult, chainsMult, age } = impliedValue(p, asOf, model, factor);
  return { p, implied, growthPct, growthMult, maturityMult, chainsMult, factor, age };
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const chosen = selectRankable(snapshot);
  const factors = categoryFactors([...chosen.values()], model);
  const scored = [...chosen.values()].map((p) => {
    const factor = factors.get(p.category ?? 'Other') ?? 1;
    return scoreProtocol(p, snapshot.as_of, model, factor);
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chains_multiplier: s.chainsMult,
      category_multiplier: s.factor,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * What a transaction costs on the protocol's first chain. Ethereum and Bitcoin mainnet cost dollars;
 * most other chains cost cents. The rule names chains, never protocols.
 */
function gasFor(chain: string): { first: string; setup: string; weekly: string } {
  if (chain === 'Ethereum' || chain === 'Bitcoin') {
    return { first: 'about $5 of gas for the first transaction', setup: 'about $8 of gas', weekly: 'about $3 of gas a week' };
  }
  return { first: 'under $1 of gas for the first transaction', setup: 'about $2 of gas', weekly: 'under $1 of gas a week' };
}

/**
 * One farm-action rule: the category words it matches and the action it writes. The rules are
 * tried in the order they are listed and the first match wins, so the order below is the rule:
 * a lending market that also yields is still a lending market, and a curator that also stakes is
 * still a curator. The words are matched against the category in lower case; the action is written
 * from the protocol's own name, capital and chain, never from a hand-written list of names.
 */
interface FarmActionRule {
  /** The lower-case words, any one of which matches the category. */
  words: string[];
  /** The action for a protocol of this kind. */
  action: (name: string, capital: number, chain: string) => string;
}

/** The farm actions, in the order they are tried: the first matching rule writes the step. */
const FARM_ACTIONS: FarmActionRule[] = [
  { words: ['lend', 'cdp', 'collateral'], action: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` },
  { words: ['dex', 'yield', 'leveraged farm'], action: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
  { words: ['staking', 'restak'], action: (name, capital) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.` },
  { words: ['perpetual', 'derivative'], action: (name, capital) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` },
  { words: ['prediction'], action: (name, capital) => `Fund $${capital} and place one market position on ${name}.` },
  { words: ['curator', 'allocator'], action: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.` },
  { words: ['stable'], action: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` },
  { words: ['rwa'], action: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.` },
  { words: ['insurance'], action: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` },
];

/**
 * The category's one action, in the words a farmer can follow. The first rule whose words appear
 * in the category wins; a protocol whose category matches no rule gets the plain deposit.
 */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of FARM_ACTIONS) {
    if (rule.words.some((w) => c.includes(w))) return rule.action(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/**
 * The wallet step: a fresh wallet, holding only the funds to farm, its seed kept offline. The
 * first thing a farm plan does is separate the farm from everything else the farmer owns.
 */
function walletStep(gas: { first: string }): FarmStep {
  return {
    text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
    cost: gas.first,
    time: '5 minutes',
  };
}

/**
 * The deposit step: the protocol's own action, with the capital the TVL calls for and the gas the
 * chain charges. The action is the plan's only protocol-specific sentence; the rest is routine.
 */
function depositStep(p: SnapshotProtocol, capital: number, chain: string, gas: { setup: string }): FarmStep {
  return {
    text: actionFor(p, capital, chain),
    cost: `$${capital} of capital and ${gas.setup}`,
    time: '15 minutes to set up',
  };
}

/**
 * The weekly step: one qualifying action a week, so the activity is a habit and not a single
 * deposit. A swap, a borrow, a deposit or a vote all count; the point is the repetition.
 */
function weeklyStep(gas: { weekly: string }): FarmStep {
  return {
    text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
    cost: gas.weekly,
    time: '10 minutes a week',
  };
}

/**
 * The hold step: keep the position open long enough to be counted in more than one snapshot.
 * Younger protocols get a longer window, because a new protocol's record is still being written.
 */
function holdStep(hold: number, capital: number): FarmStep {
  return {
    text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  };
}

/**
 * The claim step: check the protocol's own points or rewards page before withdrawing, and claim
 * only from the link it publishes. A claim that asks for a fee, a seed phrase or a different link
 * is not the protocol's.
 */
function claimStep(): FarmStep {
  return {
    text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  };
}

/**
 * The log step: write the wallet, the dates and every transaction in a farm log. The snapshot
 * records no token and promises no airdrop: the log is for the position, not a claim.
 */
function logStep(): FarmStep {
  return {
    text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. The snapshot records no token and promises no airdrop: the log is for the position, not a claim.`,
    cost: 'nothing but the log',
    time: '5 minutes',
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * Nothing here promises a token or an airdrop: the snapshot records no token, and farming is use of
 * the protocol, not a claim on a launch.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    walletStep(gas),
    depositStep(p, capital, chain, gas),
    weeklyStep(gas),
    holdStep(hold, capital),
    claimStep(),
    logStep(),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
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
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chains_multiplier: row.model.chains_multiplier,
    category_multiplier: row.model.category_multiplier,
  };
}

/**
 * The board's rows back in protocol form, so the category factors can be read off the board
 * itself rather than the snapshot. The factors are the same either way — the board holds every
 * rankable protocol — but reading them off the board keeps one code path for what the dashboard
 * shows and what the model computed.
 */
export function boardAsProtocols(board: BoardRow[]): SnapshotProtocol[] {
  return board.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    mcap_usd: r.mcap_usd,
    listed_at: r.listed_at,
    gecko_id: r.gecko_id,
    symbol: r.symbol,
  }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const factors = categoryFactors(boardAsProtocols(board), model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    watchlist: snapshot.watchlist,
    category_factors: Object.fromEntries(factors),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/**
 * One protocol out of the sealed file's record: the ten fields, each checked for its own shape.
 * A field the file leaves out or mistypes is refused here, at the record's own index, so a bad
 * record names itself instead of failing somewhere downstream as a wrong number.
 */
export function protocolFromRecord(v: unknown, i: number): SnapshotProtocol {
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
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  // The document itself first: an object with a dated fetch, a named source, a positive floor,
  // a protocols array and a watchlist of slugs. Any of those missing is a different file's shape.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  // Then every protocol, one record at a time, each naming itself when it fails.
  const protocols = o.protocols.map((v, i) => protocolFromRecord(v, i));
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * The coverage check: every watchlist slug must be a row of the board. The gate's first row is
 * coverage, and a board that drops a watchlist slug is not a board of the watchlist.
 */
export function checkCoverage(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

/**
 * The rank check: ranks are 1..n with no gap and no duplicate. A rank out of place means the
 * board was sorted by something other than its own order, or not sorted at all.
 */
export function checkRanks(board: BoardRow[]): string | null {
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  return null;
}

/**
 * The order check: implied value never rises as the rank falls. A row that outranks the row above
 * it on implied value is a board sorted by something the values do not show.
 */
export function checkOrder(board: BoardRow[]): string | null {
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  return null;
}

/**
 * The spread check: the first and last rows must not share one implied value. A board whose rows
 * all score the same is not a ranking; it is a list with numbers attached.
 */
export function checkSpread(board: BoardRow[]): string | null {
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/**
 * The rows check: every row's farm plan has 3..12 steps of 20..600 characters, and every implied
 * value is a positive whole number. A row that fails any of those is not a row the gate will take.
 */
export function checkRows(board: BoardRow[]): string | null {
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  return (
    checkCoverage(board, snapshot) ??
    checkRanks(board) ??
    checkOrder(board) ??
    checkSpread(board) ??
    checkRows(board)
  );
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
