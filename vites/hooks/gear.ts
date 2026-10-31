import type { Effort, Level, Line, PickFlag } from '../types'
import { EFFORTS, fold, LEVELS, LINES } from './logic'

/** Light picks in a row before the held gear drops (spec §7.4). */
export const DROP_AFTER = 3

/** The ceiling when the store has none (spec §7.3). */
export const DEFAULT_CEILING: Line = 'opus'

/**
 * Whether the effort is held and dropped together with the model, rather than
 * following each prompt's own classification.
 *
 * Finding (claude-api skill, `shared/prompt-caching.md` § Invalidation
 * hierarchy, 2026-11-01): "Thinking and `effort` changes always invalidate the
 * messages cache, and on models that render the thinking configuration ahead
 * of tools and system they invalidate those caches too - pin thinking and
 * effort settings per route rather than varying them per request." The only
 * cache-preserving form is a per-message effort system message behind the
 * `mid-conversation-output-config-2026-07-01` beta, which Vites cannot send:
 * it only sets the engine's top-level effort in `turn.step`. So an effort
 * change costs the whole conversation cache, and effort is held like the model:
 * while a lower pick is held, the held effort is sent; at an equal level the
 * effort may rise at once but a lower one is held; it drops with the level.
 * (A pick at a higher level switches the model anyway, so its own effort is
 * taken.) When false, an equal-level pick's effort is sent as classified.
 */
export const HOLD_EFFORT: boolean = true

export type Gear = { level: Level; effort: Effort }

export type GearState = { held: Gear | null; streak: Gear[]; isTagHeld: boolean }

export const INITIAL_GEAR: GearState = { held: null, streak: [], isTagHeld: false }

export type Tags = { line?: Line; effort?: Effort; text: string }

export type GearInput = { pick: Gear; ceiling: Line | null; tagLine?: Line; fixedEffort?: Effort }

export type GearDecision = { gear: Gear; state: GearState; flags: PickFlag[] }

/** The level a line serves: haiku → small … fable → strongest. */
export function levelOfLine(line: Line): Level {
  return LEVELS[LINES.indexOf(line)] ?? 'strong'
}

/** The level lowered to the ceiling line when it is above it; null means no ceiling. */
export function capLevel(level: Level, ceiling: Line | null): Level {
  if (ceiling === null) return level
  const top = levelOfLine(ceiling)

  return rank(level) > rank(top) ? top : level
}

/** The ceiling named in a command word: a line, null for yok/none, undefined when unknown. */
export function parseCeiling(arg: string): Line | null | undefined {
  const word = fold(arg).trim()
  if (word === 'yok' || word === 'none') return null

  return LINES.find(line => line === word)
}

// Maps, not object literals: a word such as "constructor" must not resolve to an Object member.
const TAG_LINE: ReadonlyMap<string, Line> = new Map<string, Line>([
  ['haiku', 'haiku'],
  ['sonnet', 'sonnet'],
  ['opus', 'opus'],
  ['fable', 'fable'],
])
const TAG_EFFORT: ReadonlyMap<string, Effort> = new Map<string, Effort>([
  ['dusuk', 'low'],
  ['orta', 'medium'],
  ['yuksek', 'high'],
  ['cokyuksek', 'xhigh'],
  ['maks', 'max'],
])
const TAG_QUICK = 'hizli'

/**
 * The gear tags at the start of a prompt and the text after them. Tags are
 * read on folded text with punctuation dropped (#ÇokYüksek → cokyuksek,
 * "#opus," → opus); digits stay, so #sonnet14 is not a tag. Reading stops at
 * the first word that is not a tag.
 */
