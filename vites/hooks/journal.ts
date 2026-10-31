import type { Effort, GearNumber, Level, PickFlag, PickSource } from '../types'
import { LEVELS, effortTr, fold, gearNumber, isEffort } from './logic'

// The store keeps this many entries; older ones fall off the front.
export const JOURNAL_LIMIT = 500

// The start of the prompt kept with each entry: enough to recognise it, never the whole text.
export const SNIPPET_LENGTH = 120

export type JournalEntry = {
  at: string
  snippet: string
  source: PickSource
  rawLevel: Level
  rawEffort: Effort
  model: string
  effort: Effort
  gear: GearNumber
  flags: PickFlag[]
}

const SOURCES: readonly PickSource[] = ['classifier', 'keywords', 'tag']
const FLAGS: readonly PickFlag[] = ['capped', 'held', 'dropped', 'tagged']
const GEARS: readonly GearNumber[] = [1, 2, 3, 4]

const SOURCE_LABEL: Record<PickSource, string> = {
  classifier: 'sınıflandırıcı',
  keywords: 'kelime kuralı',
  tag: 'etiket',
}

const FLAG_LABEL: Record<PickFlag, string> = {
  capped: 'tavana takıldı',
  held: 'vites tutuldu',
  dropped: 'düştü',
  tagged: 'etiketli',
}

/** The prompt's first words on one line: whitespace collapsed, cut at SNIPPET_LENGTH with an ellipsis. */
export function makeSnippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH - 1)}…` : flat
}

function isEntry(value: unknown): value is JournalEntry {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>

  return (
    typeof item.at === 'string' &&
    typeof item.snippet === 'string' &&
    typeof item.model === 'string' &&
    SOURCES.includes(item.source as PickSource) &&
    LEVELS.includes(item.rawLevel as Level) &&
    isEffort(item.rawEffort) &&
    isEffort(item.effort) &&
    GEARS.includes(item.gear as GearNumber) &&
    Array.isArray(item.flags) &&
    item.flags.every(flag => FLAGS.includes(flag as PickFlag))
  )
}

/** The journal from the store: entries that have the full shape, or nothing when the value is not a list. */
export function readJournal(value: unknown): JournalEntry[] {
  return Array.isArray(value) ? value.filter(isEntry) : []
}

/** The list with the entry at the end, trimmed to the newest JOURNAL_LIMIT. */
export function appendEntry(list: readonly JournalEntry[], entry: JournalEntry): JournalEntry[] {
  return [...list, entry].slice(-JOURNAL_LIMIT)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** `01.11 14:05` in local time; the stored string as is when it is not a date. */
function when(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function describeEntry(entry: JournalEntry): string {
  const parts = [
    when(entry.at),
    `${entry.gear}. vites · ${entry.model} · ${effortTr(entry.effort)}`,
    SOURCE_LABEL[entry.source],
  ]
  const rawGear = gearNumber(entry.rawLevel)
  if (rawGear !== entry.gear || entry.rawEffort !== entry.effort) {
    parts.push(`ham: ${rawGear}. vites · ${effortTr(entry.rawEffort)}`)
  }
  if (entry.flags.length > 0) parts.push(entry.flags.map(flag => FLAG_LABEL[flag]).join(', '))

  return `${parts.join(' · ')} — "${entry.snippet}"`
}

/** The newest `count` entries, newest first, one per line. */
export function formatJournal(list: readonly JournalEntry[], count: number): string {
  if (list.length === 0) return 'Günlükte henüz kayıt yok.'

  return list.slice(-count).reverse().map(describeEntry).join('\n')
}

/** The count after `/vites günlük`: 10 when missing or not a number, never below 1 or above the limit. */
export function parseCount(arg: string): number {
  const number = Number.parseInt(fold(arg).trim(), 10)
  if (Number.isNaN(number)) return 10

  return Math.min(Math.max(number, 1), JOURNAL_LIMIT)
}
