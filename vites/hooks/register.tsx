import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, PromptSubmitInput, Register, TurnStepInput, TurnStepResult } from 'claude-code'

import type { Effort, LastPick, Level, Line, PickFlag, PickSource } from '../types'
import { DEFAULT_CEILING, DROP_AFTER, INITIAL_GEAR, levelOfLine, nextGear, parseCeiling, parseTags, readGearState } from './gear'
import type { GearState, Tags } from './gear'
import { appendEntry, formatJournal, makeSnippet, parseCount, readJournal } from './journal'
import {
  CLASSIFIER_SYSTEM,
  candidatesFor,
  chipLabel,
  classifierPrompt,
  effortTr,
  fold,
  gearNumber,
  guessEffort,
  guessLevel,
  isEffort,
  isSameModel,
  isShortReply,
  lineOf,
  namedEffort,
  parseEffort,
  parseLevel,
  restoreValue,
  smallestModel,
  statusLine,
} from './logic'
import { PRICE_DATE } from './pricing'
import { computeReport, daysOf, formatReport, parsePeriod } from './report'
import { addUsage, baselineLine, localDay, readUsage, tokensFrom } from './usage'
import type { UsageSource } from './usage'

const MODEL_KEY = 'model'
const GOLD = '#F2C46D'
const SLATE = '#262B33'
const INK = '#0D1117'
const LIGHT = '#E6EDF3'
const MUTED = '#7D8590'

const USAGE = 'Komutlar: aç, kapat, durum, tavan, günlük, rapor.'
const FAILED = 'Vites şu an bunu yapamadı. Hiçbir şey değişmedi.'
const CEILINGS = 'Tavan haiku, sonnet, opus, fable veya yok olabilir.'
const PERIODS = 'Dönem bugün, hafta, ay veya tümü olabilir.'

// How the pick was made and what the gear logic did to it, as /vites durum says it.
const SOURCE_TR: Record<PickSource, string> = {
  classifier: 'küçük model seçti',
  keywords: 'kelimelerden tahmin',
  tag: 'etiketle seçildi',
}
const FLAG_TR: Record<PickFlag, string> = {
  capped: 'tavana takıldı',
  held: 'vites tutuldu',
  dropped: 'düştü',
  tagged: 'etiketli',
}

// $.state drives the chip; $.store is the record that outlives the session.
const enabled = atom({ plugin: 'vites', key: 'enabled' } as const, false)
const last = atom({ plugin: 'vites', key: 'last' } as const, null)

type Engine = EngineInterface

async function modelRow($: Engine): Promise<ConfigRow | undefined> {
  const rows = await $.config.list()

  return rows.find(row => row.key === MODEL_KEY)
}

function asText(value: ConfigRow['value']): string {
  return typeof value === 'string' ? value : String(value)
}

/** Pins the gear, model and effort under the prompt. A failed pin leaves the line as it was. */
function showLine($: Engine, pick: LastPick | null, isOn: boolean): void {
  try {
    $.ui.status(statusLine(isOn, pick))
  } catch {
    // The chip still shows the same words.
  }
}

async function isEnabled($: Engine): Promise<boolean> {
  return (await $.store.get('enabled')) === true
}

/** The held gear starts over: at session start and whenever Vites is turned on. */
async function resetGear($: Engine): Promise<void> {
  await $.store.set('gear', INITIAL_GEAR)
}

/** The ceiling in the store: 'yok' is none, a line is itself, anything else is the default. */
async function ceilingOf($: Engine): Promise<Line | null> {
  const value = await $.store.get('ceiling')
  const parsed = parseCeiling(typeof value === 'string' ? value : '')

  return parsed === undefined ? DEFAULT_CEILING : parsed
}

function ceilingText(ceiling: Line | null): string {
  return ceiling === null
    ? 'Tavan yok. Otomatik seçim fable\'a kadar çıkabilir.'
    : `Tavan ${ceiling}. Otomatik seçim bunun üstüne çıkmaz; etiketler çıkabilir.`
}

