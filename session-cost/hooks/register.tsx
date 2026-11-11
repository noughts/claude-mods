import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Active, Language, Measured, TokenTotals } from '../types'
import { firstAppleLanguage, messages, pickLanguage } from './messages'
import type { Messages } from './messages'

const PANE = 'session-cost'

const ZERO: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const tokens = atom({ plugin: 'session-cost', key: 'tokens' } as const, ZERO, {
  shape: 'tokens-1',
})
const measured = atom(
  { plugin: 'session-cost', key: 'measured' } as const,
  {} as Measured,
  { shape: 'measured-1' },
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

const toMeasured = (m: Measurement): Measured => ({
  ...(m.cost ? { usd: m.cost.usd } : {}),
  ...(m.context.tokens === undefined ? {} : { contextTokens: m.context.tokens }),
  ...(m.context.percent === undefined
    ? {}
    : { contextPercent: m.context.percent }),
})

// プロンプト下に常時出す表示。詳細は /session-cost のパネルで見る。
export const statusText = (m: Measured, t: Messages): string | undefined =>
  m.usd === undefined ? undefined : t.status(formatUsd(m.usd))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const detected = await detectLanguage($)
    await update($, language, () => detected)
    await $.command.register({
      name: 'session-cost',
      description: messages[detected].commandDescription,
    })
    const usage = await $.session.usage()
    await update($, measured, () => toMeasured(usage))
    await update($, active, a => withBaseline(a, usage.cost?.usd ?? 0))

    return next(e)
  })

  on('command.run', { command: 'session-cost' }, async $ => {
    const t = messages[await read($, language)]
    await $.ui.open({ id: PANE, title: t.title })

    return { text: t.paneOpened }
  })

  // エンジンが計測するたびに届く、セッション全体のコストとコンテキスト使用量。
  on('session.measure', async ($, e, next) => {
    await update($, measured, () => toMeasured(e))

    return next(e)
  })

  // モデルへのリクエスト 1 回ごとに、送ってから応答が終わるまでの時間を足す。
  // /cost の API 時間と同じく、サブエージェントのリクエストも数える。
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    try {
      return yield* next(e)
    } finally {
      // 中断や失敗で終わったリクエストの時間も数える。
      const endedAt = await $.clock.now()
      await update($, active, a => addApi(a, endedAt - startedAt))
    }
  })

  // ターン（サブエージェントのものを含む）が終わるたびにトークン数を積算する。
  // ターン処理時間はメインのターンだけ足す。サブエージェントの時間はその中に重なる。
  on('turn.complete', async ($, e, next) => {
    const { usage, agentId, durationMs } = e
    if (usage) await update($, tokens, total => addUsage(total, usage))
    if (agentId === undefined) await update($, active, a => addTurn(a, durationMs))

    return next(e)
  })

  // プロンプト下のモード表示（モデル名などの並び）にコストを足す。
  // $.ui.status と違い mod 名のラベルが付かない。
  // PromptHint への追記はデスクトップでは描かれなかった。
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const t = messages[await read($, language)]
    const text = statusText(await read($, measured), t)
    if (text === undefined) return next(e)

    // デスクトップは modes の書き換えを描かないので、自前の木で描く。
    const { Box, Text, Button } = $.ui.resolve(e)
    // 副作用: クリックで詳細パネルを開き、開いていれば閉じる。
    const togglePane = async () => {
      const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
      await (isOpen
        ? $.ui.close({ id: PANE })
        : $.ui.open({ id: PANE, title: t.title }))
    }

    return (
      <Box flexDirection="row" gap={1}>
        {e.props.modes.length > 0 && (
          <Text dimColor>{e.props.modes.join(' & ')}</Text>
        )}
        <Button key="toggle-pane" plain dimColor onPress={() => void togglePane()}>
          {text}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = messages[await read($, language)]
    const m = await read($, measured)
    const total = await read($, tokens)
    // 副作用: セッションの開始時刻と現在時刻を読む。
    const { startedAt } = await $.session.usage()
    const elapsedMs = (await $.clock.now()) - startedAt
    const a = await read($, active)
    const rate =
      m.usd === undefined || a.baselineUsd === undefined
        ? undefined
        : hourlyUsd(m.usd - a.baselineUsd, a.apiMs)
    const rows: ReadonlyArray<readonly [string, number]> = [
      [t.input, total.input],
      [t.output, total.output],
      [t.cacheRead, total.cacheRead],
      [t.cacheWrite, total.cacheWrite],
    ]

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
        {rows.map(([label, count]) => (
          <Text>
            {label}: {formatTokens(count)}
          </Text>
        ))}
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
