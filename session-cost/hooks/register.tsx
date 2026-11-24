import { atom, read, update } from 'claude-code'
import type {
  AgentSpawnInput,
  EngineInterface,
  ModelUsage,
  Register,
  TurnStepResult,
} from 'claude-code'

import type {
  Active,
  AgentKind,
  Language,
  Measured,
  TokenTotals,
} from '../types'
import { firstAppleLanguage, messages, pickLanguage } from './messages'
import type { Messages } from './messages'

const PANE = 'session-cost'

// パネルに内訳を並べる順。
const KINDS: ReadonlyArray<AgentKind> = ['subagent', 'workflow']

type Agents = Readonly<Record<string, AgentKind>>

const ZERO: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const tokens = atom({ plugin: 'session-cost', key: 'tokens' } as const, ZERO, {
  shape: 'tokens-1',
})
const tokensByKind = atom(
  { plugin: 'session-cost', key: 'tokensByKind' } as const,
  { subagent: ZERO, workflow: ZERO },
  { shape: 'tokens-by-kind-1' },
)
const agents = atom({ plugin: 'session-cost', key: 'agents' } as const, {}, {
  shape: 'agents-2',
})
const measured = atom(
  { plugin: 'session-cost', key: 'measured' } as const,
  { usdByKind: { subagent: 0, workflow: 0 } },
  { shape: 'measured-3' },
)
const active = atom(
  { plugin: 'session-cost', key: 'active' } as const,
  { turnMs: 0, apiMs: 0 } as Active,
  { shape: 'active-2' },
)

const language = atom(
  { plugin: 'session-cost', key: 'language' } as const,
  'en' as Language,
  { shape: 'language-1' },
)

// 副作用: OS の言語設定を読む。macOS はシステムの優先言語、それ以外はロケールの環境変数。
const detectLanguage = async ($: EngineInterface): Promise<Language> => {
  const apple = await $.process
    .run(['defaults', 'read', '-g', 'AppleLanguages'])
    .then(
      ran => (ran.exitCode === 0 ? firstAppleLanguage(ran.stdout) : undefined),
      () => undefined,
    )

  return pickLanguage([
    apple,
    await $.env.get('LC_ALL'),
    await $.env.get('LC_MESSAGES'),
    await $.env.get('LANG'),
  ])
}

// 時間を測り始めた時点のコストを一度だけ覚える。時給はそこからの増分で出す。
export const withBaseline = (a: Active, usd: number): Active =>
  a.baselineUsd === undefined ? { ...a, baselineUsd: usd } : a

export const addTurn = (a: Active, durationMs: number): Active => ({
  ...a,
  turnMs: a.turnMs + durationMs,
})

export const addApi = (a: Active, durationMs: number): Active => ({
  ...a,
  apiMs: a.apiMs + durationMs,
})

export const addUsage = (total: TokenTotals, usage: ModelUsage): TokenTotals => ({
  input: total.input + usage.input_tokens,
  output: total.output + usage.output_tokens,
  cacheRead: total.cacheRead + usage.cache_read_input_tokens,
  cacheWrite: total.cacheWrite + usage.cache_creation_input_tokens,
})

// その種類のエージェントのトークン数に、応答のトークン数を足す。
export const addUsageOf = (
  byKind: Readonly<Record<AgentKind, TokenTotals>>,
  kind: AgentKind,
  usage: ModelUsage,
): Readonly<Record<AgentKind, TokenTotals>> => ({
  ...byKind,
  [kind]: addUsage(byKind[kind], usage),
})

// その id のループのエージェントの種類。メインは id を持たない。
// 起動を知らないループ（エンジンのコンパクションなど）は、どの内訳にも入れない。
export const kindOf = (
  known: Agents,
  agentId: string | undefined,
): AgentKind | undefined =>
  agentId === undefined ? undefined : known[agentId]

// 起動されたエージェントの種類を覚える。ワークフローのスクリプトが起動したものと、
// ワークフローのエージェントの中で起動されたものはワークフロー、それ以外はサブエージェント。
// 再開したエージェントは同じ id で届くので、覚えた種類のままにする。
export const withSpawned = (
  known: Agents,
  spawn: Pick<AgentSpawnInput, 'workflow' | 'parentAgentId'>,
  agentId: string,
): Agents => {
  if (known[agentId] !== undefined) return known

  const isWorkflow =
    spawn.workflow !== undefined ||
    kindOf(known, spawn.parentAgentId) === 'workflow'

  return { ...known, [agentId]: isWorkflow ? 'workflow' : 'subagent' }
}

