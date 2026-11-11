# claude-mods

Claude Code（ターミナルとデスクトップアプリ）向けの mod 置き場です。mod は Claude 自身の画面や挙動を変える拡張で、プラグインとしてインストールします。

## 収録している mod

### session-cost

そのセッションでかかっているコストを、プロンプト下のモデル名の左に `コスト $3.55` の形で常時表示します。

表示をクリックするか `/session-cost` を実行すると、詳細パネルが開閉します。パネルには次の項目が出ます。

- コスト（セッション累計のドル額）
- Claude の時給（API 時間の間に増えたコスト ÷ API 時間）
- 時間の内訳
  - 実時間: セッション開始からの時間。`/cost` の wall に近い値です
  - ターン処理: メインのターンの長さの合計。ビルドなどツールの実行時間を含みます
  - API: モデルへのリクエストを送ってから応答が終わるまでの時間の合計。サブエージェントの分も含み、`/cost` の API に近い値です
- トークンの内訳（入力・出力・キャッシュ読み込み・キャッシュ書き込み）
- コンテキストの使用量と割合

時給を API 時間で割るのは、ビルド待ちのようにトークンを使わない時間の長さで、プロジェクトごとに時給が変わってしまうのを避けるためです。

ターン処理・API・時給・トークンの内訳は、mod を入れた時点から数え始めます。表示はターンが終わるたびに更新されます。

表示は日本語と英語に対応しています。OS の言語が日本語なら日本語、それ以外は英語で出ます。macOS ではシステムの優先言語を、それ以外ではロケールの環境変数（`LC_ALL`、`LC_MESSAGES`、`LANG`）を見ます。

## インストール

ターミナルのセッションのプロンプトで:

```
/plugin install session-cost --marketplace noughts/claude-mods
```

シェルから:

```
claude plugin install session-cost --marketplace noughts/claude-mods
```

`Add marketplace?` と聞かれたら `y` で答え、スコープは user を選びます。

デスクトップアプリでは `/plugin` が動かないので、プロンプト欄の横の + → Plugins → Add marketplace に `noughts/claude-mods` を入力 → Add plugin の順に操作します。

## アップデート

シェルから、マーケットプレイスの情報を取り直してから mod を更新します。

```
claude plugin marketplace update noughts
```

```
claude plugin update session-cost@noughts
```

更新は、次に始めるセッションから反映されます。

## 注意

mod の API は早期アクセス段階で、Claude Code の更新で予告なく変わることがあります。動作を確認したのは Claude Code 2.1.321 のデスクトップアプリです。

## ライセンス

MIT
