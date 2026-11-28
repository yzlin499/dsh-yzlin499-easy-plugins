import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CARD_BUDGET_TOKENS,
  buildFacts,
  cardId,
  estimateTokens,
  parseClaim,
  renderCard,
} from '../lib/card.js'

/** 造一段「被折区间」的假消息：一条用户请求 + 工具调用 + 工具结果 + 失败输出。 */
function fixtureMessages() {
  return [
    { role: 'user', content: [{ type: 'text', text: '把 dsh-mcp-compat 的输出方式做成三档' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '先看实现。' },
        { type: 'tool-call', name: 'pwsh', arguments: '{"command":"npm test"}' },
      ],
    },
    {
      role: 'tool',
      content: [{
        type: 'text',
        text: 'Error: ERR_MODULE_NOT_FOUND: Cannot find module dsh-mcp-compat/client.js\n$ pnpm run check',
      }],
    },
    { role: 'assistant', content: [{ type: 'text', text: '改 dsh-mcp-compat/index.js 和 docs/README.md' }] },
  ]
}

test('buildFacts 抽取文件、命令、错误、工具名与用户原话', () => {
  const facts = buildFacts(fixtureMessages())
  assert.deepEqual(facts.files.sort(), ['docs/README.md', 'dsh-mcp-compat/client.js', 'dsh-mcp-compat/index.js'])
  assert.ok(facts.commands.some((entry) => entry.cmd.startsWith('npm test')))
  assert.ok(facts.commands.some((entry) => entry.cmd.startsWith('pnpm run check')))
  assert.ok(facts.errors.some((entry) => entry.text.includes('ERR_MODULE_NOT_FOUND')))
  assert.ok(facts.tools.some((entry) => entry.name === 'pwsh' && entry.count === 1))
  assert.equal(facts.userAsk, '把 dsh-mcp-compat 的输出方式做成三档')
})

test('buildFacts 对空输入不抛错', () => {
  for (const input of [[], undefined, null, [{ role: 'user', content: [] }]]) {
    const facts = buildFacts(input)
    assert.deepEqual(facts.files, [])
    assert.deepEqual(facts.commands, [])
    assert.deepEqual(facts.errors, [])
    assert.equal(facts.userAsk, '')
  }
})

test('renderCard 固定骨架：段落齐全、空段落写占位符', () => {
  const facts = buildFacts(fixtureMessages())
  const text = renderCard(facts, { claim: '把输出方式扩成三档并修好测试', locale: 'zh' })
  for (const title of ['做了什么', '原始请求', '涉及文件', '命令', '错误', '未闭合', '死路（别重试）']) {
    assert.ok(text.includes(`## ${title}`), `缺少段落 ${title}`)
  }
  // 未闭合 / 死路为空时写「—」，不许省略段落
  assert.ok(text.includes('## 未闭合\n—'))
  assert.ok(text.includes('## 死路（别重试）\n—'))
  assert.ok(text.startsWith('['), '第一行必须是身份行')
  assert.ok(text.includes('把输出方式扩成三档并修好测试'))
})

test('renderCard 默认不渲染取回段；retrieval 打开后才出现', () => {
  const facts = buildFacts(fixtureMessages())
  assert.ok(!renderCard(facts, {}).includes('## 取回'))
  const withTools = renderCard(facts, { retrieval: true })
  assert.ok(withTools.includes('## 取回'))
  assert.ok(withTools.includes('ask ep_'))
})

test('renderCard 缺 claim 时不崩，用占位符替身', () => {
  const text = renderCard(buildFacts(fixtureMessages()), {})
  assert.ok(text.includes('（未标注）'))
})

test('renderCard 英文 locale 走英文骨架', () => {
  const text = renderCard(buildFacts(fixtureMessages()), { locale: 'en' })
  assert.ok(text.includes('## What happened'))
  assert.ok(text.includes('## Dead ends (do not retry)'))
})

test('cardId 稳定：同输入同 id，不同输入不同 id', () => {
  const a = cardId({ userAsk: 'x' }, { turns: [1, 2] })
  const b = cardId({ userAsk: 'x' }, { turns: [1, 2] })
  const c = cardId({ userAsk: 'y' }, { turns: [1, 2] })
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^ep_[0-9a-f]{6}$/)
})

test('卡片体积在预算内（除命令/错误很多的情形）', () => {
  const facts = buildFacts(fixtureMessages())
  const tokens = estimateTokens(renderCard(facts, { claim: '一句话结论' }))
  assert.ok(tokens <= CARD_BUDGET_TOKENS, `卡片 ${tokens} tok 超出预算 ${CARD_BUDGET_TOKENS}`)
})

test('parseClaim 解析三段结构，容忍缺失与 (none)', () => {
  const full = parseClaim([
    'CLAIM: 改了三档输出并修好测试',
    'CONCLUDE:',
    '- 模板只能 AI 生成',
    '- 无参数工具走快捷卡片',
    'OPEN:',
    '- Windows 路径未验证',
  ].join('\n'))
  assert.equal(full.claim, '改了三档输出并修好测试')
  assert.deepEqual(full.conclude, ['模板只能 AI 生成', '无参数工具走快捷卡片'])
  assert.deepEqual(full.open, ['Windows 路径未验证'])

  const partial = parseClaim('CLAIM: 只是探索\nOPEN: (none)')
  assert.equal(partial.claim, '只是探索')
  assert.deepEqual(partial.conclude, [])
  assert.deepEqual(partial.open, [])

  assert.deepEqual(parseClaim(''), { claim: '', conclude: [], open: [] })
  assert.deepEqual(parseClaim('没有任何标签的自由文本').claim, '')
})
