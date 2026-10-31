import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'

import type { LastPick } from '../types'
import { INITIAL_GEAR } from './gear'
import { localDay } from './usage'
import {
  candidatesFor,
  chipLabel,
  effortTr,
  gearNumber,
  guessEffort,
  guessLevel,
  isShortReply,
  namedEffort,
  parseEffort,
  parseLevel,
  statusLine,
} from './logic'

const PLUGIN = 'vites'
const OPTIONS = ['Default (recommended)', 'fable', 'opus', 'opus[1m]', 'sonnet', 'sonnet[1m]', 'haiku']
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const SOME = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }
const PRESENTATION = { isFullscreen: false, columns: 100 }
const USAGE = 'Komutlar: aç, kapat, durum, tavan, günlük, rapor.'

type World = {
  model: string
  sets: string[]
  asked: number
  sent: TurnStepInput['effort'][]
  saved: Record<string, unknown>
  store: Map<string, unknown>
}

type Setup = {
  model: string
  answer?: string
  store?: Record<string, unknown>
  refuse?: string
  isBroken?: boolean
  picked?: string
  writes?: string[]
  usage?: typeof ZERO
  failKey?: string
}

/**
 * Stands in for the engine beneath the mod: the /config model row, the quick check, the store, the requests,
 * the saved effort. `picked` is what the bare /effort menu chooses; left out, the menu is cancelled.
 * `answer` is read on each call, so a test may change it between prompts. `usage` is what each request and
 * each quick check reports; left out, requests report none. `failKey` is a store key whose writes throw.
 * The store is the world's own map, so a test can read what the mod kept; `writes` notes each write to
 * the status bar's effort.
 */
