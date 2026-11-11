export type TokenTotals = Readonly<{
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}>

// エンジンが計測した値の写し。エンジンが持たない値は欠ける。
export type Measured = Readonly<{
  usd?: number
  contextTokens?: number
  contextPercent?: number
}>

// Claude が動いていた時間と、その計測を始めた時点のコスト。
export type Active = Readonly<{
  // メインのターンの長さの合計。ツールの実行時間を含む。
  turnMs: number
  // モデルへのリクエストにかかった時間の合計。サブエージェントの分も含む。
  apiMs: number
  baselineUsd?: number
}>

declare module 'claude-code' {
  interface PluginState {
    'session-cost': {
      tokens: Shaped<TokenTotals>
      measured: Shaped<Measured>
      active: Shaped<Active>
    }
  }
}
