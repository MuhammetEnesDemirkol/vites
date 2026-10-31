import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, PromptSubmitInput, Register } from 'claude-code'

import type { Effort, LastPick } from '../types'
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

const MODEL_KEY = 'model'
const GOLD = '#F2C46D'
const SLATE = '#262B33'
const INK = '#0D1117'
const LIGHT = '#E6EDF3'
const MUTED = '#7D8590'

const USAGE = 'Komutlar: aç, kapat, durum, tavan, günlük, rapor.'
const FAILED = 'Vites şu an bunu yapamadı. Hiçbir şey değişmedi.'

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
    const how = pick.isGuess ? 'kelimelerden tahmin' : 'küçük model seçti'
    const effort = isEffort(pick.effort) ? ` · ${effortTr(pick.effort)}` : ''
    lines.push(`Son seçim: ${pick.gear}. vites · ${pick.model}${effort} (${how}).`)
  }
  if (typeof previous === 'string') lines.push(`Kapatınca ${previous} geri gelir.`)

  return lines.join(' ')
}

/** Routes on the folded first word, so "aç", "ac" and "on" are the same case. */
async function runCommand($: Engine, args: string): Promise<string> {
  const word = fold(args).trim().split(/\s+/)[0] ?? ''

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

/** The small model's answer for the prompt, or undefined when it gave none in time. */
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

async function pickModel($: Engine, text: string): Promise<void> {
  const row = await modelRow($)
  if (row === undefined || row.isLocked) return

  const current = asText(row.value)
  // A hand pick (/model, the picker) arrives through the config.set hook below and turns
  // Vites off there. A model that differs here without that (a reset after /compact,
  // another window sharing the setting) is drift, so Vites stays on and sorts again.
  const options = row.options ?? []
  const answer = await askSmallModel($, text, options)
  const answered = answer === undefined ? undefined : parseLevel(answer)
  const level = answered ?? guessLevel(text)
  // An effort the person named in the prompt wins over the small model's.
  const effort =
    namedEffort(text) ?? (answer === undefined ? undefined : parseEffort(answer)) ?? guessEffort(text, level)

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
    isGuess: answered === undefined,
    gear: gearNumber(level),
    source: answered === undefined ? 'keywords' : 'classifier',
    flags: [],
  }
  await update($, last, () => pick)
  // Read by the person's status bar, which shows the saved effort, not the one sent.
  await $.store.set('effort', effort)
  showLine($, pick, true)
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
      if (!(await isEnabled($))) await turnOn($)
      else await update($, enabled, () => true)
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

  on('prompt.submit', async ($, e, next) => {
    try {
      if (isTypedWhileIdle(e) && !isShortReply(e.text) && (await isEnabled($))) {
        await pickModel($, e.text)
      }
    } catch {
      // Any failure keeps the current model; the prompt always goes through.
    }

    return next(e)
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
  // A model that takes no effort is sent none.
  on('turn.step', async function* ($, e, next) {
    const effort = e.effort !== undefined ? await effortToSend($) : undefined

    return yield* next(effort === undefined || effort === e.effort ? e : { ...e, effort })
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
