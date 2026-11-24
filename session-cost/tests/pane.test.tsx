import type { AgentSpawnInput, On, SessionContextUsage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

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

// モデルへのリクエストを 1 回送る。ストリームは最後まで読んで初めて終わる。
const step = async ($: Engine, turnId: string, agentId?: string) => {
  const stream = $.turn.step({
    turnId,
    index: 0,
    model: 'm',
    messageCount: 1,
    ...(agentId === undefined ? {} : { agentId }),
  })
  for await (const _ of stream);
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
  // エンジンの代役: セッションのコストとコンテキストの使用量。
  // mod を入れた時点で、すでに $0.2345 かかっている。
  let ledger: Readonly<{ context: SessionContextUsage; cost: { usd: number } }> = {
    context: { window: 200000 },
    cost: { usd: 0.2345 },
  }
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], ...ledger },
  }))
  // セッション開始（時刻 0）から 90 分後に始まる。
  on('clock.now', () => ({ value: now }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  const usage = {
    model: 'claude-fable-5-2',
    input_tokens: 600,
    output_tokens: 1200,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
  }
  // エンジンの代役: モデルへのリクエスト 1 回に 6 分かかる。
  let now = 90 * 60_000
  on('turn.step', async function* (_, e) {
    now += 6 * 60_000

    return { ...e, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage }
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

  ledger = {
    context: { window: 200000, tokens: 50000, percent: 25 },
    cost: { usd: 1.2345 },
  }
  await $.session.measure({
    ...ledger,
    rateLimits: [],
    changed: ['cost', 'context'],
  })
  // リクエストは 2 回。うち 1 回はサブエージェントのもの。
  await step($, 'a')
  await step($, 'sub', 'agent-1')
  for (const turnId of ['a', 'b'])
    await $.turn.complete({
      turnId,
      reason: 'answer',
      answer: 'ok',
      // メインのターン 2 回で、合計 30 分動いた。
      durationMs: 15 * 60_000,
      isAborted: false,
      // ターンの合計にもリクエストのトークン数が載るが、二重には数えない。
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
    '💰$1.23',
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
  // ワークフローを使っていないので、その内訳は出さない。
  expect(await ui.find({ type: 'Text', text: /ワークフロー/ })).toBeUndefined()
  await ui.unmount()
})

test('ワークフローの実行中もリクエストごとにコストとトークンを更新し、ワークフローの内訳を出す', async ($, on) => {
  answerLanguage(on, 'ja-JP', undefined)
  on('command.register', () => ({ value: { command: 'session-cost' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: 0 }))
  // エンジンの代役: 応答が届くたびに、その料金がセッションのコストに足される。
  let ledgerUsd = 0.1
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [],
      cost: { usd: ledgerUsd },
    },
  }))
  // エンジンの代役: ワークフローが起動したエージェントと、その中で起動されたエージェントに id を振る。
  on('agent.spawn', (_, e) => ({
    model: 'm',
    agentId: e.workflow
      ? 'wf-1'
      : e.parentAgentId === 'wf-1'
        ? 'wf-1-child'
        : 'sub-1',
  }))
  // エンジンの代役: ループごとの、リクエスト 1 回の料金と出力トークン数。
  const responses: Readonly<Record<string, { usd: number; output: number }>> = {
    main: { usd: 0.5, output: 100 },
    'wf-1': { usd: 2, output: 400 },
    'wf-1-child': { usd: 1, output: 400 },
    'sub-1': { usd: 0.25, output: 100 },
  }
  on('turn.step', async function* (_, e) {
    const { usd, output } = responses[e.agentId ?? 'main'] ?? { usd: 0, output: 0 }
    ledgerUsd += usd

    return {
      ...e,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'm',
        input_tokens: 1,
        output_tokens: output,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 0,
      },
    }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>below</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const spawn = (extra: Pick<AgentSpawnInput, 'workflow' | 'parentAgentId'>) =>
    $.agent.spawn({
      tool_use_id: 'toolu_1',
      prompt: 'p',
      description: 'd',
      subagentType: 'workflow-subagent',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'm',
      background: false,
      fork: false,
      ...extra,
    })

  // メインのターンがワークフローを起動して終わったあと、バックグラウンドで動く。
  await step($, 'main')
  await spawn({ workflow: { runId: 'wf_1', agentIndex: 1 } })
  await step($, 'wf-a', 'wf-1')
  // ワークフローのエージェントが、さらにサブエージェントを起動する。
  await spawn({ parentAgentId: 'wf-1' })
  await step($, 'wf-b', 'wf-1-child')
  await step($, 'wf-c', 'wf-1')
  // メインから起動した普通のサブエージェントはワークフローに入れない。
  await spawn({})
  await step($, 'sub', 'sub-1')

  // メインのターンの終わり（session.measure）を待たずに、その時点のコストを出す。
  const modes = await $.ui.mount({
    plugin: 'session-cost',
    component: 'SessionMode',
    surface: 'desktop',
    props: { modes: [] },
  })
  expect((await modes.find({ type: 'Button', key: 'toggle-pane' }))?.text).toBe(
    '💰$5.85',
  )
  await modes.unmount()

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^\$[\d.]+$/ }))?.text).toBe(
    '$5.85',
  )
  expect((await ui.find({ type: 'Text', text: /^出力/ }))?.text).toBe(
    '出力: 1.4k',
  )
  expect((await ui.find({ type: 'Text', text: /^うちワークフロー/ }))?.text).toBe(
    'うちワークフロー（Ultracode など）',
  )
  // 内訳は合計のあとに並ぶ。コストはワークフローのエージェント 2 つの分。
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  const breakdown = texts.slice(texts.indexOf('うちワークフロー（Ultracode など）') + 1)
  expect(breakdown.slice(0, 5)).toEqual([
    'コスト: $5.00',
    '入力: 3',
    '出力: 1.2k',
    'キャッシュ読み込み: 3.00M',
    'キャッシュ書き込み: 0',
  ])
  await ui.unmount()

  // メインのターンの終わりに届く計測値は、ワークフローの分に足さない。
  ledgerUsd += 0.05
  await $.session.measure({
    context: { window: 200000, tokens: 50000, percent: 25 },
    rateLimits: [],
    cost: { usd: ledgerUsd },
    changed: ['cost', 'context'],
  })
  // mod の再読み込みでも session.start が届く。ワークフローに割り振った分は残す。
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const after = await $.ui.mount(PANE)
  expect((await after.find({ type: 'Text', text: /^\$[\d.]+$/ }))?.text).toBe(
    '$5.90',
  )
  expect((await after.find({ type: 'Text', text: /^コスト: / }))?.text).toBe(
    'コスト: $5.00',
  )
  await after.unmount()
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
