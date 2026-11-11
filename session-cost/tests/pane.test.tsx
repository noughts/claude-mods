import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-cost',
  component: 'Pane',
  requestId: 'session-cost',
  surface: 'desktop',
  props: {
    title: 'セッションコスト',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('計測されたコストと積算したトークンを表示する', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-cost' } }))
  // エンジンの代役: 開いているパネルの id を覚えておく。
  let openPanes: ReadonlyArray<string> = []
  on('ui.open', (_, e) => {
    openPanes = [...openPanes, e.id]

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    openPanes = openPanes.filter(id => id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: openPanes.map(id => ({
      id,
      title: id,
      isShown: true,
      isFocused: false,
      isPlaced: true,
    })),
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [],
      // mod を入れた時点で、すでに $0.2345 かかっている。
      cost: { usd: 0.2345 },
    },
  }))
  // セッション開始（時刻 0）から 90 分後。
  on('clock.now', () => ({ value: 90 * 60_000 }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  // エンジンの代役: 渡されたモードのラベルをそのまま 1 行に描く。
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const modes = e.component === 'SessionMode' ? e.props.modes : []

    return <Text>{modes.join(' & ')}</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // まだ動いていないので時給は出ない。
  const before = await $.ui.mount(PANE)
  expect((await before.find({ type: 'Text', text: /^—$/ }))?.text).toBe('—')
  await before.unmount()

  await $.session.measure({
    context: { window: 200000, tokens: 50000, percent: 25 },
    rateLimits: [],
    cost: { usd: 1.2345 },
    changed: ['cost', 'context'],
  })
  const usage = {
    model: 'claude-fable-5-2',
    input_tokens: 600,
    output_tokens: 1200,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
  }
  for (const turnId of ['a', 'b'])
    await $.turn.complete({
      turnId,
      reason: 'answer',
      answer: 'ok',
      // メインのターン 2 回で、合計 30 分動いた。
      durationMs: 15 * 60_000,
      isAborted: false,
      usage,
    })

  // プロンプト下のモード表示に、既存のラベルを残したままコストを足す。
  const modes = await $.ui.mount({
    plugin: 'session-cost',
    component: 'SessionMode',
    surface: 'desktop',
    props: { modes: ['focus'] },
  })
  expect((await modes.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
  expect((await modes.find({ type: 'Button', key: 'toggle-pane' }))?.text).toBe(
    'コスト $1.23',
  )

  // クリックすると詳細パネルが開き、もう一度クリックすると閉じる。
  await modes.press({ key: 'toggle-pane' })
  expect(openPanes).toEqual(['session-cost'])
  await modes.press({ key: 'toggle-pane' })
  expect(openPanes).toEqual([])
  await modes.unmount()

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^\$[\d.]+$/ }))?.text).toBe(
    '$1.23',
  )
  expect((await ui.find({ type: 'Text', text: /^1時間/ }))?.text).toBe(
    '1時間30分',
  )
  expect((await ui.find({ type: 'Text', text: /^30分$/ }))?.text).toBe('30分')
  // mod を入れてからの増分 $1.00 を、稼働 30 分で割る。
  expect((await ui.find({ type: 'Text', text: /時間$/ }))?.text).toBe(
    '$2.00/時間',
  )
  expect((await ui.find({ type: 'Text', text: /^入力/ }))?.text).toBe(
    '入力: 1.2k',
  )
  expect((await ui.find({ type: 'Text', text: /^出力/ }))?.text).toBe(
    '出力: 2.4k',
  )
  expect((await ui.find({ type: 'Text', text: /読み込み/ }))?.text).toBe(
    'キャッシュ読み込み: 2.00M',
  )
  expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe(
    '50.0k（25%）',
  )
  await ui.unmount()
})