async function turnOn($: Engine): Promise<string> {
  if (await isEnabled($)) {
    await update($, enabled, () => true)
    return 'Vites zaten açık.'
  }

  const row = await modelRow($)
  if (row === undefined) {
    return 'Vites bu Claude Code sürümünde model ayarını bulamadı, kapalı kaldı.'
  }
  if (row.isLocked) {
    return 'Modeli kuruluşun belirliyor, Vites kapalı kaldı.'
  }

  const previous = asText(row.value)
  await $.store.set('previous', previous)
  await $.store.delete('applied')
  await resetGear($)
  await $.store.set('enabled', true)
  await update($, enabled, () => true)

  return `Vites açık. Kapatınca ${previous} geri gelir.`
}

/** `restore` is false when the person picked a model by hand: theirs stays. */
async function turnOff($: Engine, restore: boolean): Promise<string> {
  const wasOn = await isEnabled($)
  const previous = await $.store.get('previous')

  await $.store.set('enabled', false)
  await $.store.delete('previous')
  await $.store.delete('applied')
  await $.store.delete('effort')
  await $.store.delete('gear')
  await update($, enabled, () => false)
  await update($, last, () => null)
  showLine($, null, false)

  if (!wasOn) return 'Vites zaten kapalı.'
  if (!restore || typeof previous !== 'string') return 'Vites kapalı.'

  const row = await modelRow($)
  const value = restoreValue(previous, row?.options ?? [])
  if (row !== undefined && isSameModel(asText(row.value), value)) {
    return `Vites kapalı. Model ${value}, önceki gibi.`
  }

  const result = await $.config.set({ key: MODEL_KEY, value })

  return result.deny === undefined
    ? `Vites kapalı. Model ${value} olarak geri alındı.`
    : `Vites kapalı, ama model ${value} yapılamadı: ${result.deny}`
}

async function status($: Engine): Promise<string> {
  const model = await $.session.model()
  if (!(await isEnabled($))) return `Vites kapalı. Model ${model}.`

  const pick = await read($, last)
  const previous = await $.store.get('previous')
  const lines = [`Vites açık. Model ${model}.`]
  if (pick !== null) {
    const notes = pick.flags.filter(flag => flag !== 'tagged').map(flag => FLAG_TR[flag])
    const how = [SOURCE_TR[pick.source], ...notes].join(', ')
    const effort = isEffort(pick.effort) ? ` · ${effortTr(pick.effort)}` : ''
    lines.push(`Son seçim: ${pick.gear}. vites · ${pick.model}${effort} (${how}).`)
  }
  const ceiling = await ceilingOf($)
  lines.push(ceiling === null ? 'Tavan yok.' : `Tavan ${ceiling}.`)
  const gear = readGearState(await $.store.get('gear'))
  if (gear.held !== null && gear.streak.length > 0) {
    lines.push(`Vites tutuluyor: ${gearNumber(gear.held.level)}. viteste, ${gear.streak.length}/${DROP_AFTER} hafif seçim.`)
  }
  if (typeof previous === 'string') lines.push(`Kapatınca ${previous} geri gelir.`)

  return lines.join(' ')
}

/** `/vites tavan [hat|yok]`: names the ceiling, or sets it. Only automatic picks are bound by it. */
async function setCeiling($: Engine, arg: string): Promise<string> {
  if (arg === '') return ceilingText(await ceilingOf($))

  const ceiling = parseCeiling(arg)
  if (ceiling === undefined) return `Vites "${arg}" tavanını bilmiyor. ${CEILINGS} Hiçbir şey değişmedi.`
  await $.store.set('ceiling', ceiling ?? 'yok')

  return ceilingText(ceiling)
}

async function showJournal($: Engine, arg: string): Promise<string> {
  const journal = readJournal(await $.store.get('journal'))

  return formatJournal(journal, parseCount(arg))
}

async function showReport($: Engine, arg: string): Promise<string> {
  const period = parsePeriod(arg)
  if (period === undefined) return `Vites "${arg}" dönemini bilmiyor. ${PERIODS} Hiçbir şey değişmedi.`
  const book = readUsage(await $.store.get('usage'))

  return formatReport(computeReport(book, daysOf(period, new Date())), period, PRICE_DATE)
}

