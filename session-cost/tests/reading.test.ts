import { expect, test } from 'claude-code/testing'

import { withReading, withSpawned } from '../hooks/register'

const at = (usd: number) => ({ cost: { usd }, context: {} })

test('並行するリクエストの読み取りが前後して届いても、コストは戻らず二重にも割り振らない', () => {
  const start = { usd: 1, workflowUsd: 0 }
  // ワークフローのリクエスト A のあとに $1.50、B のあとに $2.00 と読めたが、B の読み取りが先に届いた。
  const afterB = withReading(start, at(2), true)
  const afterA = withReading(afterB, at(1.5), true)
  expect(afterA).toEqual({ usd: 2, workflowUsd: 1 })
  // 次のメインのリクエストのあとの読み取りでは、その増分だけがメインの分になる。
  expect(withReading(afterA, at(2.25), false)).toEqual({
    usd: 2.25,
    workflowUsd: 1,
  })
})

test('コストの台帳がなければコストを出さず、ワークフローにも割り振らない', () => {
  expect(withReading({ workflowUsd: 0 }, { context: { tokens: 10 } }, true)).toEqual({
    contextTokens: 10,
    workflowUsd: 0,
  })
})

test('ワークフローが起動したエージェントと、その中で起動されたエージェントだけをワークフローのものとみなす', () => {
  const workflow = { workflow: { runId: 'wf_1', agentIndex: 1 } }
  const ids = withSpawned([], workflow, 'wf-1')
  expect(ids).toEqual(['wf-1'])
  expect(withSpawned(ids, { parentAgentId: 'wf-1' }, 'child')).toEqual([
    'wf-1',
    'child',
  ])
  // メインや普通のサブエージェントから起動したものは入れない。
  expect(withSpawned(ids, {}, 'sub')).toEqual(['wf-1'])
  expect(withSpawned(ids, { parentAgentId: 'sub' }, 'sub-child')).toEqual([
    'wf-1',
  ])
})
