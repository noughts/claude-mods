export type TokenTotals = Readonly<{
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}>

// エンジンが計測した値の写しと、そのコストのうちワークフローに割り振った分。
// エンジンが持たない値は欠ける。
export type Measured = Readonly<{
  usd?: number
  contextTokens?: number
  contextPercent?: number
  // usd のうち、ワークフロー（Ultracode など）のエージェントのリクエストに割り振った分。
  workflowUsd: number
}>

// Claude が動いていた時間と、その計測を始めた時点のコスト。
export type Active = Readonly<{
  // メインのターンの長さの合計。ツールの実行時間を含む。
  turnMs: number
  // モデルへのリクエストにかかった時間の合計。サブエージェントの分も含む。
  apiMs: number
  baselineUsd?: number
}>

// 表示に使う言語。OS の言語設定から決める。
export type Language = 'ja' | 'en'

declare module 'claude-code' {
  interface PluginState {
    'session-cost': {
      tokens: Shaped<TokenTotals>
      // tokens のうち、ワークフロー（Ultracode など）のエージェントの分。
      workflowTokens: Shaped<TokenTotals>
      // ワークフローのエージェントの id。その中で起動されたエージェントも含む。
      workflowAgents: Shaped<ReadonlyArray<string>>
      measured: Shaped<Measured>
      active: Shaped<Active>
      language: Shaped<Language>
    }
  }
}