/** Routes on the folded first word, so "aç", "ac" and "on" are the same case. The rest goes to the subcommand as typed. */
async function runCommand($: Engine, args: string): Promise<string> {
  const [first = '', ...others] = args.trim().split(/\s+/)
  const word = fold(first)
  const rest = others.join(' ')

  switch (word) {
    case 'ac':
    case 'on':
      return turnOn($)
    case 'kapat':
    case 'off':
      return turnOff($, true)
    case '':
    case 'durum':
    case 'status':
      return status($)
    case 'tavan':
      return setCeiling($, rest)
    case 'gunluk':
      return showJournal($, rest)
    case 'rapor':
      return showReport($, rest)
    default:
      return `Vites "${args.trim()}" komutunu bilmiyor. ${USAGE} Hiçbir şey değişmedi.`
  }
}

async function toggle($: Engine): Promise<void> {
  try {
    if (await isEnabled($)) await turnOff($, true)
    else await turnOn($)
  } catch {
    // A press that fails leaves the switch where it was.
  }
}

/**
 * Adds a request's tokens to today's usage book, only while Vites is on and the
 * model sits on a known line. Nothing is counted for a missing or empty usage.
 * The bookkeeping must never reach the caller: it is wrapped here, not there.
 */
async function recordUsage($: Engine, source: UsageSource, model: string, usage: unknown): Promise<void> {
  try {
    const tokens = tokensFrom(usage)
    const line = lineOf(model)
    if (tokens === undefined || line === undefined || !(await isEnabled($))) return

    const book = readUsage(await $.store.get('usage'))
    const baseline = baselineLine(await $.store.get('previous'))
    await $.store.set('usage', addUsage(book, localDay(new Date()), source, line, tokens, baseline))
  } catch {
    // A ledger that cannot be written loses this request's count, nothing else.
  }
}

/** The small model's answer for the prompt, or undefined when it gave none in time. Its cost is counted too. */
async function askSmallModel($: Engine, text: string, options: readonly string[]): Promise<string | undefined> {
  const small = smallestModel(options)
  const names = small === undefined ? [] : [small, lineOf(small)]

  for (const model of new Set(names)) {
    if (model === undefined) continue
    try {
      const reply = await $.model.complete({
        model,
        system: CLASSIFIER_SYSTEM,
        prompt: classifierPrompt(text),
        maxTokens: 12,
        effort: 'low',
        timeoutMs: 4000,
      })
      await recordUsage($, 'classifier', model, reply.usage)

      return reply.isAnswered ? reply.text : undefined
    } catch {
      // The engine would not send to this spelling; try the line's alias.
    }
  }

  return undefined
}

function isTypedWhileIdle(e: PromptSubmitInput): boolean {
  const kind = e.origin.kind
  const isTyped = kind === 'composer' || kind === 'bridge'

  return isTyped && e.turnId === undefined && !e.text.trimStart().startsWith('/')
}

type RawPick = { level: Level; effort: Effort; source: PickSource }

/**
 * What the prompt asks for before the gear logic: the tagged line with its effort,
 * or the small model's answer, or a guess from the words. A model tag skips the
 * small model, since the person already chose.
 */
async function rawPick($: Engine, text: string, tags: Tags, options: readonly string[]): Promise<RawPick> {
  if (tags.line !== undefined) {
    const level = levelOfLine(tags.line)

    return { level, effort: tags.effort ?? guessEffort(text, level), source: 'tag' }
  }

  const answer = await askSmallModel($, text, options)
  const answered = answer === undefined ? undefined : parseLevel(answer)
  const level = answered ?? guessLevel(text)
  const effort = (answer === undefined ? undefined : parseEffort(answer)) ?? guessEffort(text, level)

  return { level, effort, source: answered === undefined ? 'keywords' : 'classifier' }
}

