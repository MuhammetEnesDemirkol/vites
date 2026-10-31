import type { Line } from '../types'
import { LINES, lineOf } from './logic'

// Where a request came from: the main loop, a subagent, or Vites' own classifier call.
export type UsageSource = 'main' | 'subagent' | 'classifier'

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

type RowKey = `${UsageSource}:${Line}`

// One local day: the line the person had before Vites (what the main loop would have run on), and the token totals per source and line.
export type DayUsage = { baseline: Line; rows: Partial<Record<RowKey, Tokens>> }

// Keyed by local 'YYYY-MM-DD'. Totals only; single requests are not kept.
export type UsageBook = Record<string, DayUsage>

const SOURCES: readonly UsageSource[] = ['main', 'subagent', 'classifier']

// The book's keys are local days as localDay() writes them, so they sort in date order.
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The day in local time, as 'YYYY-MM-DD'. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function isZero(tokens: Tokens): boolean {
  return tokens.input === 0 && tokens.output === 0 && tokens.cacheRead === 0 && tokens.cacheWrite === 0
}

/** The engine's usage object as Tokens; undefined when it is missing, not an object, or counts nothing. */
export function tokensFrom(usage: unknown): Tokens | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const raw = usage as Record<string, unknown>
  const tokens: Tokens = {
    input: count(raw.input_tokens),
    output: count(raw.output_tokens),
    cacheRead: count(raw.cache_read_input_tokens),
    cacheWrite: count(raw.cache_creation_input_tokens),
  }

  return isZero(tokens) ? undefined : tokens
}

/** The line the person's earlier model is on; opus when it names none (such as "Default"). */
export function baselineLine(previous: unknown): Line {
  return (typeof previous === 'string' ? lineOf(previous) : undefined) ?? 'opus'
}

function add(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

/**
 * A new book with the tokens added to the day's row for the source and line.
 * The baseline is set only when the day is created, so the first value of the day stands.
 */
export function addUsage(book: UsageBook, day: string, source: UsageSource, line: Line, tokens: Tokens, baseline: Line): UsageBook {
  const key: RowKey = `${source}:${line}`
  const current = book[day] ?? { baseline, rows: {} }
  const existing = current.rows[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  return {
    ...book,
    [day]: { baseline: current.baseline, rows: { ...current.rows, [key]: add(existing, tokens) } },
  }
}

function isTokens(value: unknown): value is Tokens {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>

  return ['input', 'output', 'cacheRead', 'cacheWrite'].every(field => typeof item[field] === 'number' && Number.isFinite(item[field]))
}

function isRowKey(key: string): key is RowKey {
  const [source, line] = key.split(':')

  return SOURCES.includes(source as UsageSource) && LINES.includes(line as Line)
}

function readDay(value: unknown): DayUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const day = value as Record<string, unknown>
  if (!LINES.includes(day.baseline as Line)) return undefined
  if (typeof day.rows !== 'object' || day.rows === null || Array.isArray(day.rows)) return undefined

  const rows: DayUsage['rows'] = {}
  for (const [key, tokens] of Object.entries(day.rows as Record<string, unknown>)) {
    if (isRowKey(key) && isTokens(tokens)) rows[key] = tokens
  }

  return { baseline: day.baseline as Line, rows }
}

/** The book from the store: only the days that have the full shape, nothing when the value is not an object. */
export function readUsage(value: unknown): UsageBook {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  const book: UsageBook = {}
  for (const [day, data] of Object.entries(value as Record<string, unknown>)) {
    const read = DAY_KEY.test(day) ? readDay(data) : undefined
    if (read !== undefined) book[day] = read
  }

  return book
}