export function parseTags(text: string): Tags {
  const tags: Tags = { text }
  let rest = text

  for (;;) {
    const found = rest.match(/^\s*#(\S+)/)
    if (found === null) break
    const key = fold(found[1] ?? '').replace(/[^a-z0-9]/g, '')
    const line = TAG_LINE.get(key)
    const effort = TAG_EFFORT.get(key)

    if (key === TAG_QUICK) {
      tags.line = 'haiku'
      tags.effort = 'low'
    } else if (line !== undefined) {
      tags.line = line
    } else if (effort !== undefined) {
      tags.effort = effort
    } else {
      break
    }
    rest = rest.slice(found[0].length)
    tags.text = rest.trim()
  }

  return tags
}

/**
 * The gear to run this prompt at and the state to keep (spec §7.4–7.5).
 *
 * A tag sets the held gear outright, above the ceiling if need be. Otherwise
 * the pick is capped, then compared with the held gear: an equal or higher
 * gear is taken at once; a lower one is held, and the DROP_AFTER-th in a row
 * drops to the highest of those light picks. A held gear that was not tagged
 * is pulled down to a lowered ceiling first.
 */
export function nextGear(state: GearState, input: GearInput): GearDecision {
  const decided = input.tagLine === undefined ? decideAuto(state, input) : decideTag(input.tagLine, input.pick.effort)
  const gear = input.fixedEffort === undefined ? decided.gear : { ...decided.gear, effort: input.fixedEffort }

  return { ...decided, gear }
}

/** A model tag: the gear goes to that line, over the ceiling if need be, and is held there. */
function decideTag(line: Line, effort: Effort): GearDecision {
  const gear: Gear = { level: levelOfLine(line), effort }

  return { gear, state: { held: gear, streak: [], isTagHeld: true }, flags: ['tagged'] }
}

function decideAuto(state: GearState, input: GearInput): GearDecision {
  const flags: PickFlag[] = []
  const pick: Gear = { level: capLevel(input.pick.level, input.ceiling), effort: input.pick.effort }
  if (pick.level !== input.pick.level) flags.push('capped')

  if (state.held === null) {
    return { gear: pick, state: { held: pick, streak: [], isTagHeld: false }, flags }
  }

  // A ceiling lowered mid-session pulls an automatic hold down; a tagged one waits.
  const held: Gear = state.isTagHeld
    ? state.held
    : { level: capLevel(state.held.level, input.ceiling), effort: state.held.effort }
  if (held.level !== state.held.level) flags.push('dropped')

  // Levels decide. A higher level is taken with its own effort (the model
  // changes anyway); at an equal level a lower effort is held while
  // HOLD_EFFORT, since an effort change alone would still cost the cache.
  if (rank(pick.level) > rank(held.level)) {
    return { gear: pick, state: { held: pick, streak: [], isTagHeld: false }, flags }
  }
  if (rank(pick.level) === rank(held.level)) {
    const effort = HOLD_EFFORT ? higherEffort(held.effort, pick.effort) : pick.effort
    const gear: Gear = { level: pick.level, effort }

    return { gear, state: { held: gear, streak: [], isTagHeld: false }, flags }
  }

  const streak = [...state.streak, pick]
  if (streak.length < DROP_AFTER) {
    flags.push('held')

    return { gear: held, state: { held, streak, isTagHeld: state.isTagHeld }, flags }
  }

  // Streak entries were capped under the ceiling of their own prompt, so the
  // target is capped again under today's ceiling in case it was lowered since.
  const highest = dropTarget(streak)
  const target: Gear = { level: capLevel(highest.level, input.ceiling), effort: highest.effort }
  if (target.level !== highest.level && !flags.includes('capped')) flags.push('capped')
  if (!flags.includes('dropped')) flags.push('dropped')

  return { gear: target, state: { held: target, streak: [], isTagHeld: false }, flags }
}

/** The highest level in the streak, with the effort of the latest pick at that level. */
function dropTarget(streak: Gear[]): Gear {
  return streak.reduce((best, pick) => (rank(pick.level) >= rank(best.level) ? pick : best))
}

function higherEffort(a: Effort, b: Effort): Effort {
  return EFFORTS.indexOf(a) >= EFFORTS.indexOf(b) ? a : b
}

function rank(level: Level): number {
  return LEVELS.indexOf(level)
}

/** The gear state from the store; anything malformed starts over. */
export function readGearState(value: unknown): GearState {
  if (typeof value !== 'object' || value === null) return INITIAL_GEAR
  const { held, streak, isTagHeld } = value as Record<string, unknown>

  if (held !== null && !isGear(held)) return INITIAL_GEAR
  if (!Array.isArray(streak) || !streak.every(isGear)) return INITIAL_GEAR
  if (typeof isTagHeld !== 'boolean') return INITIAL_GEAR

  return { held: held as Gear | null, streak: streak as Gear[], isTagHeld }
}

function isGear(value: unknown): value is Gear {
  if (typeof value !== 'object' || value === null) return false
  const { level, effort } = value as Record<string, unknown>

  return LEVELS.includes(level as Level) && EFFORTS.includes(effort as Effort)
}