/** Keeps the gear state and writes the journal entry. Each on its own, so neither can undo the switch made. */
async function keepRecords($: Engine, text: string, raw: RawPick, pick: LastPick, state: GearState): Promise<void> {
  try {
    await $.store.set('gear', state)
  } catch {
    // The hold starts over on the next prompt; the model already moved.
  }
  try {
    const journal = readJournal(await $.store.get('journal'))
    await $.store.set(
      'journal',
      appendEntry(journal, {
        at: new Date().toISOString(),
        snippet: makeSnippet(text),
        source: raw.source,
        rawLevel: raw.level,
        rawEffort: raw.effort,
        model: pick.model,
        effort: pick.effort,
        gear: pick.gear,
        flags: pick.flags,
      }),
    )
  } catch {
    // A journal that cannot be written loses this entry, nothing else.
  }
}

async function pickModel($: Engine, text: string, tags: Tags): Promise<void> {
  const row = await modelRow($)
  if (row === undefined || row.isLocked) return

  const current = asText(row.value)
  // A hand pick (/model, the picker) arrives through the config.set hook below and turns
  // Vites off there. A model that differs here without that (a reset after /compact,
  // another window sharing the setting) is drift, so Vites stays on and sorts again.
  const options = row.options ?? []
  const raw = await rawPick($, text, tags, options)
  // An effort tag or an effort the person named in the prompt is sent as is, never held.
  const fixedEffort = tags.effort ?? namedEffort(text)
  const ceiling = await ceilingOf($)
  const state = readGearState(await $.store.get('gear'))
  const decision = nextGear(state, { pick: { level: raw.level, effort: raw.effort }, ceiling, tagLine: tags.line, fixedEffort })
  const { level, effort } = decision.gear

  let chosen: string | undefined
  for (const value of candidatesFor(level, options)) {
    if (isSameModel(current, value)) {
      chosen = value
      break
    }
    const result = await $.config.set({ key: MODEL_KEY, value })
    if (result.deny === undefined) {
      chosen = value
      break
    }
  }
  if (chosen === undefined) return

  const after = await modelRow($)
  await $.store.set('applied', asText(after?.value ?? chosen))
  const pick: LastPick = {
    level,
    effort,
    model: chosen,
    isGuess: raw.source === 'keywords',
    gear: gearNumber(level),
    source: raw.source,
    flags: decision.flags,
  }
  await update($, last, () => pick)
  // Read by the person's status bar, which shows the saved effort, not the one sent.
  await $.store.set('effort', effort)
  showLine($, pick, true)
  await keepRecords($, text, raw, pick, decision.state)
}

/**
 * The effort to send on the main loop's requests: the last pick's while
 * Vites is on. The engine has no effort row in /config, so it is set
 * on each request rather than saved; the person's own setting is untouched.
 */
async function effortToSend($: Engine): Promise<Effort | undefined> {
  if (!(await isEnabled($))) return undefined
  const pick = await read($, last)

  return pick !== null && isEffort(pick.effort) ? pick.effort : undefined
}

/**
 * Counts a step's response under main or subagent and the line that answered
 * (the request's model when the usage names none). Never throws: a failed
 * count must not touch the step's result.
 */
async function recordStep($: Engine, e: TurnStepInput, result: TurnStepResult): Promise<void> {
  try {
    const usage = result.usage
    const model = typeof usage?.model === 'string' && lineOf(usage.model) !== undefined ? usage.model : e.model
    await recordUsage($, e.agentId === undefined ? 'main' : 'subagent', model, usage)
  } catch {
    // The response is already read; the ledger alone is short one request.
  }
}

/**
 * The effort /effort saves: the overall level and the per-model ones. Undefined
 * when the settings can't be read, which counts as a change.
 */
