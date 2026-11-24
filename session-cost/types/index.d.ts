export type TokenTotals = Readonly<{
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}>

// 合計とは別に内訳を出すエージェントの種類。
// workflow: ワークフロー（Ultracode など）が起動したエージェントと、その中で起動されたもの。
// subagent: それ以外で起動されたエージェント（Agent ツールなど）。
export type AgentKind = 'subagent' | 'workflow'

// エンジンが計測した値の写しと、そのコストのうち各種類のエージェントに割り振った分。
// エンジンが持たない値は欠ける。
export type Measured = Readonly<{
  usd?: number
  contextTokens?: number
  contextPercent?: number
  // usd のうち、その種類のエージェントのリクエストに割り振った分。
  usdByKind: Readonly<Record<AgentKind, number>>
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
      // tokens のうち、その種類のエージェントの分。
      tokensByKind: Shaped<Readonly<Record<AgentKind, TokenTotals>>>
      // 起動されたエージェントの id と、その種類。
      agents: Shaped<Readonly<Record<string, AgentKind>>>
      measured: Shaped<Measured>
      active: Shaped<Active>
      language: Shaped<Language>
    }
  }
}