export const formatUsd = (usd: number): string => `$${usd.toFixed(2)}`

export const formatTokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`

  return String(count)
}

export const formatDuration = (ms: number, t: Messages): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return t.hoursMinutes(hours, minutes % 60)
  if (minutes > 0) return t.minutesSeconds(minutes, seconds % 60)

  return t.seconds(seconds)
}

// 1 分未満は割る時間が短すぎて意味のある値にならないので出さない。
export const hourlyUsd = (usd: number, elapsedMs: number): number | undefined =>
  elapsedMs < 60_000 ? undefined : usd / (elapsedMs / 3_600_000)

type Measurement = Readonly<{
  cost?: Readonly<{ usd: number }>
  context: Readonly<{ tokens?: number; percent?: number }>
}>

// 読んだコストとコンテキスト使用量を重ねる。
// 並行するリクエストの読み取りは前後して届くので、コストは大きいほうを残す。
// サブエージェントやワークフローのリクエストのあとの読み取りなら、前回からの増分をその種類に割り振る。
// 割り振った分はエンジンの計測値にないので引き継ぐ。
export const withReading = (
  m: Measured,
  reading: Measurement,
  kind: AgentKind | undefined,
): Measured => {
  const usd = reading.cost?.usd
  const increase =
    usd === undefined || m.usd === undefined ? 0 : Math.max(0, usd - m.usd)
  const latestUsd = m.usd === undefined ? usd : m.usd + increase

  return {
    ...(latestUsd === undefined ? {} : { usd: latestUsd }),
    ...(reading.context.tokens === undefined
      ? {}
      : { contextTokens: reading.context.tokens }),
    ...(reading.context.percent === undefined
      ? {}
      : { contextPercent: reading.context.percent }),
    usdByKind:
      kind === undefined
        ? m.usdByKind
        : { ...m.usdByKind, [kind]: m.usdByKind[kind] + increase },
  }
}

// プロンプト下に常時出す表示。詳細は /session-cost のパネルで見る。
// 隣に並ぶ他の mod の表示と区切る。プロンプト下のモード表示は Svg を描かないので絵文字にする。
export const statusText = (m: Measured): string | undefined =>
  m.usd === undefined ? undefined : `💰${formatUsd(m.usd)}`

// パネルのトークンの行。
const tokenLines = (total: TokenTotals, t: Messages): ReadonlyArray<string> => [
  `${t.input}: ${formatTokens(total.input)}`,
  `${t.output}: ${formatTokens(total.output)}`,
  `${t.cacheRead}: ${formatTokens(total.cacheRead)}`,
  `${t.cacheWrite}: ${formatTokens(total.cacheWrite)}`,
]

// 副作用: その時点のセッションのコストを読み、応答のトークン数とあわせて積算する。
const countResponse = async (
  $: EngineInterface,
  agentId: string | undefined,
  usage: ModelUsage | null | undefined,
) => {
  const [reading, known] = await Promise.all([
    $.session.usage(),
    read($, agents),
  ])
  const kind = kindOf(known, agentId)
  await Promise.all([
    update($, measured, m => withReading(m, reading, kind)),
    ...(usage ? [update($, tokens, total => addUsage(total, usage))] : []),
    ...(usage && kind
      ? [update($, tokensByKind, byKind => addUsageOf(byKind, kind, usage))]
      : []),
  ])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const detected = await detectLanguage($)
    await update($, language, () => detected)
    await $.command.register({
      name: 'session-cost',
      description: messages[detected].commandDescription,
    })
    // 再読み込みでも呼ばれる。動いているサブエージェントやワークフローの読み取りと前後しても戻らないように重ねる。
    const usage = await $.session.usage()
    await update($, measured, m => withReading(m, usage, undefined))
    await update($, active, a => withBaseline(a, usage.cost?.usd ?? 0))

    return next(e)
  })

  on('command.run', { command: 'session-cost' }, async $ => {
    const t = messages[await read($, language)]
    await $.ui.open({ id: PANE, title: t.title })

    return { text: t.paneOpened }
  })

  // エンジンが計測するたびに届く、セッション全体のコストとコンテキスト使用量。
  // メインのターンの終わりにしか届かないので、リクエストごとの更新は turn.step で行う。
  on('session.measure', async ($, e, next) => {
    await update($, measured, m => withReading(m, e, undefined))

    return next(e)
  })

  // 起動されたエージェントの種類を、起動したときに覚えておく。
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const { agentId } = spawned
    if (agentId !== undefined)
      await update($, agents, known => withSpawned(known, e, agentId))

    return spawned
  })

  // モデルへのリクエスト 1 回ごとに、送ってから応答が終わるまでの時間を足す。
  // /cost の API 時間と同じく、サブエージェントのリクエストも数える。
  // 応答のトークン数を足し、コストを読み直す。メインのターンが終わるのを待たずに、
  // バックグラウンドのワークフローの分も表示に出すため。
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    let response: TurnStepResult | undefined
    try {
      response = yield* next(e)

      return response
    } finally {
      // 中断や失敗で終わったリクエストの時間とコストも数える。
      // 応答が終わった直後に読み、mod 自身の処理を API 時間にもコストの割り振りにも混ぜない。
      await Promise.all([
        $.clock
          .now()
          .then(endedAt => update($, active, a => addApi(a, endedAt - startedAt))),
        countResponse($, e.agentId, response?.usage),
      ])
    }
  })

  // ターン処理時間はメインのターンだけ足す。サブエージェントの時間はその中に重なる。
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined)
      await update($, active, a => addTurn(a, e.durationMs))

    return next(e)
  })

  // プロンプト下のモード表示（モデル名などの並び）にコストを足す。
  // $.ui.status と違い mod 名のラベルが付かない。
  // PromptHint への追記はデスクトップでは描かれなかった。
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    // デスクトップは modes の書き換えを描かないので、下の描画を包む木で描く。
    // 包むことで、同じ場所に描く他の mod の表示も残る。
    const [below, lang, m] = await Promise.all([
      next(e),
      read($, language),
      read($, measured),
    ])
    const text = statusText(m)
    if (text === undefined) return below

    const t = messages[lang]

    const { Box, Button } = $.ui.resolve(e)
    // 副作用: クリックで詳細パネルを開き、開いていれば閉じる。
    const togglePane = async () => {
      const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
      await (isOpen
        ? $.ui.close({ id: PANE })
        : $.ui.open({ id: PANE, title: t.title }))
    }

    return (
      <Box flexDirection="row" gap={1}>
        {below}
        <Button key="toggle-pane" plain dimColor onPress={() => void togglePane()}>
          {text}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // 副作用: セッションの開始時刻と現在時刻を読む。
    const [lang, m, total, byKind, a, { startedAt }, now] = await Promise.all([
      read($, language),
      read($, measured),
      read($, tokens),
      read($, tokensByKind),
      read($, active),
      $.session.usage(),
      $.clock.now(),
    ])
    const t = messages[lang]
    const elapsedMs = now - startedAt
    const rate =
      m.usd === undefined || a.baselineUsd === undefined
        ? undefined
        : hourlyUsd(m.usd - a.baselineUsd, a.apiMs)
    // その種類のエージェントが応答していないセッションでは、その内訳を出さない。
    const breakdowns = KINDS.filter(kind =>
      Object.values(byKind[kind]).some(count => count > 0),
    ).flatMap(kind => [
      <Text> </Text>,
      <Text dimColor>{t.ofWhich[kind]}</Text>,
      <Text>
        {t.breakdownCost}: {formatUsd(m.usdByKind[kind])}
      </Text>,
      ...tokenLines(byKind[kind], t).map(line => <Text>{line}</Text>),
    ])

    return (
      <Box flexDirection="column">
        <Text dimColor>{t.cost}</Text>
        <Text bold>{m.usd === undefined ? '—' : formatUsd(m.usd)}</Text>
        <Text> </Text>
        <Text dimColor>{t.rate}</Text>
        <Text bold>{rate === undefined ? '—' : t.perHour(formatUsd(rate))}</Text>
        <Text> </Text>
        <Text dimColor>{t.time}</Text>
        <Text>
          {t.wall}: {formatDuration(elapsedMs, t)}
        </Text>
        <Text>
          {t.turn}: {formatDuration(a.turnMs, t)}
        </Text>
        <Text>
          {t.api}: {formatDuration(a.apiMs, t)}
        </Text>
        <Text> </Text>
        <Text dimColor>{t.tokens}</Text>
        {tokenLines(total, t).map(line => (
          <Text>{line}</Text>
        ))}
        {breakdowns}
        <Text> </Text>
        <Text dimColor>{t.context}</Text>
        <Text>
          {m.contextTokens === undefined
            ? '—'
            : t.contextValue(
                formatTokens(m.contextTokens),
                m.contextPercent ?? 0,
              )}
        </Text>
      </Box>
    )
  })
}
