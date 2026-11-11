import type { Language } from '../types'

// 言語の候補を優先順に受け取り、最初に値があるもので決める。日本語以外は英語にする。
export const pickLanguage = (
  candidates: ReadonlyArray<string | undefined>,
): Language => {
  const first = candidates.find(candidate => candidate)

  return first !== undefined && /^ja([-_.]|$)/i.test(first) ? 'ja' : 'en'
}

// macOS の `defaults read -g AppleLanguages` の出力から、優先度が一番高い言語を取り出す。
// 出力は `(\n    "ja-JP",\n    "en-JP"\n)` の形。
export const firstAppleLanguage = (stdout: string): string | undefined =>
  /"([^"]+)"/.exec(stdout)?.[1]

const ja = {
  title: 'セッションコスト',
  commandDescription: 'このセッションのコストとトークンの内訳をパネルに表示する',
  paneOpened: 'セッションコストのパネルを開きました。',
  status: (usd: string) => `コスト ${usd}`,
  cost: 'コスト（セッション累計）',
  rate: 'Claude の時給（API 時間あたり）',
  perHour: (usd: string) => `${usd}/時間`,
  time: '時間',
  wall: '実時間（セッション開始から）',
  turn: 'ターン処理（ツール実行を含む）',
  api: 'API（モデルの応答待ち）',
  tokens: 'トークン（このパネルを入れてからの累計）',
  input: '入力',
  output: '出力',
  cacheRead: 'キャッシュ読み込み',
  cacheWrite: 'キャッシュ書き込み',
  context: 'コンテキスト',
  contextValue: (tokens: string, percent: number) => `${tokens}（${percent}%）`,
  hoursMinutes: (hours: number, minutes: number) => `${hours}時間${minutes}分`,
  minutesSeconds: (minutes: number, seconds: number) =>
    `${minutes}分${seconds}秒`,
  seconds: (seconds: number) => `${seconds}秒`,
}

export type Messages = Readonly<typeof ja>

const en: Messages = {
  title: 'Session cost',
  commandDescription: "Show this session's cost and token breakdown in a panel",
  paneOpened: 'Opened the session cost panel.',
  status: usd => `Cost ${usd}`,
  cost: 'Cost (session total)',
  rate: "Claude's hourly rate (per API time)",
  perHour: usd => `${usd}/hr`,
  time: 'Time',
  wall: 'Wall (since session start)',
  turn: 'Turns (incl. tool runs)',
  api: 'API (waiting on the model)',
  tokens: 'Tokens (since this mod was added)',
  input: 'Input',
  output: 'Output',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  context: 'Context',
  contextValue: (tokens, percent) => `${tokens} (${percent}%)`,
  hoursMinutes: (hours, minutes) => `${hours}h ${minutes}m`,
  minutesSeconds: (minutes, seconds) => `${minutes}m ${seconds}s`,
  seconds: seconds => `${seconds}s`,
}

export const messages: Readonly<Record<Language, Messages>> = { ja, en }