function world(on: On, setup: Setup): World {
  const kept = new Map(Object.entries(setup.store ?? {}))
  const seen: World = { model: setup.model, sets: [], asked: 0, sent: [], saved: { effortLevel: 'xhigh' }, store: kept }
  const log = setup.writes ?? []

  on('store.get', ($, e) => ({ value: kept.get(e.key) }))
  on('store.keys', () => ({ value: [...kept.keys()] }))
  on('store.set', ($, e) => {
    if (e.key === setup.failKey) throw new Error('disk full')
    kept.set(e.key, e.value)
    if (e.key === 'effort') log.push(`set ${String(e.value)}`)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    kept.delete(e.key)
    if (e.key === 'effort') log.push('delete')
    return { value: undefined }
  })
  on('config.list', () => {
    if (setup.isBroken === true) throw new Error('settings unreadable')
    const row = {
      key: 'model',
      label: 'Model',
      kind: 'choice' as const,
      value: seen.model,
      options: OPTIONS,
      provider: { plugin: 'engine', tier: 'core' as const },
      isLocked: false,
    }
    return { value: [row] }
  })
  on('config.set', ($, e) => {
    if (e.value === setup.refuse) return { deny: 'not on this plan' }
    seen.sets.push(String(e.value))
    seen.model = String(e.value)
    return { value: e.value }
  })
  on('model.complete', () => {
    seen.asked += 1
    const usage = setup.usage ?? ZERO
    return {
      value:
        setup.answer === undefined
          ? { isAnswered: false as const, reason: 'aborted' as const, usage }
          : { isAnswered: true as const, text: setup.answer, usage },
    }
  })
  on('session.model', () => ({ value: seen.model }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'vites' } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.step', async function* ($, e) {
    seen.sent.push(e.effort)
    const usage = setup.usage === undefined ? null : { ...setup.usage, model: e.model }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  on('settings.read', () => ({ value: seen.saved }))
  on('command.run', { command: 'effort' }, ($, e) => {
    const level = e.args === '' ? setup.picked : e.args
    if (level === undefined) return { text: 'Cancelled' }
    seen.saved = { effortLevel: level }
    return { text: `Set effort level to ${level}` }
  })

  return seen
}

/** One model request of the main loop (or a subagent's), read to its end. */
async function step($: Engine, input: Partial<TurnStepInput> = {}): Promise<void> {
  const stream = $.turn.step({ turnId: 'turn-1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1, ...input })
  for await (const _chunk of stream) {
    // The bottom yields nothing; reading drains it.
  }
  await stream.result
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const command = (args: string) => ({
  command: 'vites',
  args,
  origin: { kind: 'composer' as const },
  presentation: PRESENTATION,
})

describe('reading the one-word answer', () => {
  test('finds the level in a short reply, the longer word first', async () => {
    expect(parseLevel('strong')).toBe('strong')
    expect(parseLevel('Strongest.')).toBe('strongest')
    expect(parseLevel(' small\n')).toBe('small')
    expect(parseLevel('Everyday')).toBe('everyday')
    expect(parseLevel('I would say small')).toBe('small')
    expect(parseLevel('banana')).toBeUndefined()
    expect(parseLevel('')).toBeUndefined()
  })
})

describe('spotting a short reply', () => {
  test('under four words, or only go-ahead words, is a short reply', async () => {
    expect(isShortReply('yes')).toBe(true)
    expect(isShortReply('ok')).toBe(true)
    expect(isShortReply('keep going')).toBe(true)
    expect(isShortReply('do it')).toBe(true)
    expect(isShortReply('fix the tests')).toBe(true)
    expect(isShortReply('yes please keep going with that now')).toBe(true)
    expect(isShortReply('Refactor the billing service to use the new API')).toBe(false)
    expect(isShortReply('ok now build the login page')).toBe(false)
  })
})

describe('Turkish prompts', () => {
  test('short Turkish replies are left alone, real requests are not', async () => {
    expect(isShortReply('tamam devam et')).toBe(true)
    expect(isShortReply('Evet, aynen öyle yap')).toBe(false)
    expect(isShortReply('evet tamam devam et lütfen')).toBe(true)
    expect(isShortReply('Faturalama servisini yeni API kullanacak şekilde yeniden düzenle')).toBe(false)
  })

  test('the fallback reads Turkish letters and word endings', async () => {
    expect(guessLevel('Bu paragrafı Fransızcaya çevir')).toBe('small')
    expect(guessLevel('Şu e-posta yazışmasını özetler misin')).toBe('small')
    expect(guessLevel('Ev sahibime ısıtma hakkında bir e-posta yazar mısın')).toBe('everyday')
    expect(guessLevel('Avustralya\'nın başkenti neresi?')).toBe('strong')
    expect(guessLevel('Kim kazandı')).toBe('small')
    expect(guessLevel('Ödeme servisini yeniden düzenle ve testleri ekle')).toBe('strong')
    expect(guessLevel('Tüm kod tabanını Python 2\'den Python 3\'e taşı')).toBe('strongest')
    expect(guessLevel('İSTANBUL ŞUBESİ İÇİN HATA AYIKLA')).toBe('strong')
  })

  test('effort follows Turkish hints and named levels', async () => {
    expect(namedEffort('yüksek efor ile bak')).toBe('high')
    expect(namedEffort('çok yüksek çaba göster')).toBe('xhigh')
    expect(namedEffort('elinden geldiğince derin düşün')).toBe('max')
    expect(namedEffort('Ödeme servisini yeniden düzenle')).toBeUndefined()
    expect(guessEffort('Bu yarış durumunun kök nedenini bul', 'strong')).toBe('xhigh')
    expect(guessEffort('Hızlıca bir log satırı ekle', 'strong')).toBe('medium')
  })
})

describe('the word-based fallback', () => {
  test('guesses from the words and says strong when in doubt', async () => {
    expect(guessLevel('Translate this paragraph into French')).toBe('small')
    expect(guessLevel('Summarize this email thread for me')).toBe('small')
    expect(guessLevel('Write a short email to my landlord about the heating')).toBe('everyday')
    expect(guessLevel('What is the capital of Australia?')).toBe('small')
    expect(guessLevel('Refactor the payment service and add tests')).toBe('strong')
    expect(guessLevel('Migrate the entire codebase from Python 2 to Python 3')).toBe('strongest')
    expect(guessLevel('hmm, thinking about that thing we discussed yesterday')).toBe('strong')
  })

  test('is used when the quick check gives no answer', async ($, on) => {
    const seen = world(on, { model: 'opus', store: { enabled: true } })

    await $.prompt.submit(typed('Translate this paragraph into French for the newsletter'))

    expect(seen.asked).toBe(1)
    expect(seen.sets).toEqual(['haiku'])
  })

  test('steps down a line when a level has no model in the install', async () => {
    expect(candidatesFor('strongest', ['opus', 'sonnet', 'haiku'])).toEqual(['opus', 'sonnet', 'haiku'])
    expect(candidatesFor('small', ['sonnet', 'opus'])).toEqual(['sonnet', 'opus'])
    expect(candidatesFor('everyday', OPTIONS)[0]).toBe('sonnet')
  })
})

describe('gears and Turkish effort words', () => {
  test('each level has a gear number, smallest first', () => {
    expect(gearNumber('small')).toBe(1)
    expect(gearNumber('everyday')).toBe(2)
    expect(gearNumber('strong')).toBe(3)
    expect(gearNumber('strongest')).toBe(4)
  })

  test('each effort has a Turkish word', () => {
    expect(effortTr('low')).toBe('düşük')
    expect(effortTr('medium')).toBe('orta')
    expect(effortTr('high')).toBe('yüksek')
    expect(effortTr('xhigh')).toBe('çok yüksek')
    expect(effortTr('max')).toBe('maks')
  })
})

describe('switching on a new prompt', () => {
  test('a typed prompt moves the model to the level the small model named', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'everyday', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Write a short post announcing our new opening hours'))

    expect(seen.asked).toBe(1)
    expect(seen.sets).toEqual(['sonnet'])
  })

  test('a model the plan refuses steps down to the next one', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strongest', store: { enabled: true }, refuse: 'fable' })

    await $.prompt.submit(typed('Plan and carry out a migration of every service to the new queue'))

    expect(seen.sets).toEqual(['opus'])
  })
})

describe('staying out of the way', () => {
  test('a short reply keeps the current model', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small', store: { enabled: true } })

    await $.prompt.submit(typed('ok keep going'))

    expect(seen.asked).toBe(0)
    expect(seen.sets).toEqual([])
    expect(seen.model).toBe('opus')
  })

  test('slash commands, messages sent mid-turn and switched-off sessions are never sorted', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small', store: { enabled: true } })

    await $.prompt.submit(typed('/review the whole pull request carefully please'))
    await $.prompt.submit({ ...typed('also translate the README into Spanish'), turnId: 'turn-1' })
    await $.command.run(command('kapat'))
    await $.prompt.submit(typed('Translate the README into Spanish for the docs site'))

    expect(seen.asked).toBe(0)
  })

  test('a model picked by hand turns Vites off', async ($, on) => {
    world(on, { model: 'haiku', store: { enabled: true, previous: 'opus', applied: 'haiku' } })

    await $.config.set({
      key: 'model',
      value: 'sonnet',
      previous: 'haiku',
      provider: { plugin: 'engine', tier: 'core' },
      origin: { kind: 'composer' },
    })
    const after = await $.command.run(command('durum'))

    expect(after.text).toBe('Vites kapalı. Model sonnet.')
  })
})