async function savedEffort($: Engine): Promise<string | undefined> {
  try {
    const settings = await $.settings.read()
    return JSON.stringify([settings.effortLevel, settings.modelSettings])
  } catch {
    return undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'vites',
        description: 'Vites: her prompt için modeli ve eforu seçer (aç, kapat, durum, tavan, günlük, rapor)',
        argumentHint: 'aç|kapat|durum|tavan|günlük|rapor',
      })
      // Every new session starts on. A session that is already on keeps its saved
      // "previous" model; turning on again would overwrite it with the auto pick.
      // The held gear belongs to the session, so it starts over either way.
      if (!(await isEnabled($))) await turnOn($)
      else {
        await update($, enabled, () => true)
        await resetGear($)
      }
    } catch {
      // The command or the chip may be missing this session; prompts still go through.
    }

    return next(e)
  })

  on('command.run', { command: 'vites' }, async ($, e) => {
    try {
      return { text: await runCommand($, e.args) }
    } catch {
      return { text: FAILED }
    }
  }).catch(() => ({ text: FAILED }))

  // Tags at the start of a typed prompt set the gear and are taken out of the text
  // the model reads; a prompt that is nothing but tags goes through as typed
  // (an empty prompt would be refused). Off, tags are plain text.
  on('prompt.submit', async ($, e, next) => {
    let text = e.text
    try {
      if (isTypedWhileIdle(e) && (await isEnabled($))) {
        const tags = parseTags(e.text)
        const isTagged = tags.line !== undefined || tags.effort !== undefined
        // A tag is the person's own choice, so it is honoured even on a short reply.
        if (isTagged || !isShortReply(e.text)) {
          await pickModel($, isTagged ? tags.text : e.text, tags)
          if (isTagged && tags.text !== '') text = tags.text
        }
      }
    } catch {
      // Any failure keeps the current model; the prompt always goes through.
    }

    return next(text === e.text ? e : { ...e, text })
  }).catch(($, e, next) => next(e))

  on('config.set', { key: MODEL_KEY }, async ($, e, next) => {
    const result = await next(e)
    const isPersons = e.origin.kind === 'composer' || e.origin.kind === 'bridge'

    if (result.deny === undefined && isPersons) {
      try {
        if (await isEnabled($)) {
          await turnOff($, false)
          $.ui.toast(`Vites kapandı, çünkü model elle ${String(e.value)} yapıldı. /vites aç ile tekrar açılır.`)
        }
      } catch {
        // The person's own pick has landed either way.
      }
    }

    return result
  }).catch(($, e, next) => next(e))

  // Subagents get the same effort as the main loop but keep their own model.
  // A model that takes no effort is sent none. Once the response is in, its
  // usage is counted: `e.agentId` is absent on the main loop and names the
  // subagent otherwise, so that marker (not the model line) tells the two apart.
  on('turn.step', async function* ($, e, next) {
    const effort = e.effort !== undefined ? await effortToSend($) : undefined

    const result = yield* next(effort === undefined || effort === e.effort ? e : { ...e, effort })
    await recordStep($, e, result)

    return result
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  // An effort set by hand wins, as a model picked by hand does. A bare /effort
  // opens a menu that can be cancelled, so it counts only if the saved effort moved.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const args = e.args.trim().toLowerCase()
    const before = args === '' ? await savedEffort($) : undefined
    const result = await next(e)
    const isPersons = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const isEffortChange =
      !args.startsWith('ultracode') && (args !== '' || before === undefined || (await savedEffort($)) !== before)

    if (isPersons && isEffortChange) {
      try {
        if (await isEnabled($)) {
          await turnOff($, false)
          $.ui.toast('Vites kapandı, elle seçtiğin efor kalır. /vites aç ile tekrar açılır.')
        }
      } catch {
        // The person's own effort has landed either way.
      }
    }

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const isOn = await read($, enabled)
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80
    const label = chipLabel(isOn, columns)
    const modes = e.props.modes.join(' & ')

    return (
      <Box flexDirection="row">
        {modes !== '' && (
          <Box flexShrink={1}>
            <Text color={MUTED} wrap="truncate-end">
              {modes}{' '}
            </Text>
          </Box>
        )}
        <Box flexShrink={0}>
          <Button key="vites-toggle" label={label.trim()} plain onPress={() => toggle($)}>
            <Text color={isOn ? INK : LIGHT} backgroundColor={isOn ? GOLD : SLATE} bold={isOn}>
              {label}
            </Text>
          </Button>
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
