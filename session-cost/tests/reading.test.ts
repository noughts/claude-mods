import { expect, test } from 'claude-code/testing'

import { withReading, withSpawned } from '../hooks/register'

const at = (usd: number) => ({ cost: { usd }, context: {} })

const NONE = { subagent: 0, workflow: 0 }

test('並行するリクエストの読み取りが前後して届いても、コストは戻らず二重にも割り振らない', () => {
  const start = { usd: 1, usdByKind: NONE }
  // ワークフローのリクエスト A のあとに $1.50、B のあとに $2.00 と読めたが、B の読み取りが先に届いた。
  const afterB = withReading(start, at(2), 'workflow')
  const afterA = withReading(afterB, at(1.5), 'workflow')
  expect(afterA).toEqual({ usd: 2, usdByKind: { subagent: 0, workflow: 1 } })
  // 次のメインのリクエストのあとの読み取りでは、その増分だけがメインの分になる。
  expect(withReading(afterA, at(2.25), undefined)).toEqual({
    usd: 2.25,
    usdByKind: { subagent: 0, workflow: 1 },
  })
})

test('サブエージェントのリクエストのあとの増分は、サブエージェントに割り振る', () => {
  const start = { usd: 1, usdByKind: { subagent: 0.5, workflow: 1 } }
  expect(withReading(start, at(1.25), 'subagent')).toEqual({
    usd: 1.25,
    usdByKind: { subagent: 0.75, workflow: 1 },
  })
})

test('コストの台帳がなければコストを出さず、どの種類にも割り振らない', () => {
  expect(
    withReading({ usdByKind: NONE }, { context: { tokens: 10 } }, 'workflow'),
  ).toEqual({
    contextTokens: 10,
    usdByKind: NONE,
  })
})

test('ワークフローが起動したエージェントと、その中で起動されたエージェントをワークフローのものとみなす', () => {
  const workflow = { workflow: { runId: 'wf_1', agentIndex: 1 } }
  const known = withSpawned({}, workflow, 'wf-1')
  expect(known).toEqual({ 'wf-1': 'workflow' })
  expect(withSpawned(known, { parentAgentId: 'wf-1' }, 'child')).toEqual({
    'wf-1': 'workflow',
    child: 'workflow',
  })
})

test('メインや普通のサブエージェントから起動したエージェントをサブエージェントとみなす', () => {
  const known = withSpawned({ 'wf-1': 'workflow' }, {}, 'sub')
  expect(known).toEqual({ 'wf-1': 'workflow', sub: 'subagent' })
  expect(withSpawned(known, { parentAgentId: 'sub' }, 'sub-child')).toEqual({
    'wf-1': 'workflow',
    sub: 'subagent',
    'sub-child': 'subagent',
  })
})

test('再開したエージェントは、覚えた種類のままにする', () => {
  const known = { 'wf-1': 'workflow' } as const
  expect(withSpawned(known, {}, 'wf-1')).toBe(known)
})