describe('a model that moved without a hand pick', () => {
  test('keeps Vites on and sorts the prompt again', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small', store: { enabled: true, previous: 'sonnet', applied: 'sonnet' } })

    await $.prompt.submit(typed('Rename the variable foo to bar in utils'))
    const after = await $.command.run(command('durum'))

    expect(seen.sets).toEqual(['haiku'])
    expect(after.text).toContain('Vites açık.')
  })
})

describe('going back to the earlier model when turned off', () => {
  test('kapat puts back the model in use before Vites was turned on', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong' })

    const on1 = await $.command.run(command('aç'))
    await $.prompt.submit(typed('Build a CSV import for the customers table with tests'))
    const off = await $.command.run(command('kapat'))

    expect(on1.text).toBe('Vites açık. Kapatınca sonnet geri gelir.')
    expect(seen.sets).toEqual(['opus', 'sonnet'])
    expect(off.text).toBe('Vites kapalı. Model sonnet olarak geri alındı.')
  })

  test('a failing command answers with a sentence', async ($, on) => {
    world(on, { model: 'opus', isBroken: true })

    const answer = await $.command.run(command('aç'))

    expect(answer.text).toBe('Vites şu an bunu yapamadı. Hiçbir şey değişmedi.')
  })
})

describe('the command words', () => {
  for (const word of ['ac', 'aç', 'on']) {
    test(`"${word}" turns it on`, async ($, on) => {
      const seen = world(on, { model: 'sonnet' })

      const answer = await $.command.run(command(word))
      const after = await $.command.run(command('durum'))

      expect(answer.text).toBe('Vites açık. Kapatınca sonnet geri gelir.')
      expect(after.text).toBe('Vites açık. Model sonnet. Tavan opus. Kapatınca sonnet geri gelir.')
      expect(seen.sets).toEqual([])
    })
  }

  test('kapat and off both turn it off; durum, status and no word all report', async ($, on) => {
    world(on, { model: 'opus', store: { enabled: true, previous: 'opus' } })

    expect((await $.command.run(command('off'))).text).toBe('Vites kapalı. Model opus, önceki gibi.')
    expect((await $.command.run(command('kapat'))).text).toBe('Vites zaten kapalı.')
    expect((await $.command.run(command('status'))).text).toBe('Vites kapalı. Model opus.')
    expect((await $.command.run(command(''))).text).toBe('Vites kapalı. Model opus.')
    expect((await $.command.run(command('  durum  '))).text).toBe('Vites kapalı. Model opus.')
  })

  test('an unknown word gets the usage sentence and changes nothing', async ($, on) => {
    const seen = world(on, { model: 'opus', store: { enabled: true, previous: 'sonnet' } })

    const answer = await $.command.run(command('xyz'))
    const after = await $.command.run(command('durum'))

    expect(answer.text).toBe(`Vites "xyz" komutunu bilmiyor. ${USAGE} Hiçbir şey değişmedi.`)
    expect(after.text).toBe('Vites açık. Model opus. Tavan opus. Kapatınca sonnet geri gelir.')
    expect(seen.sets).toEqual([])
  })
})

