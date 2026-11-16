// mod を入れてから、応答が返ったモデルへのリクエストの合計。
export type Totals = Readonly<{
  // 生成されたトークン数。思考のトークンを含む。
  outputTokens: number
  // リクエストを送ってから応答が終わるまでの時間の合計。
  apiMs: number
}>

declare module 'claude-code' {
  interface PluginState {
    'tokens-per-second': {
      totals: Shaped<Totals>
    }
  }
}
