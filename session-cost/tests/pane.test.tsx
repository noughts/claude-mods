import type { On } from 'claude-code'
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

// エンジンの代役: macOS の優先言語と、ロケールの環境変数を答える。
const answerLanguage = (
  on: On,
  apple: string | undefined,
  lang: string | undefined,
) => {
  on('process.run', () => ({
    value: {
      exitCode: apple === undefined ? 1 : 0,
      stdout: apple === undefined ? '' : `(\n    "${apple}",\n    "en-JP"\n)\n`,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('env.get', (_, e) => ({ value: e.name === 'LANG' ? lang : undefined }))
}

test('計測されたコストと積算したトークンを表示する', async ($, on) => {
  answerLanguage(on, 'ja-JP', 'en_US.UTF-8')
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
  // セッション開始（時刻 0）から 90 分後に始まる。
  on('clock.now', () => ({ value: now }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  // エンジンの代役: モデルへのリクエスト 1 回に 6 分かかる。
  let now = 90 * 60_000
  on('turn.step', async function* (_, e) {
    now += 6 * 60_000

    return { ...e, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  // エンジンの代役: 渡されたモードのラベルをそのまま 1 行に描く。
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const modes = e.component === 'SessionMode' ? e.props.modes : []

    return <Text>{modes.join(' & ')}</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // まだ動いていないので時給は出ない。
  const before = await $.ui.mount(PANE)
  // 1 ドル未満でも小数点以下 2 桁で出す。
  expect((await before.find({ type: 'Text', text: /^\$/ }))?.text).toBe('$0.23')
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
  // ターンごとにリクエスト 1 回。うち 1 回はサブエージェントのもの。
  // ストリームは最後まで読んで初めて終わる。
  const readAll = async (stream: AsyncIterable<unknown>) => {
    for await (const _ of stream);
  }
  await readAll(
    $.turn.step({ turnId: 'a', index: 0, model: 'm', messageCount: 1 }),
  )
  await readAll(
    $.turn.step({
      turnId: 'sub',
      index: 0,
      model: 'm',
      messageCount: 1,
      agentId: 'agent-1',
    }),
  )
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
    '$1.23',
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
  expect((await ui.find({ type: 'Text', text: /^実時間/ }))?.text).toBe(
    '実時間（セッション開始から）: 1時間42分',
  )
  expect((await ui.find({ type: 'Text', text: /^ターン処理/ }))?.text).toBe(
    'ターン処理（ツール実行を含む）: 30分0秒',
  )
  expect((await ui.find({ type: 'Text', text: /^API/ }))?.text).toBe(
    'API（モデルの応答待ち）: 12分0秒',
  )
  // mod を入れてからの増分 $1.00 を、API 時間 12 分で割る。
  expect((await ui.find({ type: 'Text', text: /\/時間$/ }))?.text).toBe(
    '$5.00/時間',
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

test('OS の言語が日本語でなければ英語で表示する', async ($, on) => {
  // macOS ではない環境で、ロケールがフランス語。
  answerLanguage(on, undefined, 'fr_FR.UTF-8')
  on('command.register', () => ({ value: { command: 'session-cost' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, tokens: 50000, percent: 25 },
      rateLimits: [],
      cost: { usd: 2.5 },
    },
  }))
  on('clock.now', () => ({ value: 45_000 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Cost/ }))?.text).toBe(
    'Cost (session total)',
  )
  expect((await ui.find({ type: 'Text', text: /^Wall/ }))?.text).toBe(
    'Wall (since session start): 45s',
  )
  expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe('50.0k (25%)')
  await ui.unmount()
})

test('macOS の優先言語が日本語なら、ロケールの環境変数より優先して日本語にする', async ($, on) => {
  answerLanguage(on, 'ja-JP', 'en_US.UTF-8')
  on('command.register', () => ({ value: { command: 'session-cost' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] },
  }))
  on('clock.now', () => ({ value: 0 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^コスト/ }))?.text).toBe(
    'コスト（セッション累計）',
  )
  await ui.unmount()
})