describe('reading the effort', () => {
  test('finds the effort after the level, extra high and maximum included', async () => {
    expect(parseEffort('strong high')).toBe('high')
    expect(parseEffort('Strongest xhigh.')).toBe('xhigh')
    expect(parseEffort('strong extra high')).toBe('xhigh')
    expect(parseEffort('strongest x-high')).toBe('xhigh')
    expect(parseEffort('strongest maximum')).toBe('max')
    expect(parseEffort('small low\n')).toBe('low')
    expect(parseEffort('strong')).toBeUndefined()
  })

  test('takes an effort the person named in the prompt', async () => {
    expect(namedEffort('Refactor the parser, use max effort')).toBe('max')
    expect(namedEffort('ultrathink about the cache design')).toBe('max')
    expect(namedEffort('low effort is fine, just rename the file')).toBe('low')
    expect(namedEffort('Refactor the parser')).toBeUndefined()
  })

  test('guesses from the level and steps up or down on the words', async () => {
    expect(guessEffort('Translate this paragraph into French', 'small')).toBe('low')
    expect(guessEffort('Write a short email to my landlord', 'everyday')).toBe('medium')
    expect(guessEffort('Refactor the payment service and add tests', 'strong')).toBe('high')
    expect(guessEffort('Find the root cause of this race condition', 'strong')).toBe('xhigh')
    expect(guessEffort('Quickly add a log line to the handler', 'strong')).toBe('medium')
    expect(guessEffort('Migrate the entire codebase to Python 3', 'strongest')).toBe('xhigh')
    expect(guessEffort('Translate this, quickly', 'small')).toBe('low')
  })
})

