import { describe, expect, test } from 'claude-code/testing'

import type { Line } from '../types'
import {
  capLevel,
  DEFAULT_CEILING,
  DROP_AFTER,
  HOLD_EFFORT,
  INITIAL_GEAR,
  levelOfLine,
  nextGear,
  parseCeiling,
  parseTags,
  readGearState,
} from './gear'
import type { Gear, GearState } from './gear'

const STRONG: Gear = { level: 'strong', effort: 'high' }
const STRONGEST: Gear = { level: 'strongest', effort: 'xhigh' }
const EVERYDAY: Gear = { level: 'everyday', effort: 'medium' }
const SMALL: Gear = { level: 'small', effort: 'low' }

function held(gear: Gear, isTagHeld = false): GearState {
  return { held: gear, streak: [], isTagHeld }
}

/** Runs `picks` through nextGear in order, with no tag, and returns every decision. */
function run(start: GearState, ceiling: Line | null, picks: Gear[]) {
  const out = []
  let state = start
  for (const pick of picks) {
    const decision = nextGear(state, { pick, ceiling })
    out.push(decision)
    state = decision.state
  }

  return out
}

describe('constants', () => {
  test('the fixed values from the spec', async () => {
    expect(DROP_AFTER).toBe(3)
    expect(DEFAULT_CEILING).toBe('opus')
    expect(typeof HOLD_EFFORT).toBe('boolean')
    expect(INITIAL_GEAR).toEqual({ held: null, streak: [], isTagHeld: false })
  })
})

describe('tags at the start of a prompt', () => {
  test('a model tag and an effort tag together, Turkish spelling', async () => {
    expect(parseTags('#opus #maks refactor et')).toEqual({ line: 'opus', effort: 'max', text: 'refactor et' })
  })

  test('#hızlı is haiku plus low, with or without the dotless i', async () => {
    expect(parseTags('#hızlı şunu çevir')).toEqual({ line: 'haiku', effort: 'low', text: 'şunu çevir' })
    expect(parseTags('#hizli şunu çevir')).toEqual({ line: 'haiku', effort: 'low', text: 'şunu çevir' })
  })

  test('mixed case and accents fold to the same tag', async () => {
    expect(parseTags('#ÇokYüksek bak')).toEqual({ effort: 'xhigh', text: 'bak' })
    expect(parseTags('#cokyuksek bak')).toEqual({ effort: 'xhigh', text: 'bak' })
  })

  test('an effort tag alone names no line', async () => {
    expect(parseTags('#yüksek analiz')).toEqual({ effort: 'high', text: 'analiz' })
  })

  test('only leading tags count', async () => {
    expect(parseTags('merhaba #opus')).toEqual({ text: 'merhaba #opus' })
  })

  test('a prompt that is only a tag leaves empty text', async () => {
    expect(parseTags('#opus')).toEqual({ line: 'opus', text: '' })
  })

  test('an unknown tag is plain text', async () => {
    expect(parseTags('#etiket yok')).toEqual({ text: '#etiket yok' })
  })
})

describe('ceiling', () => {
  test('capLevel lowers a level to the ceiling line and no further', async () => {
    expect(capLevel('strongest', 'opus')).toBe('strong')
    expect(capLevel('strongest', null)).toBe('strongest')
    expect(capLevel('small', 'opus')).toBe('small')
  })

  test('levelOfLine maps each line to its level', async () => {
    expect(levelOfLine('haiku')).toBe('small')
    expect(levelOfLine('fable')).toBe('strongest')
  })

  test('parseCeiling folds the word, reads yok as none, rejects the rest', async () => {
    expect(parseCeiling('Fable')).toBe('fable')
    expect(parseCeiling('yok')).toBe(null)
    expect(parseCeiling('none')).toBe(null)
    expect(parseCeiling('banana')).toBe(undefined)
  })
})

