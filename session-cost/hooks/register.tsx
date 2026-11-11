import { atom, read, update } from 'claude-code'
import type { ModelUsage, Register } from 'claude-code'

import type { Active, Measured, TokenTotals } from '../types'

const PANE = 'session-cost'
const TITLE = 'セッションコスト'

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
  { ms: 0 } as Active,
  { shape: 'active-1' },
)

// 稼働時間を測り始めた時点のコストを一度だけ覚える。時給はそこからの増分で出す。
export const withBaseline = (a: Active, usd: number): Active =>
  a.baselineUsd === undefined ? { ...a, baselineUsd: usd } : a

export const addTurn = (a: Active, durationMs: number): Active => ({
  ...a,
  ms: a.ms + durationMs,
})

export const addUsage = (total: TokenTotals, usage: ModelUsage): TokenTotals => ({
  input: total.input + usage.input_tokens,
  output: total.output + usage.output_tokens,
  cacheRead: total.cacheRead + usage.cache_read_input_tokens,
  cacheWrite: total.cacheWrite + usage.cache_creation_input_tokens,
})

export const formatUsd = (usd: number): string =>
  `$${usd.toFixed(usd < 1 ? 4 : 2)}`

export const formatTokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`

  return String(count)
}

export const formatDuration = (ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours}時間${minutes % 60}分` : `${minutes}分`
}

// 1 分未満は割る時間が短すぎて意味のある値にならないので出さない。
export const hourlyUsd = (usd: number, elapsedMs: number): number | undefined =>
  elapsedMs < 60_000 ? undefined : usd / (elapsedMs / 3_600_000)

type Measurement =Readonly<{
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
export const statusText = (m: Measured): string | undefined =>
  m.usd === undefined ? undefined : `コスト ${formatUsd(m.usd)}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-cost',
      description: 'このセッションのコストとトークンの内訳をパネルに表示する',
    })
    const usage = await $.session.usage()
    await update($, measured, () => toMeasured(usage))
    await update($, active, a => withBaseline(a, usage.cost?.usd ?? 0))

    return next(e)
  })

  on('command.run', { command: 'session-cost' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'セッションコストのパネルを開きました。' }
  })

  // エンジンが計測するたびに届く、セッション全体のコストとコンテキスト使用量。
  on('session.measure', async ($, e, next) => {
    await update($, measured, () => toMeasured(e))

    return next(e)
  })

  // ターン（サブエージェントのものを含む）が終わるたびにトークン数を積算する。
  // 稼働時間はメインのターンだけ足す。サブエージェントの時間はその中に重なる。
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
    const text = statusText(await read($, measured))
    if (text === undefined) return next(e)

    // デスクトップは modes の書き換えを描かないので、自前の木で描く。
    const { Box, Text, Button } = $.ui.resolve(e)
    // 副作用: クリックで詳細パネルを開き、開いていれば閉じる。
    const togglePane = async () => {
      const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
      await (isOpen
        ? $.ui.close({ id: PANE })
        : $.ui.open({ id: PANE, title: TITLE }))
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
    const m = await read($, measured)
    const t = await read($, tokens)
    // 副作用: セッションの開始時刻と現在時刻を読む。
    const { startedAt } = await $.session.usage()
    const elapsedMs = (await $.clock.now()) - startedAt
    const a = await read($, active)
    const rate =
      m.usd === undefined || a.baselineUsd === undefined
        ? undefined
        : hourlyUsd(m.usd - a.baselineUsd, a.ms)
    const rows: ReadonlyArray<readonly [string, number]> = [
      ['入力', t.input],
      ['出力', t.output],
      ['キャッシュ読み込み', t.cacheRead],
      ['キャッシュ書き込み', t.cacheWrite],
    ]

    return (
      <Box flexDirection="column">
        <Text dimColor>コスト（セッション累計）</Text>
        <Text bold>{m.usd === undefined ? '—' : formatUsd(m.usd)}</Text>
        <Text> </Text>
        <Text dimColor>経過時間（セッション開始から）</Text>
        <Text>{formatDuration(elapsedMs)}</Text>
        <Text> </Text>
        <Text dimColor>稼働時間（このパネルを入れてから）</Text>
        <Text>{formatDuration(a.ms)}</Text>
        <Text> </Text>
        <Text dimColor>Claude の時給（稼働時間あたり）</Text>
        <Text bold>{rate === undefined ? '—' : `${formatUsd(rate)}/時間`}</Text>
        <Text> </Text>
        <Text dimColor>トークン（このパネルを入れてからの累計）</Text>
        {rows.map(([label, count]) => (
          <Text>
            {label}: {formatTokens(count)}
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>コンテキスト</Text>
        <Text>
          {m.contextTokens === undefined
            ? '—'
            : `${formatTokens(m.contextTokens)}（${m.contextPercent ?? 0}%）`}
        </Text>
      </Box>
    )
  })
}
