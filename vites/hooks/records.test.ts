import { describe, expect, test } from 'claude-code/testing'

import type { Line } from '../types'
import { JOURNAL_LIMIT, appendEntry, formatJournal, makeSnippet, parseCount, readJournal } from './journal'
import type { JournalEntry } from './journal'
import { PRICES, PRICE_DATE, cost } from './pricing'
import type { Price } from './pricing'
import { computeReport, daysOf, formatReport, parsePeriod } from './report'
import { addUsage, baselineLine, localDay, readUsage, tokensFrom } from './usage'
import type { UsageBook } from './usage'

function entry(at: string, model: string, gear: 1 | 2 | 3 | 4): JournalEntry {
  return {
    at,
    snippet: `prompt at ${at}`,
    source: 'classifier',
    rawLevel: 'strong',
    rawEffort: 'high',
    model,
    effort: 'high',
    gear,
    flags: [],
  }
}

// A flat table that makes the arithmetic in the report tests readable: each line costs a whole number per MTok.
const flat = (n: number): Price => ({ input: n, output: n, cacheWrite: n, cacheRead: n })
const FAKE_PRICES: Record<Line, Price> = { haiku: flat(1), sonnet: flat(2), opus: flat(4), fable: flat(8) }
const MILLION = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }

describe('journal snippets', () => {
  test('cuts at 120 characters with an ellipsis and collapses whitespace', async () => {
    const long = makeSnippet('a'.repeat(200))
    expect(long.length).toBe(120)
    expect(long.endsWith('…')).toBe(true)
    expect(makeSnippet('one\n\ntwo\t three')).toBe('one two three')
    expect(makeSnippet('  short  ')).toBe('short')
  })
})

describe('journal list', () => {
  test('keeps the newest 500, dropping the oldest', async () => {
    const full = Array.from({ length: JOURNAL_LIMIT }, (_, i) => entry(`2026-11-01T00:00:${String(i).padStart(2, '0')}`, 'opus', 3))
    const fresh = entry('2026-11-02T00:00:00', 'haiku', 1)
    const next = appendEntry(full, fresh)
    expect(next.length).toBe(JOURNAL_LIMIT)
    expect(next[0]).toBe(full[1])
    expect(next[next.length - 1]).toBe(fresh)
    expect(full.length).toBe(JOURNAL_LIMIT)
  })

  test('garbage in the store reads as an empty journal', async () => {
    expect(readJournal('x')).toEqual([])
    expect(readJournal([{}, 3])).toEqual([])
    expect(readJournal(undefined)).toEqual([])
    const good = entry('2026-11-01T10:00:00', 'opus', 3)
    expect(readJournal([good, { at: 1 }])).toEqual([good])
  })
})

describe('journal text', () => {
  test('empty journal says so', async () => {
    expect(formatJournal([], 10)).toBe('Günlükte henüz kayıt yok.')
  })

  test('newest first, limited to the count, each line naming gear, model and effort', async () => {
    const list = [
      entry('2026-11-01T10:00:00', 'haiku', 1),
      entry('2026-11-01T11:00:00', 'sonnet', 2),
      { ...entry('2026-11-01T12:00:00', 'opus', 3), effort: 'xhigh' as const, flags: ['capped' as const] },
    ]
    const lines = formatJournal(list, 2).split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain('3. vites')
    expect(lines[0]).toContain('opus')
    expect(lines[0]).toContain('çok yüksek')
    expect(lines[0]).toContain('tavana takıldı')
    expect(lines[1]).toContain('2. vites')
    expect(lines[1]).toContain('sonnet')
    expect(lines[1]).toContain('yüksek')
  })

  test('count argument defaults to 10 and clamps to the journal limit', async () => {
    expect(parseCount('')).toBe(10)
    expect(parseCount('5')).toBe(5)
    expect(parseCount('9999')).toBe(JOURNAL_LIMIT)
    expect(parseCount('abc')).toBe(10)
    expect(parseCount('0')).toBe(1)
  })
})

