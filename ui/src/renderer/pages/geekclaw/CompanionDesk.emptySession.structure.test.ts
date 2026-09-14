import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const source = readFileSync(new URL('./CompanionDesk.tsx', import.meta.url), 'utf8');

describe('companion desk keeps the hero card for an empty session', () => {
  test('probes the resolved session for turns and gates the chat phase on it', () => {
    const bootstrap = source.indexOf(
      'const res = await ipcBridge.companion.getCompanionSession.invoke('
    );
    const resolve = source.indexOf('const conv = await getConversationOrNull(id);', bootstrap);
    const probe = source.indexOf('const hasTurns = await sessionHasTurns(id);', resolve);
    const phase = source.indexOf("setPhase(hasTurns ? 'chat' : 'hero');", probe);

    expect(bootstrap).toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(bootstrap);
    expect(probe).toBeGreaterThan(resolve);
    expect(phase).toBeGreaterThan(probe);
    // 会话行存在就进 chat 分支 —— 后端在建员工时（模型已配好）或任何 ensure 入口
    // 都能铸出一个从未使用过的空会话，那样工作台只会渲染一大片空白。
    expect(source.slice(bootstrap, phase).includes("setPhase('chat');")).toBe(false);
  });

  test('the probe reads the persisted transcript instead of trusting the session row', () => {
    const helper = source.indexOf('const sessionHasTurns = async (');
    const read = source.indexOf('ipcBridge.database.getConversationMessages.invoke({', helper);
    const limit = source.indexOf('page_size: 1,', read);
    const fallback = source.indexOf('return true;', limit);

    expect(helper).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(helper);
    expect(limit).toBeGreaterThan(read);
    // 探测失败按「有消息」处理：瞬时报错不能把真有记录的员工降级回 hero 卡片。
    expect(fallback).toBeGreaterThan(limit);
  });
});