describe('sending the effort with the model', () => {
  test('a typed prompt gets the model and the effort the small model named', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'everyday medium', store: { enabled: true } })

    await $.prompt.submit(typed('Write a short post announcing our new opening hours'))
    await step($, { effort: 'high' })

    expect(seen.sets).toEqual(['sonnet'])
    expect(seen.sent).toEqual(['medium'])
  })

  test('a strong model can still be sent a high effort rather than the saved one', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong high', store: { enabled: true } })

    await $.prompt.submit(typed('Debug why the checkout total is off by one cent'))
    await step($, { model: 'claude-opus-5-5', effort: 'xhigh' })

    expect(seen.sets).toEqual(['opus'])
    expect(seen.sent).toEqual(['high'])
  })

  test('the words decide the effort when the quick check gives no answer', async ($, on) => {
    const seen = world(on, { model: 'opus', store: { enabled: true } })

    await $.prompt.submit(typed('Translate this paragraph into French for the newsletter'))
    await step($, { model: 'claude-haiku-5-5', effort: 'medium' })

    expect(seen.sets).toEqual(['haiku'])
    expect(seen.sent).toEqual(['low'])
  })

  test('a one-word answer from the small model still gets an effort', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong', store: { enabled: true } })

    await $.prompt.submit(typed('Refactor the payment service and add tests'))
    await step($)

    expect(seen.sent).toEqual(['high'])
  })

  test('an effort named in the prompt beats the small model', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong high', store: { enabled: true } })

    await $.prompt.submit(typed('Review the auth middleware for holes, use max effort'))
    await step($)

    expect(seen.sent).toEqual(['max'])
  })

  test('a short reply keeps the effort the last prompt got', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'strongest xhigh', store: { enabled: true } })

    await $.prompt.submit(typed('Plan and carry out a migration of every service to the new queue'))
    await step($)
    await $.prompt.submit(typed('ok keep going'))
    await step($, { index: 1 })

    expect(seen.asked).toBe(1)
    expect(seen.sent).toEqual(['xhigh', 'xhigh'])
  })

  test('subagents get the same effort, and a model without an effort setting is left alone', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small low', store: { enabled: true } })

    await $.prompt.submit(typed('Summarize this changelog into three bullet points'))
    await step($, { agentId: 'agent-1', effort: 'high' })
    await step($, { agentId: 'agent-1', effort: undefined })
    await step($, { effort: undefined })

    expect(seen.sent).toEqual(['low', undefined, undefined])
  })

  test('nothing is changed while Vites is off or before a prompt is sorted', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small low' })

    await step($, { effort: 'xhigh' })
    await $.command.run(command('aç'))
    await step($, { effort: 'xhigh' })
    await $.prompt.submit(typed('Summarize this changelog into three bullet points'))
    await step($, { effort: 'xhigh' })
    await $.command.run(command('kapat'))
    await step($, { effort: 'xhigh' })

    expect(seen.sent).toEqual(['xhigh', 'xhigh', 'low', 'xhigh'])
  })

  test('an effort set by hand turns Vites off and keeps that effort', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small low', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Summarize this changelog into three bullet points'))
    await $.command.run({ ...command('max'), command: 'effort' })
    await step($, { model: 'claude-haiku-5-5', effort: 'max' })
    const after = await $.command.run(command('durum'))

    expect(seen.sent).toEqual(['max'])
    expect(seen.model).toBe('haiku')
    expect(after.text).toBe('Vites kapalı. Model haiku.')
  })

  test('the effort sent is kept in the store for the status bar, and dropped when off', async ($, on) => {
    const writes: string[] = []
    world(on, { model: 'opus', answer: 'strong high', store: { enabled: true, previous: 'opus' }, writes })

    await $.prompt.submit(typed('Design the retry policy for the sync worker'))
    await $.command.run(command('kapat'))

    expect(writes).toEqual(['set high', 'delete'])
  })

  test('opening the /effort menu and cancelling it leaves Vites on', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'strong high', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Design the retry policy for the sync worker'))
    await $.command.run({ ...command(''), command: 'effort' })
    await step($, { model: 'claude-opus-5-5', effort: 'xhigh' })

    expect(seen.sent).toEqual(['high'])
  })

  test('a level picked in the /effort menu turns Vites off', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'strong high', picked: 'max', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Design the retry policy for the sync worker'))
    await $.command.run({ ...command(''), command: 'effort' })
    await step($, { model: 'claude-opus-5-5', effort: 'max' })
    const after = await $.command.run(command('durum'))

    expect(seen.sent).toEqual(['max'])
    expect(after.text).toBe('Vites kapalı. Model opus.')
  })

  test('durum names the gear, model and effort the last prompt ran at', async ($, on) => {
    world(on, { model: 'opus', answer: 'everyday medium', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Write a short post announcing our new opening hours'))
    const answer = await $.command.run(command('durum'))

    expect(answer.text).toBe(
      'Vites açık. Model sonnet. Son seçim: 2. vites · sonnet · orta (küçük model seçti). Tavan opus. Kapatınca opus geri gelir.',
    )
  })

  test('durum says when the words made the guess', async ($, on) => {
    world(on, { model: 'opus', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Translate this paragraph into French for the newsletter'))
    const answer = await $.command.run(command('durum'))

    expect(answer.text).toBe(
      'Vites açık. Model haiku. Son seçim: 1. vites · haiku · düşük (kelimelerden tahmin). Tavan opus. Kapatınca opus geri gelir.',
    )
  })
})

const BIG = 'Plan and carry out a migration of every service to the new queue'
const LIGHT = 'Translate this paragraph into French for the newsletter'

type Entry = { source: string; flags: string[] }

describe('the cost ceiling', () => {
  test('an automatic strongest pick stops at opus by default and is marked capped', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strongest xhigh', store: { enabled: true } })

    await $.prompt.submit(typed(BIG))
    const journal = seen.store.get('journal') as Entry[]
    const after = await $.command.run(command('durum'))

    expect(seen.sets).toEqual(['opus'])
    expect(journal[0]?.flags).toContain('capped')
    expect(after.text).toContain('tavana takıldı')
  })

  test('tavan yok lifts the ceiling, so strongest reaches fable', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strongest xhigh', store: { enabled: true } })

    const answer = await $.command.run(command('tavan yok'))
    await $.prompt.submit(typed(BIG))

    expect(seen.store.get('ceiling')).toBe('yok')
    expect(answer.text).toContain('fable')
    expect(seen.sets).toEqual(['fable'])
  })

  test('tavan alone names the ceiling, an unknown word changes nothing', async ($, on) => {
    const seen = world(on, { model: 'sonnet', store: { enabled: true } })

    const bare = await $.command.run(command('tavan'))
    const bad = await $.command.run(command('tavan banana'))
    expect(seen.store.has('ceiling')).toBe(false)
    const set = await $.command.run(command('tavan Sonnet'))

    expect(bare.text).toBe('Tavan opus. Otomatik seçim bunun üstüne çıkmaz; etiketler çıkabilir.')
    expect(bad.text).toBe('Vites "banana" tavanını bilmiyor. Tavan haiku, sonnet, opus, fable veya yok olabilir. Hiçbir şey değişmedi.')
    expect(set.text).toBe('Tavan sonnet. Otomatik seçim bunun üstüne çıkmaz; etiketler çıkabilir.')
    expect(seen.store.get('ceiling')).toBe('sonnet')
  })
})