describe('usage tokens', () => {
  test('reads the engine usage shape, ignores null, garbage and all-zero', async () => {
    expect(tokensFrom(null)).toBeUndefined()
    expect(tokensFrom(undefined)).toBeUndefined()
    expect(tokensFrom('usage')).toBeUndefined()
    expect(tokensFrom({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBeUndefined()
    expect(tokensFrom({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }))
      .toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 0 })
    expect(tokensFrom({ input_tokens: 'ten', output_tokens: 5 })).toEqual({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 })
  })

  test('the baseline line comes from the previous model, opus when it names none', async () => {
    expect(baselineLine('Default (recommended)')).toBe('opus')
    expect(baselineLine('sonnet')).toBe('sonnet')
    expect(baselineLine('sonnet[1m]')).toBe('sonnet')
    expect(baselineLine(undefined)).toBe('opus')
  })

  test('local day is YYYY-MM-DD in local time', async () => {
    expect(localDay(new Date(2026, 10, 1, 0, 30))).toBe('2026-11-01')
    expect(localDay(new Date(2026, 0, 9, 23, 59))).toBe('2026-01-09')
  })
})

describe('usage book', () => {
  test('sums the same day, source and line; keeps the first baseline; leaves the input alone', async () => {
    const empty: UsageBook = {}
    const once = addUsage(empty, '2026-11-01', 'main', 'sonnet', { input: 10, output: 5, cacheRead: 100, cacheWrite: 1 }, 'opus')
    const twice = addUsage(once, '2026-11-01', 'main', 'sonnet', { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, 'sonnet')
    expect(twice['2026-11-01']?.rows['main:sonnet']).toEqual({ input: 11, output: 6, cacheRead: 101, cacheWrite: 2 })
    expect(twice['2026-11-01']?.baseline).toBe('opus')
    expect(empty).toEqual({})
    expect(once['2026-11-01']?.rows['main:sonnet']).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 1 })
    const other = addUsage(twice, '2026-11-01', 'subagent', 'haiku', MILLION, 'opus')
    expect(Object.keys(other['2026-11-01']?.rows ?? {}).sort()).toEqual(['main:sonnet', 'subagent:haiku'])
  })

  test('garbage in the store reads as an empty book, bad days are dropped', async () => {
    expect(readUsage('x')).toEqual({})
    expect(readUsage([1, 2])).toEqual({})
    expect(readUsage(null)).toEqual({})
    const good = { baseline: 'opus', rows: { 'main:sonnet': { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } } }
    expect(readUsage({ '2026-11-01': good, '2026-11-02': { baseline: 'nope', rows: {} }, '2026-11-03': 7, 'yesterday': good }))
      .toEqual({ '2026-11-01': good })
    expect(readUsage({ '2026-11-01': { baseline: 'opus', rows: { 'main:sonnet': 'x', 'bogus': MILLION } } }))
      .toEqual({ '2026-11-01': { baseline: 'opus', rows: {} } })
  })
})

