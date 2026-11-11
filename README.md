# claude-mods

Claude Code（ターミナルとデスクトップアプリ）向けの mod 置き場です。mod は Claude 自身の画面や挙動を変える拡張で、プラグインとしてインストールします。

## 収録している mod

### session-cost

そのセッションでかかっているコストを、プロンプト下のモデル名の左に `コスト $3.55` の形で常時表示します。

表示をクリックするか `/session-cost` を実行すると、詳細パネルが開閉します。パネルには次の項目が出ます。

- コスト（セッション累計のドル額）
- 経過時間（セッション開始からの実時間）
- 稼働時間（Claude がターンを処理していた時間の合計）
- Claude の時給（稼働時間の間に増えたコスト ÷ 稼働時間）
- トークンの内訳（入力・出力・キャッシュ読み込み・キャッシュ書き込み）
- コンテキストの使用量と割合

稼働時間・時給・トークンの内訳は、mod を入れた時点から数え始めます。表示はターンが終わるたびに更新されます。

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

## 注意

mod の API は早期アクセス段階で、Claude Code の更新で予告なく変わることがあります。動作を確認したのは Claude Code 2.1.321 のデスクトップアプリです。

## ライセンス

MIT