describe('delayed downshift', () => {
  test('two light picks after a strong one are held; the third drops', async ($, on) => {
    const setup: Setup = { model: 'sonnet', answer: 'strong high', store: { enabled: true } }
    const seen = world(on, setup)

    await $.prompt.submit(typed('Debug why the checkout total is off by one cent'))
    setup.answer = 'small low'
    await $.prompt.submit(typed(LIGHT))
    await step($, { model: 'claude-opus-5-5', effort: 'medium' })
    const held = await $.command.run(command('durum'))
    await $.prompt.submit(typed(LIGHT))
    expect(seen.sets).toEqual(['opus'])
    await $.prompt.submit(typed(LIGHT))

    expect(seen.sets).toEqual(['opus', 'haiku'])
    expect(seen.sent).toEqual(['high'])
    expect(held.text).toContain('tutuluyor')
  })

  test('kapat then aç, and a new session, start the hold over', async ($, on) => {
    const setup: Setup = { model: 'sonnet', answer: 'strong high', store: { enabled: true, previous: 'sonnet' } }
    const seen = world(on, setup)
    const streak = () => (seen.store.get('gear') as { streak: unknown[] }).streak.length

    await $.prompt.submit(typed('Debug why the checkout total is off by one cent'))
    setup.answer = 'small low'
    await $.prompt.submit(typed(LIGHT))
    expect(streak()).toBe(1)

    await $.command.run(command('kapat'))
    await $.command.run(command('aç'))
    expect(seen.store.get('gear')).toEqual(INITIAL_GEAR)

    setup.answer = 'strong high'
    await $.prompt.submit(typed('Debug why the checkout total is off by one cent'))
    setup.answer = 'small low'
    await $.prompt.submit(typed(LIGHT))
    expect(streak()).toBe(1)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(seen.store.get('gear')).toEqual(INITIAL_GEAR)
  })
})

