import type { On, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SESSION_MODE = {
  plugin: 'five-hour-usage',
  component: 'SessionMode',
  surface: 'desktop',
  props: { modes: ['focus'] },
} as const

const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const

const RESETS_AT_ISO = '2026-11-12T19:40:00Z'
const RESETS_AT = Date.parse(RESETS_AT_ISO)
// リセットの 1 時間前に始める。
const NOW = RESETS_AT - 60 * 60_000

// エンジンの代役: セッション開始時の使用量の上限と、モード表示を答える。
const answerEngine = (on: On, rateLimits: ReadonlyArray<SessionRateLimit>) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [...rateLimits] },
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const modes = e.component === 'SessionMode' ? e.props.modes : []

    return <Text>{modes.join(' & ')}</Text>
  })
}

type Drawing = Readonly<{
  find: (q: { type: 'Text'; text: RegExp }) => Promise<{ text: string } | undefined>
}>

const fiveHourText = async (ui: Drawing) =>
  (await ui.find({ type: 'Text', text: /^5h/ }))?.text

test('週間の上限が逼迫していても、5 時間ウィンドウの使用率を表示する', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerEngine(on, [
    { kind: 'five_hour', percentUsed: 12.5, resetsAt: RESETS_AT_ISO },
    { kind: 'seven_day', percentUsed: 90 },
  ])

  await $.session.start(START)

  const ui = await $.ui.mount(SESSION_MODE)
  // 他の表示を消さずに、その横に足す。
  expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
  expect(await fiveHourText(ui)).toBe('5h 13%')
  await ui.unmount()
})

test('使用率が動くたびに表示を更新し、リセット時刻を過ぎたら 0% にする', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  answerEngine(on, [])

  await $.session.start(START)
  const ui = await $.ui.mount(SESSION_MODE)
  expect(await fiveHourText(ui)).toBeUndefined()

  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 90, resetsAt: RESETS_AT_ISO }],
    changed: ['rateLimits'],
  })
  expect(await fiveHourText(ui)).toBe('5h 90%')

  // 応答がないまま、開いている表示がリセット時刻の 1 分後までに描き直される。
  await clock.set(RESETS_AT + 60_000)
  expect(await fiveHourText(ui)).toBe('5h 0%')
  await ui.unmount()
})

test('5 時間ウィンドウの読み取りがなければ何も足さない', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerEngine(on, [{ kind: 'seven_day', percentUsed: 90 }])

  await $.session.start(START)

  const ui = await $.ui.mount(SESSION_MODE)
  expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
  expect(await fiveHourText(ui)).toBeUndefined()
  await ui.unmount()
})
