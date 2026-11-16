import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const SESSION_MODE = {
  plugin: 'tokens-per-second',
  component: 'SessionMode',
  surface: 'desktop',
  props: { modes: ['focus'] },
} as const

// エンジンの代役が答えるリクエスト 1 回分。output が null なら応答が返らなかった。
type Request = Readonly<{ ms: number; output: number | null }>

// エンジンの代役: ターン id ごとに決まった時間をかけてリクエストに答え、
// モード表示はラベルをそのまま 1 行に描く。
const answerEngine = (on: On, requests: Readonly<Record<string, Request>>) => {
  let now = 0
  on('clock.now', () => ({ value: now }))
  on('turn.step', async function* (_, e) {
    const request = requests[e.turnId]
    if (request === undefined) throw new Error(`unknown turn: ${e.turnId}`)
    now += request.ms

    return {
      ...e,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage:
        request.output === null
          ? null
          : {
              model: 'claude-opus-5-5',
              input_tokens: 10,
              output_tokens: request.output,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
    }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const modes = e.component === 'SessionMode' ? e.props.modes : []

    return <Text>{modes.join(' & ')}</Text>
  })
}

// ストリームは最後まで読んで初めて終わる。
const readAll = async (stream: AsyncIterable<unknown>) => {
  for await (const _ of stream);
}

test('リクエストの合計時間あたりの出力トークン数を、他の表示の横に出す', async ($, on) => {
  answerEngine(on, {
    main: { ms: 20_000, output: 1200 },
    sub: { ms: 10_000, output: 300 },
    aborted: { ms: 60_000, output: null },
  })

  const ui = await $.ui.mount(SESSION_MODE)
  const rateText = async () =>
    (await ui.find({ type: 'Text', text: /tok\/s$/ }))?.text
  // まだリクエストがなければ何も足さない。
  expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
  expect(await rateText()).toBeUndefined()

  await readAll($.turn.step({ turnId: 'main', index: 0, model: 'm', messageCount: 1 }))
  // 1200 トークンを 20 秒で。
  expect(await rateText()).toBe('60 tok/s')

  // サブエージェントのリクエストも数える。応答が返らなかったリクエストは数えない。
  await readAll(
    $.turn.step({
      turnId: 'sub',
      index: 0,
      model: 'm',
      messageCount: 1,
      agentId: 'agent-1',
    }),
  )
  await readAll(
    $.turn.step({ turnId: 'aborted', index: 1, model: 'm', messageCount: 3 }),
  )
  // 1500 トークンを 30 秒で。
  expect(await rateText()).toBe('50 tok/s')
  expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
  await ui.unmount()
})