describe('gear tags', () => {
  test('a model tag skips the quick check, sets the model and leaves the tag out of the text', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'small low', store: { enabled: true } })

    const result = await $.prompt.submit(typed('#fable büyük refactor'))
    const after = await $.command.run(command('durum'))

    expect(seen.asked).toBe(0)
    expect(seen.sets).toEqual(['fable'])
    expect(result.text).toBe('büyük refactor')
    expect(after.text).toContain('Vites açık.')
    expect(after.text).toContain('etiket')
  })

  test('a prompt that is only a tag switches the model and goes through unchanged', async ($, on) => {
    const seen = world(on, { model: 'sonnet', store: { enabled: true } })

    const result = await $.prompt.submit(typed('#opus'))

    expect(seen.sets).toEqual(['opus'])
    expect(result.text).toBe('#opus')
  })

  test('a tag followed only by spaces goes through exactly as typed', async ($, on) => {
    const seen = world(on, { model: 'sonnet', store: { enabled: true } })

    const result = await $.prompt.submit(typed('#opus   '))

    expect(seen.sets).toEqual(['opus'])
    expect(seen.asked).toBe(0)
    expect(result.text).toBe('#opus   ')
  })

  test('a word that names an Object member is plain text and the model stays', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'small low', store: { enabled: true } })

    const result = await $.prompt.submit(typed('#constructor merhaba, bunu açıklar mısın'))

    expect(seen.asked).toBe(1)
    expect(seen.sets).toEqual(['haiku'])
    expect(result.text).toBe('#constructor merhaba, bunu açıklar mısın')
  })

  test('tags are plain text while Vites is off', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong high' })

    const result = await $.prompt.submit(typed('#opus test et'))

    expect(seen.sets).toEqual([])
    expect(seen.asked).toBe(0)
    expect(result.text).toBe('#opus test et')
  })

  test('an effort tag alone fixes the effort and still asks for the level', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small low', store: { enabled: true } })

    const result = await $.prompt.submit(typed('#yüksek şu hatayı düzelt'))
    await step($, { model: 'claude-haiku-5-5', effort: 'medium' })

    expect(seen.asked).toBe(1)
    expect(seen.sets).toEqual(['haiku'])
    expect(seen.sent).toEqual(['high'])
    expect(result.text).toBe('şu hatayı düzelt')
  })

  test('a tagged gear holds above the ceiling until it drops', async ($, on) => {
    const setup: Setup = { model: 'sonnet', answer: 'small low', store: { enabled: true } }
    const seen = world(on, setup)

    await $.prompt.submit(typed('#fable büyük refactor'))
    await $.prompt.submit(typed(LIGHT))
    await $.prompt.submit(typed(LIGHT))
    expect(seen.sets).toEqual(['fable'])
    await $.prompt.submit(typed(LIGHT))

    expect(seen.sets).toEqual(['fable', 'haiku'])
  })
})

describe('the pick journal', () => {
  test('each sorted prompt adds an entry with its source; günlük lists the newest', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong high', store: { enabled: true } })

    await $.prompt.submit(typed('Debug why the checkout total is off by one cent'))
    await $.prompt.submit(typed('#haiku ' + LIGHT))
    const journal = seen.store.get('journal') as Entry[]
    const one = await $.command.run(command('günlük 1'))
    const all = await $.command.run(command('gunluk'))

    expect(journal.map(entry => entry.source)).toEqual(['classifier', 'tag'])
    expect(one.text.split('\n')).toHaveLength(1)
    expect(one.text).toContain('haiku')
    expect(all.text.split('\n')).toHaveLength(2)
  })

  test('a journal write that fails leaves the switch made and the prompt on its way', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong high', store: { enabled: true }, failKey: 'journal' })

    const result = await $.prompt.submit(typed('Debug why the checkout total is off by one cent'))
    const after = await $.command.run(command('durum'))

    expect(seen.sets).toEqual(['opus'])
    expect(result.text).toBe('Debug why the checkout total is off by one cent')
    expect(after.text).toContain('3. vites · opus')
  })
})

