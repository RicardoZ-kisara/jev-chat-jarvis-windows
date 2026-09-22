'use strict';
const {app, BrowserWindow, ipcMain, clipboard, safeStorage, nativeImage, session, dialog} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {DEFAULTS, validateSettings, analyze, generationModel} = require('./core.cjs');
const {HistoryStore, normalizeHistory, chunks, summarizeHistory} = require('./history.cjs');
const ntqq = require('./ntqq.cjs');
const {randomUUID} = require('node:crypto');
const isTest = process.argv.includes('--smoke-test') && Boolean(process.env.JEV_TEST_DATA);
if (isTest && process.env.JEV_TEST_DATA) app.setPath('userData', process.env.JEV_TEST_DATA);
let win, settings = {...DEFAULTS}, controller, worker, ocrBusy = false, fillBusy = false;
let history, summaryController;
let ntqqController;
const ntqqAccounts=new Map(),ntqqSnapshots=new Map();
let knownSources = new Map(), selectedSource = null, capture = null;
const page = pathToFileURL(path.join(__dirname, 'ui/index.html')).href;
const configPath = () => path.join(app.getPath('userData'), 'settings.json');
function publicSettings() {
  const {judgeKey, replyKey, ...rest} = settings;
  return {...rest, hasJudgeKey: Boolean(judgeKey), hasReplyKey: Boolean(replyKey)};
}
async function readSettings() {
  try {
    const saved = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    const keys = saved.encryptedKeys ? JSON.parse(safeStorage.decryptString(Buffer.from(saved.encryptedKeys, 'base64'))) : {};
    settings = validateSettings({...saved, ...keys});
  } catch (error) {
    if (error.code !== 'ENOENT') return '本地设置无法解密或读取，已使用默认配置，请重新填写密钥。';
  }
  return '';
}
async function saveSettings(input) {
  const retainedKey = route => {
    if (input[`${route}Key`]?.trim()) return input[`${route}Key`].trim();
    if (input[`clear${route[0].toUpperCase()+route.slice(1)}Key`]) return '';
    if (new URL(input[`${route}Url`] || settings[`${route}Url`]).origin !== new URL(settings[`${route}Url`]).origin) return '';
    return settings[`${route}Key`];
  };
  const next = validateSettings({...settings, ...input,
    judgeKey: retainedKey('judge'), replyKey: retainedKey('reply')});
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 密钥加密不可用，未保存设置。');
  const {judgeKey, replyKey, ...rest} = next;
  const encryptedKeys = safeStorage.encryptString(JSON.stringify({judgeKey, replyKey})).toString('base64');
  await fs.mkdir(app.getPath('userData'), {recursive: true});
  await fs.writeFile(`${configPath()}.tmp`, JSON.stringify({...rest, encryptedKeys}), 'utf8');
  await fs.rename(`${configPath()}.tmp`, configPath());
  settings = next;
  win.setAlwaysOnTop(settings.alwaysOnTop);
  return publicSettings();
}
function handle(name, handler) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Untrusted IPC sender');
    try { return {ok: true, value: await handler(...args)}; }
    catch (e) { return {ok: false, error: e.message}; }
  });
}
async function sources() {
  const list = await new Promise((resolve,reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'../native/list-qq.ps1'),'-TestProcessId',String(isTest?process.pid:0)],
      {windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('读取 QQ 窗口超时。'));},15000);
    child.stdout.on('data',data=>{output+=data.toString('utf8');});child.stderr.resume();
    child.on('error',()=>{clearTimeout(timer);reject(new Error('无法读取 QQ 窗口。'));});
    child.on('close',()=>{clearTimeout(timer);try{const data=JSON.parse(output.trim());if(!data.ok)reject(new Error(data.error));else resolve(data.windows);}catch{reject(new Error('无法读取 QQ 窗口。'));}});
  });
  knownSources = new Map(list.map(s => [s.id, s]));
  return list.map(s => ({id:s.id,name:s.name}));
}
async function takeCapture(id) {
  if (ocrBusy) throw new Error('请等待当前识别完成。');
  if (!knownSources.has(id) || !/^window:\d+:\d+$/.test(id)) throw new Error('请重新选择窗口。');
  const {name, processId} = knownSources.get(id);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../native/capture.ps1'), '-TargetHandle', id.split(':')[1]],
      {windowsHide: true, stdio: ['pipe','pipe','pipe']});
    let output = '';
    const timer = setTimeout(() => {child.kill(); reject(new Error('窗口截图超时，请恢复窗口或手动粘贴对话。'));}, 15000);
    child.stdout.on('data', data => { output += data.toString('utf8'); });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => {clearTimeout(timer); reject(new Error('无法启动 Windows 截图服务。'));});
    child.on('close', () => {clearTimeout(timer); try {const data=JSON.parse(output.trim());if(!data.ok)reject(new Error(data.error));else resolve(data);}catch {reject(new Error('窗口截图失败，请手动粘贴对话。'));}});
    child.stdin.end(JSON.stringify({title: name, processId})+'\n');
  });
  capture = nativeImage.createFromBuffer(Buffer.from(result.image, 'base64'));
  if (capture.isEmpty()) throw new Error('未得到有效截图。');
  const dimensions = capture.getSize();
  if (Math.max(dimensions.width, dimensions.height) > 4000) capture = capture.resize(dimensions.width > dimensions.height ? {width: 4000} : {height: 4000});
  selectedSource = {id, name, processId};
  return {dataUrl: capture.toDataURL(), ...capture.getSize(), name};
}
async function recognize(rect) {
  if (ocrBusy) throw new Error('正在识别，请稍候。');
  if (!capture) throw new Error('请先截取窗口。');
  const size = capture.getSize();
  if (!rect || ['x','y','width','height'].some(k => !Number.isInteger(rect[k])) || rect.x < 0 || rect.y < 0 || rect.width < 10 || rect.height < 10 || rect.x + rect.width > size.width || rect.y + rect.height > size.height) throw new Error('请选择有效的聊天区域。');
  const buffer = capture.crop(rect).toPNG();
  ocrBusy = true;
  try {
    if (!worker) {
      const {createWorker} = require('tesseract.js');
      worker = await createWorker(['chi_sim', 'eng'], 1, {
        langPath: app.isPackaged ? path.join(process.resourcesPath, 'ocr') : path.join(__dirname, '../resources/ocr'),
        cacheMethod: 'none', gzip: true,
        logger: info => { if (!win.isDestroyed()) win.webContents.send('ocr-progress', {status: info.status, progress: info.progress}); }
      });
    }
    const result = await worker.recognize(buffer);
    return {text: result.data.text.trim(), confidence: result.data.confidence};
  } catch { throw new Error('本地 OCR 识别失败。请确认离线模型文件完整，或直接粘贴对话文本。'); }
  finally { ocrBusy = false; }
}
function fillReply(text) {
  if (fillBusy) throw new Error('已有填入操作正在等待，请先完成。');
  if (!selectedSource) throw new Error('请先选择并截取目标聊天窗口。');
  if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new Error('候选回复不合法。');
  const hwnd = selectedSource.id.split(':')[1];
  const targetTitle = selectedSource.name;
  const targetProcessId = selectedSource.processId;
  fillBusy = true;
  return new Promise((resolve, reject) => {
    // Fixed script, arguments and stdin only. Never interpolate chat text into a shell.
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../native/fill.ps1'), '-TargetHandle', hwnd],
      {windowsHide: true, stdio: ['pipe','pipe','pipe']});
    let output = '';
    const timer = setTimeout(() => {child.kill(); reject(new Error('填入超时，未确认完成，请检查输入框。'));}, 15000);
    child.stdout.on('data', data => {output += data.toString('utf8');});
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => {clearTimeout(timer); fillBusy = false; reject(new Error('无法启动 Windows 填入服务，请使用复制。'));});
    child.on('close', () => {
      clearTimeout(timer); fillBusy = false;
      try {
        const result = JSON.parse(output.trim());
        if (!result.ok) reject(new Error(result.error)); else resolve(result);
      } catch { reject(new Error('目标输入框不支持安全填入，请使用复制后自行粘贴。')); }
    });
    child.stdin.end(JSON.stringify({text, title: targetTitle, processId: targetProcessId, testProcessId: isTest?process.pid:0}) + '\n');
  });
}
app.whenReady().then(async () => {
  const warning = await readSettings();
  await fs.mkdir(app.getPath('userData'), {recursive: true});
  history = new HistoryStore(path.join(app.getPath('userData'), 'qq-history.sqlite'));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({width: 1260, height: 890, minWidth: 960, minHeight: 700,
    title: 'Jev QQ Windows', icon: path.join(__dirname, '../resources/icon.ico'), backgroundColor: '#f5f6f8', autoHideMenuBar: true,
    alwaysOnTop: settings.alwaysOnTop,
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false}
  });
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  handle('settings:get', () => ({...publicSettings(), warning}));
  handle('settings:save', saveSettings);
  handle('windows:list', sources);
  handle('windows:capture', takeCapture);
  handle('ocr:recognize', recognize);
  handle('analysis:run', async input => {
    if (controller || summaryController || ntqqController) throw new Error('正在处理数据，请等待或暂停当前任务。');
    controller = new AbortController();
    try {
      const historyContext = input.historyId ? history.context(input.historyId, input.text) : null;
      const result = await analyze({text:input.text,relationship:input.relationship,historyContext}, {...settings}, controller.signal);
      return {...result,historyInfo:historyContext?{name:historyContext.sessionName,total:historyContext.total,coverage:historyContext.profileCoverage,evidenceCount:historyContext.evidence.length}:null};
    }
    finally { controller = null; }
  });
  handle('analysis:cancel', () => {controller?.abort();});
  handle('clipboard:copy', text => {
    if (typeof text !== 'string' || text.length > 16000) throw new Error('文本不合法。');
    clipboard.writeText(text);
  });
  handle('reply:fill', fillReply);
  handle('session:clear', () => {controller?.abort(); capture = null; selectedSource = null;});
  handle('history:list', () => history.list());
  handle('history:import', async input => {
    if (summaryController || ntqqController) throw new Error('请先暂停当前任务，再导入新记录。');
    const picked=await dialog.showOpenDialog(win,{title:'导入 QQ 聊天导出文件',properties:['openFile'],filters:[{name:'QQ 可读聊天记录',extensions:['json','txt']}]});
    if(picked.canceled)return null;
    const file=picked.filePaths[0],extension=path.extname(file).toLowerCase();
    if(!['.json','.txt'].includes(extension))throw new Error('仅支持 JSON/TXT 明文导出；QQ NT 原始数据库不能直接导入。');
    if((await fs.stat(file)).size>50*1024*1024)throw new Error('单文件最多 50 MB，请按联系人或日期拆分。');
    const buffer=await fs.readFile(file);
    let raw;
    try{raw=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new Error('文件不是 UTF-8 编码，请先另存为 UTF-8 后导入。');}
    const data=normalizeHistory(raw,{name:input.name,selfId:input.selfId,format:extension.slice(1)});
    return history.import(data,input.sessionId||undefined);
  });
  handle('history:profile', id => {const p=history.profile(String(id));return p?{...p,memoryCount:history.memoryCount(String(id))}:null;});
  handle('history:plan', id => {const item=history.list().find(s=>s.id===id);if(!item)throw new Error('请选择历史会话。');const rows=history.rows(id);return {...item,batches:chunks(rows).length,characters:rows.reduce((n,r)=>n+r.text.length,0),endpoint:settings.replyProvider==='codex'?'OpenAI 云端（本机 Codex / ChatGPT 登录）':new URL(settings.replyUrl).origin,model:generationModel(settings)};});
  handle('history:summarize', async id => {
    if(summaryController||controller||ntqqController)throw new Error('已有任务进行中，请等待或暂停。');
    summaryController=new AbortController();
    try{return await summarizeHistory(history,String(id),{...settings},summaryController.signal,progress=>win.webContents.send('history-progress',progress));}
    finally{summaryController=null;}
  });
  handle('history:cancel', () => summaryController?.abort());
  handle('history:evidence', (id,refs) => history.evidence(String(id),refs));
  handle('history:delete', async id => {
    if(summaryController||ntqqController)throw new Error('请先暂停当前任务。');
    const result=await dialog.showMessageBox(win,{type:'warning',buttons:['取消','删除导入副本'],defaultId:0,cancelId:0,message:'删除此会话在助手中的聊天记录及长期档案？',detail:'不会修改 QQ 的原始文件或你导入的导出文件。'});
    if(result.response===1){history.remove(String(id));return true;}return false;
  });
  handle('ntqq:discover', async root => {
    if(ntqqController)throw new Error('正在读取，请稍候。');
    if(typeof root!=='string'||!path.isAbsolute(root)||root.length>2048)throw new Error('请选择 Tencent Files 的完整目录。');
    const accounts=await ntqq.discover(root);ntqqAccounts.clear();for(const account of accounts)ntqqAccounts.set(account.account,account);
    await saveSettings({qqDataRoot:root});return accounts;
  });
  handle('ntqq:choose-root', async () => {
    const result=await dialog.showOpenDialog(win,{title:'选择 QQ Tencent Files 目录',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];
  });
  handle('ntqq:read', async account => {
    if(controller||summaryController||ntqqController)throw new Error('已有任务进行中，请等待或暂停。');
    const source=ntqqAccounts.get(String(account));if(!source)throw new Error('请先扫描目录并选择账号。');
    ntqqController=new AbortController();
    const workspace=path.join(app.getPath('userData'),'ntqq-snapshots',`snapshot-${randomUUID()}`);
    const executable=path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'../resources'),'ntqq','Jev.NtqqBridge.exe');
    try{
      const result=await ntqq.extract(executable,source.sourceDb,workspace,ntqqController.signal,p=>{if(!win.isDestroyed())win.webContents.send('ntqq-progress',p);});
      const conversations=ntqq.inspectSnapshot(result.path);
      const previous=ntqqSnapshots.get(source.account);
      ntqqSnapshots.set(source.account,{...result,workspace,conversations});
      if(previous)await discardSnapshot(previous.workspace);
      // Keep only the verified plaintext working copy, with a hash-only manifest.
      for(const name of ['encrypted.db','encrypted.db-wal'])await fs.unlink(path.join(workspace,name)).catch(()=>{});
      return {account:source.account,conversations,pages:result.pages,verifiedPages:result.verifiedPages,walFrames:result.walFrames,capturedAt:result.capturedAt};
    }catch(error){await discardSnapshot(workspace);throw error;}
    finally{ntqqController=null;}
  });
  handle('ntqq:import',async input=>{
    if(controller||summaryController||ntqqController)throw new Error('已有任务进行中，请等待或暂停。');
    const snapshot=ntqqSnapshots.get(String(input.account));if(!snapshot)throw new Error('请先读取这个账号的数据库。');
    if(!Array.isArray(input.conversations)||!input.conversations.length)throw new Error('请至少选择一个会话。');
    const wanted=new Set(input.conversations),selected=snapshot.conversations.filter(c=>wanted.has(c.key));
    if(selected.length!==wanted.size)throw new Error('会话列表已变化，请重新读取。');
    ntqqController=new AbortController();const result={added:0,updated:0,duplicates:0,skipped:0,unsupported:0,malformed:0,sessions:[]};
    try{
      for(const conversation of selected){
        const id=history.sourceSession(String(input.account),conversation.key,conversation.name);
        for(const batch of ntqq.readConversation(snapshot.path,conversation,String(input.account))){
          if(ntqqController.signal.aborted)throw new Error('已停止导入；已完成的批次保留，重试会去重。');
          const imported=history.import({name:conversation.name,selfId:String(input.account),messages:batch.messages,skipped:batch.skipped},id,{updateExisting:true});
          for(const key of ['added','updated','duplicates','skipped'])result[key]+=imported[key]||0;
          result.unsupported+=batch.unsupported;result.malformed+=batch.malformed;
          win.webContents.send('ntqq-progress',{message:`已处理 ${result.added+result.updated+result.duplicates} 条；${result.sessions.length}/${selected.length} 个会话。`});
          await new Promise(resolve=>setImmediate(resolve));
        }
        result.sessions.push(id);
      }
      return result;
    }finally{ntqqController=null;}
  });
  handle('ntqq:cancel',()=>ntqqController?.abort());
  await win.loadURL(page);
});
async function discardSnapshot(workspace){
  const root=path.resolve(app.getPath('userData'),'ntqq-snapshots');
  const target=path.resolve(workspace);
  if(path.dirname(target)!==root||!/^snapshot-[0-9a-f-]{36}$/.test(path.basename(target)))throw new Error('无效的临时副本目录。');
  for(const file of ['encrypted.db','encrypted.db-wal','messages.sqlite','messages.sqlite-wal','messages.sqlite-shm','snapshot.json'])await fs.unlink(path.join(target,file)).catch(()=>{});
  await fs.rmdir(target).catch(()=>{});
}
app.on('window-all-closed', () => {controller?.abort(); summaryController?.abort(); ntqqController?.abort(); worker?.terminate(); app.quit();});