describe('nextGear', () => {
  test('the first pick is taken as is', async () => {
    const { gear, state, flags } = nextGear(INITIAL_GEAR, { pick: STRONG, ceiling: 'opus' })
    expect(gear).toEqual(STRONG)
    expect(flags).toEqual([])
    expect(state).toEqual({ held: STRONG, streak: [], isTagHeld: false })
  })

  test('an upshift is immediate and clears the streak', async () => {
    const start: GearState = { held: EVERYDAY, streak: [SMALL], isTagHeld: false }
    const { gear, state, flags } = nextGear(start, { pick: STRONG, ceiling: 'opus' })
    expect(gear).toEqual(STRONG)
    expect(flags).toEqual([])
    expect(state.streak).toEqual([])
    expect(state.held).toEqual(STRONG)
  })

  test('a downshift waits for three light picks, then drops to the highest of them', async () => {
    const [first, second, third] = run(held(STRONG), 'opus', [SMALL, SMALL, SMALL])
    expect(first?.gear).toEqual(STRONG)
    expect(first?.flags).toEqual(['held'])
    expect(second?.gear).toEqual(STRONG)
    expect(second?.flags).toEqual(['held'])
    expect(second?.state.streak).toEqual([SMALL, SMALL])
    expect(third?.gear).toEqual(SMALL)
    expect(third?.flags).toEqual(['dropped'])
    expect(third?.state).toEqual({ held: SMALL, streak: [], isTagHeld: false })
  })

  test('the drop lands on the highest level in the streak', async () => {
    const [, , third] = run(held(STRONG), 'opus', [SMALL, EVERYDAY, SMALL])
    expect(third?.gear).toEqual(EVERYDAY)
    expect(third?.flags).toEqual(['dropped'])
  })

  test('a strong pick in the middle of a light streak resets it', async () => {
    const [, , third, fourth] = run(held(STRONG), 'opus', [SMALL, SMALL, STRONG, SMALL])
    expect(third?.gear).toEqual(STRONG)
    expect(third?.state.streak).toEqual([])
    expect(fourth?.gear).toEqual(STRONG)
    expect(fourth?.state.streak).toEqual([SMALL])
  })

  test('the ceiling caps an automatic pick and keeps the effort', async () => {
    const { gear, flags } = nextGear(INITIAL_GEAR, { pick: STRONGEST, ceiling: 'opus' })
    expect(gear).toEqual({ level: 'strong', effort: 'xhigh' })
    expect(flags).toContain('capped')
  })

  test('a model tag sets the gear there, above the ceiling, and holds it', async () => {
    const tagged = nextGear(INITIAL_GEAR, { pick: STRONG, ceiling: 'opus', tagLine: 'fable' })
    expect(tagged.gear.level).toBe('strongest')
    expect(tagged.flags).toEqual(['tagged'])
    expect(tagged.state.isTagHeld).toBe(true)

    const [first, second, third] = run(tagged.state, 'opus', [SMALL, SMALL, SMALL])
    expect(first?.gear.level).toBe('strongest')
    expect(first?.flags).toEqual(['held'])
    expect(second?.gear.level).toBe('strongest')
    expect(third?.gear).toEqual(SMALL)
    expect(third?.flags).toEqual(['dropped'])
    expect(third?.state.isTagHeld).toBe(false)
  })

  test('a lower model tag drops at once', async () => {
    const { gear, flags, state } = nextGear(held(STRONG), { pick: STRONG, ceiling: 'opus', tagLine: 'haiku' })
    expect(gear.level).toBe('small')
    expect(flags).toEqual(['tagged'])
    expect(state).toEqual({ held: gear, streak: [], isTagHeld: true })
  })

  test('a ceiling lowered mid-session pulls the held gear down on the next prompt', async () => {
    const { gear, flags, state } = nextGear(held(STRONG), { pick: EVERYDAY, ceiling: 'sonnet' })
    expect(gear).toEqual(EVERYDAY)
    expect(flags).toEqual(['dropped'])
    expect(state).toEqual({ held: EVERYDAY, streak: [], isTagHeld: false })
  })

  test('a fixed effort is sent as is and not held', async () => {
    const { gear, state } = nextGear(held(STRONG), { pick: STRONG, ceiling: 'opus', fixedEffort: 'max' })
    expect(gear).toEqual({ level: 'strong', effort: 'max' })
    expect(state.held).toEqual(STRONG)
  })

  test('a tag-held gear ignores a lower ceiling until it drops; the next upgrade is capped', async () => {
    const start = held(STRONGEST, true)
    const [first, second, third] = run(start, 'haiku', [SMALL, SMALL, SMALL])
    expect(first?.gear).toEqual(STRONGEST)
    expect(first?.flags).toEqual(['held'])
    expect(second?.gear).toEqual(STRONGEST)
    expect(third?.gear).toEqual(SMALL)
    expect(third?.flags).toEqual(['dropped'])

    const after = nextGear(third!.state, { pick: STRONG, ceiling: 'haiku' })
    expect(after.gear.level).toBe('small')
    expect(after.flags).toContain('capped')
  })
})

describe('reading the stored gear state', () => {
  test('garbage falls back to the initial state', async () => {
    expect(readGearState(42)).toEqual(INITIAL_GEAR)
    expect(readGearState({ held: 'x' })).toEqual(INITIAL_GEAR)
    expect(readGearState(undefined)).toEqual(INITIAL_GEAR)
    expect(readGearState({ held: STRONG, streak: [{ level: 'nope', effort: 'low' }], isTagHeld: false })).toEqual(INITIAL_GEAR)
  })

  test('a well-formed state is kept', async () => {
    const state: GearState = { held: STRONG, streak: [SMALL], isTagHeld: true }
    expect(readGearState(state)).toEqual(state)
  })
})
