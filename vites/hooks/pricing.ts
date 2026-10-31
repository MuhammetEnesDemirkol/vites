import type { Line } from '../types'
import type { Tokens } from './usage'

// USD per million tokens. cacheWrite is the 5-minute cache write price, cacheRead the cache hit price.
export type Price = { input: number; output: number; cacheWrite: number; cacheRead: number }

// The day these prices were read.
export const PRICE_DATE = '2026-11-01'

/**
 * List prices for each line's latest model on the first-party Claude API.
 *
 * Source: the `claude-api` skill shipped with Claude Code 2.1.316 (SKILL.md "Current Models",
 * cached 2026-10-06; shared/models.md "Model Descriptions"; shared/prompt-caching.md "Economics";
 * shared/model-migration.md "Migrating to Claude Opus 5.5"). Not written from memory.
 *
 * Explicit in the skill: every input/output price; cache reads for sonnet ($0.20), opus ($0.20) and
 * fable ($0.25); the opus 5-minute cache write ($5).
 * Derived from the skill's rules, since it gives no per-line figure: cache writes for haiku, sonnet
 * and fable at 1.25x input (prompt-caching.md "Cache writes cost 1.25x for 5-minute TTL"); the haiku
 * cache read at 0.1x input (prompt-caching.md "Cache reads cost ~0.1x base input price").
 *
 * haiku is priced at its under-100K-token prompt rate; the skill lists $0.50 / $2.50 above that.
 */
export const PRICES: Record<Line, Price> = {
  // Claude Haiku 5.5
  haiku: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  // Claude Sonnet 5.5
  sonnet: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  // Claude Opus 5.5
  opus: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  // Claude Fable 5.1
  fable: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
}

const MILLION = 1_000_000

/** What the tokens cost in USD at the given price. */
export function cost(tokens: Tokens, price: Price): number {
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite) /
    MILLION
  )
}
