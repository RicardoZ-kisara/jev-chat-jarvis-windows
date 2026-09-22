const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const codex = require('../src/codex.cjs');
const {DEFAULTS, validateSettings, analyze} = require('../src/core.cjs');
const {HistoryStore, normalizeHistory, summarizeHistory} = require('../src/history.cjs');

async function fixture(t, action) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-codex-test-'));
  const executable = path.join(dir, 'codex.exe'); await fs.writeFile(executable, 'test stub only');
  t.after(async () => {await fs.unlink(executable); await fs.rmdir(dir);});
  const call = {};
  const spawn = (file, args, options) => {
    Object.assign(call, {file, args, options});
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => {call.killed = true;};
    let prompt = ''; child.stdin.on('data', x => {prompt += x.toString();});
    child.stdin.on('finish', () => {call.prompt = prompt; action(child, call);});
    return child;
  };
  return {call, run: (signal, timeoutMs) => codex.generate({executable, model: 'gpt-6-astra', messages: [{content:'Return JSON.'},{content:'private chat " & exit'}]}, signal, {spawn, timeoutMs})};
}
function output(child, content) {
  const event = JSON.stringify({type:'item.completed', item:{type:'agent_message',text:JSON.stringify({content})}});
  const data = Buffer.from(event+'\n'+JSON.stringify({type:'turn.completed'})+'\n');
  // Includes split UTF-8 characters as a real streaming child process can.
  for (const byte of data) child.stdout.write(Buffer.from([byte]));
  child.emit('close', 0);
}
test('CLI transport streams UTF-8, uses stdin and excludes secrets from args', async t => {
  const f = await fixture(t, child => output(child, '["你好","收到","可以"]'));
  assert.deepEqual(JSON.parse(await f.run()), ['你好','收到','可以']);
  assert.equal(f.call.options.shell, false); assert.equal(f.call.options.windowsHide, true);
  assert.ok(f.call.args.includes('--ephemeral')); assert.ok(f.call.args.includes('read-only'));
  assert.ok(!f.call.args.join(' ').includes('private chat'));
  assert.ok(f.call.prompt.includes('private chat'));
  assert.equal(f.call.options.env.OPENAI_API_KEY, undefined);
});
test('aborting kills the inference process and cannot return a late success', async t => {
  const controller = new AbortController();
  const f = await fixture(t, child => {controller.abort(); output(child, 'late answer');});
  await assert.rejects(f.run(controller.signal), /取消/); assert.equal(f.call.killed, true);
});
test('timeouts kill the process; tool events fail closed', async t => {
  const stalled = await fixture(t, () => {});
  await assert.rejects(stalled.run(null, 10), /已停止/); assert.equal(stalled.call.killed, true);
  const tool = await fixture(t, child => child.stdout.write(JSON.stringify({type:'item.started',item:{type:'command_execution'}})+'\n'));
  await assert.rejects(tool.run(), /操作/); assert.equal(tool.call.killed, true);
});
test('CLI failure never reflects private diagnostics', async t => {
  const f = await fixture(t, child => {child.stderr.write('SECRET CHAT token=SECRET HTTP 429');child.emit('close',1);});
  await assert.rejects(f.run(), error => /额度|限流/.test(error.message) && !error.message.includes('SECRET'));
});
test('Codex provides complete model judgment and ranked replies without using either HTTP service', async t => {
  let called;
  t.mock.method(codex, 'generate', async options => {called=options; return JSON.stringify(require('./helpers/decision.cjs')());});
  const settings = validateSettings({...DEFAULTS,replyProvider:'codex',judgeKey:'private',replyKey:'private'});
  assert.equal(settings.judgeEnabled,false);
  const result = await analyze({text:'对方：你好'}, {...settings,judgeEnabled:true}, null, () => {throw new Error('Unexpected HTTP');});
  assert.equal(result.replies.length,3); assert.equal(Object.keys(result.answers).length,7);assert.ok(Math.abs(result.replies[0].probability-.6)<1e-10);assert.match(result.judgmentSource,/ChatGPT/);
  assert.equal(called.model, settings.codexModel); assert.ok(!JSON.stringify(called).includes('private'));
});
test('history uses Codex with valid references and resumes saved checkpoints', async t => {
  let calls = 0;
  t.mock.method(codex,'generate',async () => {calls++; return JSON.stringify({relationships:[],events:[],todos:[{text:'明天核对修改稿',refs:['M1'],status:'open'}]});});
  const store = new HistoryStore(':memory:'); t.after(() => store.close());
  const id=store.import(normalizeHistory(JSON.stringify([{sender:'100002',text:'明天核对修改稿',time:'2026-09-22 10:00:00'}]),{name:'合成测试',selfId:'100001'})).id;
  const settings=validateSettings({...DEFAULTS,replyProvider:'codex'});
  await summarizeHistory(store,id,settings);
  await summarizeHistory(store,id,settings);
  assert.equal(calls,1); assert.equal(store.profile(id).covered,1);
  assert.equal(store.profile(id).model,`codex:${settings.codexModel}`);
});
