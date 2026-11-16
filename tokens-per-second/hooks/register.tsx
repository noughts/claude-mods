import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Totals } from '../types'

const totals = atom(
  { plugin: 'tokens-per-second', key: 'totals' } as const,
  { outputTokens: 0, apiMs: 0 } as Totals,
  { shape: 'totals-1' },
)

export const addRequest = (
  t: Totals,
  outputTokens: number,
  durationMs: number,
): Totals => ({
  outputTokens: t.outputTokens + outputTokens,
  apiMs: t.apiMs + durationMs,
})

// API 時間がまだなければ速度は出せない。
export const tokensPerSecond = (t: Totals): number | undefined =>
  t.apiMs > 0 ? t.outputTokens / (t.apiMs / 1000) : undefined

export const formatRate = (rate: number): string => `${Math.round(rate)} tok/s`

export const register: Register = on => {
  // モデルへのリクエスト 1 回ごとに、送ってから応答が終わるまでの時間と、
  // 生成されたトークン数を足す。サブエージェントのリクエストも数える。
  // 応答が返らなかったリクエスト（中断や失敗）はトークン数がわからないので数えない。
  on('turn.step', async function* ($, e, next) {
    // 副作用: リクエストの前後で現在時刻を読む。
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    const { usage } = result
    if (usage) {
      const endedAt = await $.clock.now()
      await update($, totals, t =>
        addRequest(t, usage.output_tokens, endedAt - startedAt),
      )
    }

    return result
  })

  // プロンプト下のモード表示（モデル名の横）に平均速度を足す。
  // 他の mod の表示を消さないよう、下の描画を包む。
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const [below, t] = await Promise.all([next(e), read($, totals)])
    const rate = tokensPerSecond(t)
    if (rate === undefined) return below

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        {below}
        <Text dimColor tabular>
          {formatRate(rate)}
        </Text>
      </Box>
    )
  })
}