describe('the usage book', () => {
  const today = localDay(new Date())

  test('requests of the main loop and of subagents are counted under their line', async ($, on) => {
    const seen = world(on, { model: 'sonnet', store: { enabled: true, previous: 'opus' }, usage: SOME })

    await step($, { model: 'claude-sonnet-5-5' })
    await step($, { model: 'claude-sonnet-5-5', index: 1 })
    await step($, { model: 'claude-haiku-5-5', agentId: 'agent-1' })
    const book = seen.store.get('usage') as Record<string, { baseline: string; rows: Record<string, { input: number }> }>

    expect(book[today]?.baseline).toBe('opus')
    expect(book[today]?.rows['main:sonnet']?.input).toBe(200)
    expect(book[today]?.rows['subagent:haiku']?.input).toBe(100)
  })

  test('the quick check is counted as the classifier', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong high', store: { enabled: true }, usage: SOME })

    await $.prompt.submit(typed('Debug why the checkout total is off by one cent'))
    const book = seen.store.get('usage') as Record<string, { rows: Record<string, { input: number }> }>

    expect(book[today]?.rows['classifier:haiku']?.input).toBe(100)
  })

  test('nothing is counted while off, without usage, or for a model on no known line', async ($, on) => {
    const seen = world(on, { model: 'sonnet', store: { enabled: true }, usage: SOME })

    await step($, { model: 'claude-x-1' })
    expect(seen.store.has('usage')).toBe(false)

    await $.command.run(command('kapat'))
    await step($, { model: 'claude-sonnet-5-5' })
    expect(seen.store.has('usage')).toBe(false)
  })

  test('a request that reports no usage is left alone', async ($, on) => {
    const seen = world(on, { model: 'sonnet', store: { enabled: true } })

    await step($, { model: 'claude-sonnet-5-5' })

    expect(seen.store.has('usage')).toBe(false)
  })
})

describe('the savings report', () => {
  test('rapor prices the book, and an unknown period is refused', async ($, on) => {
    const today = localDay(new Date())
    const rows = { 'main:haiku': { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } }
    world(on, { model: 'sonnet', store: { enabled: true, usage: { [today]: { baseline: 'opus', rows } } } })

    const report = await $.command.run(command('rapor'))
    const bad = await $.command.run(command('rapor yarın'))

    expect(report.text).toContain('$')
    expect(report.text).toContain('Tasarruf')
    expect(bad.text).toBe('Vites "yarın" dönemini bilmiyor. Dönem bugün, hafta, ay veya tümü olabilir. Hiçbir şey değişmedi.')
  })
})

describe('the line under the prompt', () => {
  test('names the gear, model and effort of the last prompt while on, and clears when off', () => {
    const pick: LastPick = {
      level: 'strong',
      effort: 'high',
      model: 'opus',
      isGuess: true,
      gear: 3,
      source: 'keywords',
      flags: [],
    }

    expect(statusLine(true, pick)).toBe('3. vites · opus · yüksek')
    expect(statusLine(true, { ...pick, level: 'strongest', effort: 'xhigh', model: 'fable', gear: 4 })).toBe('4. vites · fable · çok yüksek')
    expect(statusLine(true, null)).toBeUndefined()
    expect(statusLine(false, pick)).toBeUndefined()
  })
})

describe('the status bar chip', () => {
  test('says only whether it is on, in a wide and a narrow footer', () => {
    expect(chipLabel(true, 120)).toBe(' Vites: Açık ')
    expect(chipLabel(false, 120)).toBe(' Vites: Kapalı ')
    expect(chipLabel(true, 40)).toBe(' V: Açık ')
    expect(chipLabel(false, 40)).toBe(' V: Kapalı ')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`flips on one press and fits a narrow and a wide ${surface}`, async ($, on) => {
      const seen = world(on, { model: 'sonnet' })

      for (const columns of [40, 160]) {
        const ui = await $.ui.mount({
          plugin: PLUGIN,
          surface,
          component: 'SessionMode',
          props: { modes: ['focus'] },
          viewport: { columns, rows: 24 },
        })
        const offLabel = chipLabel(false, columns)
        const onLabel = chipLabel(true, columns)
        expect(offLabel.length).toBeLessThan(columns / 2)

        expect(await ui.find({ type: 'Text', text: offLabel })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
        await ui.press({ key: 'vites-toggle' })
        expect(await ui.find({ type: 'Text', text: onLabel })).toBeDefined()
        await ui.press({ key: 'vites-toggle' })
        expect(await ui.find({ type: 'Text', text: offLabel })).toBeDefined()
        await ui.unmount()
      }

      expect(seen.model).toBe('sonnet')
    })
  }
})
