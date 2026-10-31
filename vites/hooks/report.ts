import type { Line } from '../types'
import { LINES, fold } from './logic'
import { PRICES, cost } from './pricing'
import type { Price } from './pricing'
import { localDay } from './usage'
import type { Tokens, UsageBook, UsageSource } from './usage'

export type Period = 'bugun' | 'hafta' | 'ay' | 'tumu'

const PERIOD_DAYS: Record<Exclude<Period, 'tumu'>, number> = { bugun: 1, hafta: 7, ay: 30 }

const PERIOD_LABEL: Record<Period, string> = {
  bugun: 'bugün',
  hafta: 'son 7 gün',
  ay: 'son 30 gün',
  tumu: 'tüm zamanlar',
}

/** The period after `/vites rapor`, read through fold: no word means the week; an unknown word is undefined. */
export function parsePeriod(arg: string): Period | undefined {
  switch (fold(arg).trim()) {
    case '':
    case 'hafta':
      return 'hafta'
    case 'bugun':
      return 'bugun'
    case 'ay':
      return 'ay'
    case 'tumu':
    case 'tum':
    case 'hepsi':
      return 'tumu'
    default:
      return undefined
  }
}

/** The local days the period covers, oldest first and ending today; 'all' for the whole book. */
export function daysOf(period: Period, today: Date): string[] | 'all' {
  if (period === 'tumu') return 'all'

  const count = PERIOD_DAYS[period]
  const days: string[] = []
  for (let back = count - 1; back >= 0; back--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
    days.push(localDay(date))
  }

  return days
}

export type ReportNumbers = {
  withVites: number
  without: number
  saved: number
  savedPercent: number
  byLine: Partial<Record<Line, { tokens: number; cost: number }>>
  // The Vites-side cost split by where the requests came from.
  bySource: Record<UsageSource, number>
  baselines: Line[]
  days: number
}

const SOURCE_LABEL: Record<UsageSource, string> = {
  main: 'ana döngü',
  subagent: 'alt ajanlar',
  classifier: 'sınıflandırıcı',
}

function totalTokens(tokens: Tokens): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

/**
 * The period's cost with Vites against what the same work would have cost without it:
 * the main loop priced at each day's baseline line, subagents as they were (Vites leaves
 * their model alone), and no classifier calls at all.
 */
export function computeReport(book: UsageBook, days: string[] | 'all', prices: Record<Line, Price> = PRICES): ReportNumbers {
  const chosen = (days === 'all' ? Object.keys(book) : days).filter(day => book[day] !== undefined).sort()
  const numbers: ReportNumbers = {
    withVites: 0,
    without: 0,
    saved: 0,
    savedPercent: 0,
    byLine: {},
    bySource: { main: 0, subagent: 0, classifier: 0 },
    baselines: [],
    days: chosen.length,
  }

  for (const day of chosen) {
    const data = book[day]
    if (data === undefined) continue
    const { baseline, rows } = data
    if (!numbers.baselines.includes(baseline)) numbers.baselines.push(baseline)

    for (const [key, tokens] of Object.entries(rows)) {
      const [source, line] = key.split(':') as [UsageSource, Line]
      const real = cost(tokens, prices[line])
      numbers.withVites += real
      numbers.bySource[source] += real
      const seen = numbers.byLine[line] ?? { tokens: 0, cost: 0 }
      numbers.byLine[line] = { tokens: seen.tokens + totalTokens(tokens), cost: seen.cost + real }

      if (source === 'main') numbers.without += cost(tokens, prices[baseline])
      if (source === 'subagent') numbers.without += real
    }
  }

  numbers.saved = numbers.without - numbers.withVites
  numbers.savedPercent = numbers.without > 0 ? Math.round((numbers.saved / numbers.without) * 100) : 0

  return numbers
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** 1234567 → 1.234.567, the Turkish thousands separator. */
function tokensText(count: number): string {
  return String(Math.round(count)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** The report as the person reads it, in Turkish, with the caveats the spec asks for on every report. */
export function formatReport(numbers: ReportNumbers, period: Period, priceDate: string): string {
  const label = PERIOD_LABEL[period]
  if (numbers.days === 0) return `Tasarruf raporu (${label}): bu dönem için henüz kayıt yok.`

  const lines = [`Tasarruf raporu · ${label} · ${numbers.days} gün kayıt`]
  for (const line of LINES) {
    const seen = numbers.byLine[line]
    if (seen !== undefined) lines.push(`  ${line}: ${tokensText(seen.tokens)} token · ${money(seen.cost)}`)
  }
  lines.push(`Vites ile: ${money(numbers.withVites)}`)
  for (const source of ['main', 'subagent', 'classifier'] as const) {
    lines.push(`  ${SOURCE_LABEL[source]}: ${money(numbers.bySource[source])}`)
  }
  lines.push(`Vites olmasaydı: ${money(numbers.without)}`)
  const change = numbers.saved >= 0 ? 'Tasarruf' : 'Ek maliyet'
  lines.push(`${change}: ${money(Math.abs(numbers.saved))} (%${Math.abs(numbers.savedPercent)})`)
  lines.push(
    numbers.baselines.length > 1
      ? `Karşılaştırma hattı dönem içinde değişti: ${numbers.baselines.join(', ')}.`
      : `Karşılaştırma hattı: ${numbers.baselines[0] ?? 'opus'}.`,
  )
  lines.push(
    'API liste fiyatlarıyla tahmindir; abonelik (Pro/Max) kullanıyorsan bu para değil kullanım limiti karşılığıdır; ' +
      `farklı model farklı token sayısı üretirdi. Fiyat tarihi: ${priceDate}.`,
  )
  lines.push('Haiku uzun bağlam (100K üstü) tarifesiyle fiyatlandı; tasarruf bir miktar düşük görünebilir.')

  return lines.join('\n')
}
