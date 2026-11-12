import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { Reading } from '../types'

const reading = atom(
  { plugin: 'five-hour-usage', key: 'reading' } as const,
  null as Reading | null,
  { shape: 'reading-2' },
)

// API の応答が報告した使用量の上限から、5 時間ウィンドウを取り出す。
export const fiveHourOf = (
  limits: ReadonlyArray<SessionRateLimit>,
): SessionRateLimit | null => limits.find(l => l.kind === 'five_hour') ?? null

// リセット時刻を過ぎたウィンドウは、次に使うまで 0% に戻っている。
// リセット時刻が読めなければ（NaN との比較は偽）、報告された値のまま。
export const percentAt = (limit: Reading, now: number): number =>
  now >= Date.parse(limit.resetsAt ?? '') ? 0 : limit.percentUsed

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { rateLimits } = await $.session.usage()
    await update($, reading, () => fiveHourOf(rateLimits))
    // 副作用: リセット時刻を過ぎた表示を 0% に戻すため、1 分ごとに描き直す。
    // リセット時刻に合わせた 1 回のタイマーは、Mac のスリープを挟むと遅れる。
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  // 計測はターンごとに届く。使用量の上限が 1 ポイント動いたときだけ書き直す。
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits'))
      await update($, reading, () => fiveHourOf(e.rateLimits))

    return next(e)
  })

  // プロンプト下のモード表示（モデル名の左）に 5 時間ウィンドウの使用率を足す。
  // 他の mod の表示を消さないよう、下の描画を包む。
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    // 副作用: 現在時刻を読む。
    const [below, limit, now] = await Promise.all([
      next(e),
      read($, reading),
      $.clock.now(),
    ])
    if (limit === null) return below

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        {below}
        <Text dimColor tabular>
          {`5h ${Math.round(percentAt(limit, now))}%`}
        </Text>
      </Box>
    )
  })
}