describe('prices', () => {
  test('the table covers every line with a checked date and prices a token count per million', async () => {
    expect(PRICE_DATE).toBe('2026-11-01')
    for (const line of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
      const price = PRICES[line]
      expect(price.input > 0).toBe(true)
      expect(price.output > price.input).toBe(true)
      expect(price.cacheRead < price.input).toBe(true)
      expect(price.cacheWrite > price.input).toBe(true)
    }
    expect(cost({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, flat(2))).toBe(8)
    expect(cost({ input: 500_000, output: 0, cacheRead: 0, cacheWrite: 0 }, { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 })).toBe(2)
  })
})

describe('report numbers', () => {
  test('compares the real cost against the main loop priced at the baseline line', async () => {
    let book: UsageBook = {}
    book = addUsage(book, '2026-11-01', 'main', 'sonnet', MILLION, 'opus')
    book = addUsage(book, '2026-11-01', 'subagent', 'haiku', MILLION, 'opus')
    book = addUsage(book, '2026-11-01', 'classifier', 'haiku', MILLION, 'opus')
    const numbers = computeReport(book, ['2026-11-01'], FAKE_PRICES)
    expect(numbers.withVites).toBe(4)
    expect(numbers.without).toBe(5)
    expect(numbers.saved).toBe(1)
    expect(numbers.savedPercent).toBe(20)
    expect(numbers.baselines).toEqual(['opus'])
    expect(numbers.days).toBe(1)
    expect(numbers.byLine.sonnet).toEqual({ tokens: 1_000_000, cost: 2 })
    expect(numbers.byLine.haiku).toEqual({ tokens: 2_000_000, cost: 2 })
    expect(numbers.byLine.opus).toBeUndefined()
  })

  test('lists each baseline once, oldest day first, and only counts the days asked for', async () => {
    let book: UsageBook = {}
    book = addUsage(book, '2026-11-02', 'main', 'haiku', MILLION, 'sonnet')
    book = addUsage(book, '2026-11-01', 'main', 'haiku', MILLION, 'opus')
    book = addUsage(book, '2026-10-01', 'main', 'fable', MILLION, 'opus')
    expect(computeReport(book, 'all', FAKE_PRICES).baselines).toEqual(['opus', 'sonnet'])
    expect(computeReport(book, 'all', FAKE_PRICES).days).toBe(3)
    const two = computeReport(book, ['2026-11-01', '2026-11-02'], FAKE_PRICES)
    expect(two.withVites).toBe(2)
    expect(two.without).toBe(6)
    expect(two.days).toBe(2)
    expect(computeReport(book, ['2026-12-01'], FAKE_PRICES).days).toBe(0)
  })

  test('a negative saving is an extra cost, not hidden', async () => {
    const book = addUsage({}, '2026-11-01', 'main', 'fable', MILLION, 'haiku')
    const numbers = computeReport(book, 'all', FAKE_PRICES)
    expect(numbers.saved).toBe(-7)
    expect(numbers.savedPercent).toBe(-700)
  })
})

describe('report period', () => {
  test('reads Turkish period words through fold, empty means the week', async () => {
    expect(parsePeriod('Bugün')).toBe('bugun')
    expect(parsePeriod('tümü')).toBe('tumu')
    expect(parsePeriod('')).toBe('hafta')
    expect(parsePeriod('ay')).toBe('ay')
    expect(parsePeriod('HAFTA')).toBe('hafta')
    expect(parsePeriod('yarın')).toBeUndefined()
  })

  test('counts local days back from today', async () => {
    const week = daysOf('hafta', new Date(2026, 10, 1, 12))
    expect(week.length).toBe(7)
    expect(week[0]).toBe('2026-10-26')
    expect(week[6]).toBe('2026-11-01')
    expect(daysOf('bugun', new Date(2026, 10, 1))).toEqual(['2026-11-01'])
    expect(daysOf('ay', new Date(2026, 10, 1)).length).toBe(30)
    expect(daysOf('tumu', new Date(2026, 10, 1))).toBe('all')
  })
})

describe('report text', () => {
  test('names the period, both totals, the saving and the caveats', async () => {
    let book: UsageBook = {}
    book = addUsage(book, '2026-11-01', 'main', 'sonnet', MILLION, 'opus')
    book = addUsage(book, '2026-11-01', 'subagent', 'haiku', MILLION, 'opus')
    book = addUsage(book, '2026-11-01', 'classifier', 'haiku', MILLION, 'opus')
    const text = formatReport(computeReport(book, 'all', FAKE_PRICES), 'hafta', '2026-11-01')
    expect(text).toContain('son 7 gün')
    expect(text).toContain('$4.00')
    expect(text).toContain('$5.00')
    expect(text).toContain('$1.00')
    expect(text).toContain('%20')
    expect(text).toContain('2026-11-01')
    expect(text).toContain('API liste fiyatlarıyla tahmindir')
    expect(text).toContain('abonelik')
    expect(text).toContain('sonnet')
    expect(text).toContain('haiku')
  })

  test('names every baseline when the period has more than one', async () => {
    let book: UsageBook = {}
    book = addUsage(book, '2026-11-01', 'main', 'haiku', MILLION, 'opus')
    book = addUsage(book, '2026-11-02', 'main', 'haiku', MILLION, 'sonnet')
    const text = formatReport(computeReport(book, 'all', FAKE_PRICES), 'ay', '2026-11-01')
    expect(text).toContain('opus')
    expect(text).toContain('sonnet')
    expect(text).toContain('son 30 gün')
  })

  test('an extra cost is printed as such', async () => {
    const book = addUsage({}, '2026-11-01', 'main', 'fable', MILLION, 'haiku')
    const text = formatReport(computeReport(book, 'all', FAKE_PRICES), 'bugun', '2026-11-01')
    expect(text).toContain('Ek maliyet')
    expect(text).toContain('$7.00')
    expect(text).toContain('%700')
  })

  test('an empty book says there is nothing to report yet', async () => {
    const text = formatReport(computeReport({}, 'all', FAKE_PRICES), 'tumu', '2026-11-01')
    expect(text).toContain('henüz')
    expect(text).toContain('kayıt yok')
  })
})
