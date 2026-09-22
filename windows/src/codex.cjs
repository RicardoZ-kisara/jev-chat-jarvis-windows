'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');

async function resolveExecutable(configured = '') {
  if (configured) {
    if (!path.isAbsolute(configured) || path.basename(configured).toLowerCase() !== 'codex.exe') throw new Error('请填写 codex.exe 的完整路径，或留空自动检测。');
    try { if ((await fs.stat(configured)).isFile()) return configured; } catch {}
    throw new Error('找不到指定的 codex.exe，请清空路径后自动检测。');
  }
  const root = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  const candidates = [];
  try {
    for (const entry of await fs.readdir(root, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, 'codex.exe');
      try { const stat = await fs.stat(file); if (stat.isFile()) candidates.push({file, time: stat.mtimeMs}); } catch {}
    }
  } catch {}
  candidates.sort((a, b) => b.time - a.time);
  if (candidates.length) return candidates[0].file;
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const file = path.join(directory.replace(/^"|"$/g, ''), 'codex.exe');
    try { if ((await fs.stat(file)).isFile()) return file; } catch {}
  }
  throw new Error('未检测到 Codex CLI。请安装并登录 Codex，或填写 codex.exe 的完整路径。');
}

function buildArgs(model) {
  const disabled = ['shell_tool','unified_exec','apps','plugins','remote_plugin','browser_use','browser_use_external','computer_use','memories','multi_agent','hooks','image_generation','skill_search','code_mode_host','code_mode','code_mode_only','sleep_tool','view_image','workspace_dependencies'];
  return ['-a','never','exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--model',model,
    '-c','model_provider="openai"','-c','model_reasoning_effort="low"','-c','web_search="disabled"',
    '-c',`model_instructions_file=${JSON.stringify(path.join(__dirname, 'codex-instructions.md'))}`,
    '-c','suppress_unstable_features_warning=true',
    ...disabled.flatMap(feature => ['--disable', feature]), '--enable','skip_host_skill_discovery',
    '--output-schema',path.join(__dirname,'codex-response.schema.json'),'-'];
}
function safeFailure(raw) {
  if (/usage.limit|rate.limit|quota|429/i.test(raw)) return 'ChatGPT/Codex 额度不足或请求限流，请稍后再试。';
  if (/unauthorized|not logged|refresh.token|401|authentication/i.test(raw)) return 'Codex 登录已失效，请在 Codex 中重新登录 ChatGPT 后重试。';
  if (/model.*(not supported|not found|does not exist|unavailable)/i.test(raw)) return '当前账号不可用此模型，请在设置中修改 Codex 模型名称。';
  return 'Codex 推理失败。请检查 Codex 登录、模型权限和网络后重试。';
}
async function generate({executable, model, messages}, signal, options = {}) {
  if (signal?.aborted) throw new Error('已取消分析。');
  const file = await resolveExecutable(executable);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-codex-'));
  try {
    // Preserve official cached authentication; never read or copy account tokens.
    const env = {...process.env};
    for (const key of ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL']) delete env[key];
    return await new Promise((resolve, reject) => {
      let child, finished = false, output = '', finalText = '', diagnostic = '', bytes = 0, completed = false;
      let timer;
      const finish = (error, value) => {
        if (finished) return;
        finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) child?.kill();
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(new Error('已取消分析。'));
      const event = line => {
        if (!line.trim() || finished) return;
        let value; try { value = JSON.parse(line); } catch { return; }
        if (value.type === 'turn.completed') completed = true;
        if (value.type === 'turn.failed' || value.type === 'error') {
          finish(new Error(safeFailure(JSON.stringify(value)))); return;
        }
        const item = value.item;
        if (!item) return;
        if (['command_execution','mcp_tool_call','web_search','file_change'].includes(item.type)) {
          finish(new Error('Codex 尝试执行文本分析之外的操作，本次请求已停止。')); return;
        }
        if (value.type === 'item.completed' && item.type === 'agent_message') finalText = item.text;
        if (item.type === 'error') diagnostic = String(item.message || '').slice(-2000);
      };
      try { child = (options.spawn || spawn)(file, buildArgs(model), {cwd: work, env, windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe']}); }
      catch { finish(new Error('无法启动 Codex CLI，请检查安装。')); return; }
      child.on('error', () => finish(new Error('无法启动 Codex CLI，请检查安装。')));
      child.stdin.on('error', () => {});
      timer = setTimeout(() => finish(new Error('Codex 推理超过 3 分钟，已停止本次请求；可稍后重试。')), options.timeoutMs || 180000);
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) { abort(); return; }
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 2 * 1024 * 1024) { finish(new Error('Codex 输出过大，本次请求已停止。')); return; }
        output += chunk;
        let index;
        while ((index = output.indexOf('\n')) !== -1) { const line = output.slice(0,index); output = output.slice(index+1); event(line); }
      });
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
      child.on('close', code => {
        event(output);
        if (finished) return;
        if (code !== 0 || !completed) { finish(new Error(safeFailure(diagnostic))); return; }
        try {
          const result = JSON.parse(finalText);
          if (typeof result.content !== 'string' || !result.content.trim()) throw new Error();
          finish(null, result.content);
        } catch { finish(new Error('Codex 返回格式不正确，请重试。')); }
      });
      child.stdin.end(JSON.stringify({applicationInstruction: messages[0].content, data: messages.slice(1).map(message => message.content)}) + '\n');
    });
  } finally {
    // Only remove our newly created empty working directory, never account data.
    await fs.rmdir(work).catch(() => {});
  }
}
module.exports = {resolveExecutable, buildArgs, generate, safeFailure};
