// 5 時間ウィンドウの最後の読み取り。エンジンが報告する SessionRateLimit の形のまま持つ。
export type Reading = Readonly<{
  kind: string
  // 0 から 100。小数点以下は 1 桁まで。
  percentUsed: number
  // ウィンドウがリセットされる時刻。ISO 8601。
  resetsAt?: string
}>

declare module 'claude-code' {
  interface PluginState {
    'five-hour-usage': {
      // まだ読み取りがなければ null。
      reading: Shaped<Reading | null>
    }
  }
}
