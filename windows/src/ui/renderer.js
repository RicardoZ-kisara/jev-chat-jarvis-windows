'use strict';
const $ = id => document.getElementById(id);
const api = window.jev;
let settings, screenshot, selection, dragStart, busy = false, filling = false, ocrRunning = false, captureRunning = false, generation = 0;
let loadedConversation=null,loadRequest=0;
const labels = {confirm_you_care:'确认你是否在意',vent_anger:'表达不满或委屈',request_action:'希望你采取行动',seek_explanation:'需要事实解释',casual_chat:'轻松交流',close_topic:'平静结束话题',check_history:'先核对历史与事实',apologize:'真诚道歉',give_commitment:'给出具体承诺',explain:'解释事实',acknowledge:'接住对方的情绪',say_less:'少说一点',make_plan:'商量具体安排',apology:'一个真诚的道歉',action:'具体行动',explanation:'解释来龙去脉',care:'你的在意与关注',nothing:'暂时无需更多回应'};
function status(text, error=false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if(className)el.className=className; return el; }
function resetResults() { $('judgment').replaceChildren(); $('judgment').hidden=true; $('judgment-empty').hidden=false; $('replies').replaceChildren(); $('replies-empty').hidden=false; }
function updateBusy(value) {busy=value; for(const id of ['analyze','example','capture-open','clear','conversation-mode','conversation-search','conversation-session','conversation-refresh','conversation-memory','history-select','settings-open','history-open','ntqq-open','history-reply']) $(id).disabled=value; $('cancel').hidden=!value; $('conversation').readOnly=value; $('relationship').readOnly=value; $('analyze').textContent=value?'正在理解对话并生成回复…':'分析可能性并生成回复 ↗';}
function addReferences(target,refs,result){
  if(!refs?.length)return;
  const row=node('div',undefined,'reference-links'),detail=node('pre',undefined,'history-evidence');detail.hidden=true;
  for(const ref of refs){const button=node('button',ref);button.title='查看原始聊天依据';button.addEventListener('click',()=>{const evidence=result.evidence?.find(e=>`M${e.id}`===ref);detail.textContent=evidence?`[${ref}] ${new Date(evidence.time).toLocaleString()}\n${evidence.sender}：${evidence.text}`:'本条原文未包含在此结果中。';detail.hidden=false;});row.append(button);}
  target.append(row,detail);
}
function distribution(title,answer){
  if(!answer?.probabilities)return null;
  const detail=node('details',undefined,'probability-options');detail.append(node('summary',`${title} · 查看其他可能性`));
  for(const [key,value] of Object.entries(answer.probabilities).filter(([,value])=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1).sort((a,b)=>b[1]-a[1])){
    const row=node('div',undefined,'probability-row'),bar=document.createElement('progress');bar.max=1;bar.value=value;row.append(node('span',labels[key]||key),bar,node('strong',`${(value*100).toFixed(0)}%`));detail.append(row);
  }
  return detail;
}
function renderResult(result) {
  resetResults();
  $('judge-label').textContent=result.judgmentSource||(settings?.replyProvider==='codex'?'ChatGPT · Jev 七题结构':'Jev 判断');
  if (result.answers) {
    $('judgment').hidden=false; $('judgment-empty').hidden=true;
    const a=result.answers, score=a.danger_level?.score;
    if (typeof score==='number' && Number.isFinite(score)) {const d=node('div',undefined,'danger');d.append(node('strong',String(Math.round(score*10)/10)),node('span','对话紧张程度 · 模型估计\n请结合真实语境理解'));$('judgment').append(d);}
    const grid=node('div',undefined,'metrics');
    for (const [title,value] of [['可能的意图',a.true_intent?.choice],['对方可能需要',a.she_needs?.choice],['建议动作',a.best_action?.choice],['是否已有可实质回应的内容',typeof a.should_reply_now?.noul==='number'?(a.should_reply_now.noul>=.5?'有可回应的信息':'先核对信息，避免猜测'):null]]) {const item=node('div',undefined,'metric');item.append(node('small',title),node('strong',labels[value] || value || '暂无判断'));grid.append(item);}
    $('judgment').append(grid,node('p','模型判断存在不确定性，不代表对方的真实心理。','analysis-note'));
    for(const [title,key] of [['按字面理解的可能性','literal_question'],['紧张已缓解的可能性','tension_resolved']]){const score=a[key]?.noul;if(typeof score==='number'){const item=node('div',undefined,'metric');item.append(node('small',title),node('strong',`${(score*100).toFixed(0)}%`));grid.append(item);}}
    if(result.analysis){const block=node('div',undefined,'analysis-explanation');block.append(node('h3','判断依据'),node('p',result.analysis.summary));addReferences(block,result.analysis.refs,result);for(const note of result.analysis.uncertainties||[])block.append(node('p',note,'hint'));$('judgment').append(block);}
    for(const [title,key] of [['对方意图','true_intent'],['建议动作','best_action'],['对方需求','she_needs']]){const detail=distribution(title,a[key]);if(detail)$('judgment').append(detail);}
    if(result.probabilityNote)$('judgment').append(node('p',result.probabilityNote,'analysis-note'));
  }
  for(const warning of result.warnings || []) $('replies').append(node('p',warning,'warning'));
  if(result.historyInfo)$('replies').append(node('p',`已关联「${result.historyInfo.name}」：${result.historyInfo.total} 条历史，本次近期 ${result.historyInfo.recentCount||'手动输入'} 条，档案覆盖 ${result.historyInfo.coverage}，检索 ${result.historyInfo.evidenceCount} 条原文、${result.historyInfo.memoryCount||0} 段记忆。`,'hint'));
  if(result.generatedAt)$('replies').append(node('p',`生成于 ${new Date(result.generatedAt).toLocaleString()}${result.model?' · '+result.model:''}`,'hint'));
  if(result.replies.length) $('replies-empty').hidden=true;
  result.replies.forEach((reply,index)=>{
    const card=node('article',undefined,'reply'),top=node('div',undefined,'reply-top');
    top.append(node('span',`候选 ${String(index+1).padStart(2,'0')}${reply.strategy?' · '+reply.strategy:''}`),node('span',reply.probability===null?'未排序':`${result.rankingSource||'Jev 匹配'} ${(reply.probability*100).toFixed(0)}%`));
    const actions=node('div',undefined,'reply-actions'),copy=node('button','复制'),fill=node('button','5 秒后填入');
    copy.addEventListener('click',async()=>{try{await api.copy(reply.text);status('已复制候选，请自行粘贴并决定是否发送。');}catch(e){status(e.message,true);}});
    fill.addEventListener('click',async()=>{
      if(filling)return;
      filling=true; document.querySelectorAll('.reply-actions button').forEach(b=>b.disabled=true);
      status('请在 5 秒内点击刚才截图窗口中的空白聊天输入框；程序只填字，不发送。');
      try{await api.fill(reply.text);status('已填入并核对文字。请检查后自行决定是否发送。');}catch(e){status(`${e.message} 可使用「复制」后手动粘贴。`,true);}finally{filling=false;document.querySelectorAll('.reply-actions button').forEach(b=>b.disabled=false);}
    });
    actions.append(copy,fill);card.append(top,node('p',reply.text,'reply-text'));if(reply.reason)card.append(node('div',reply.reason,'reply-reason'));addReferences(card,reply.refs,result);card.append(actions);$('replies').append(card);
  });
}
async function runAnalysis(){
  if($('conversation-mode').value==='history'&&!loadedConversation){status('请先选择已导入的联系人或群聊。',true);return;}
  if(busy)return; updateBusy(true);resetResults();const current=++generation;status('正在请求模型；可随时取消。');
  const imported=$('conversation-mode').value==='history';
  try{const result=await api.analyze({text:$('conversation').value,relationship:$('relationship').value,historyId:imported?loadedConversation.id:$('history-select').value,...(imported?{mode:'history',revision:loadedConversation.revision}:{})});if(current===generation){if(imported)loadedConversation.analysis=result;renderResult(result);status(result.warnings.length?'分析和候选已生成，请查看结果中的提示。':'分析完成，已给出三条排序回复。选择适合你的表达，发送仍由你决定。');}}
  catch(e){if(current===generation)status(e.message,true);}finally{updateBusy(false);}
}
$('analyze').addEventListener('click',runAnalysis);
$('cancel').addEventListener('click',async()=>{await api.cancel();status('正在取消…');});
$('clear').addEventListener('click',async()=>{++generation;++loadRequest;await api.clear();loadedConversation=null;setConversationMode('manual');screenshot=null;selection=null;$('conversation').value='';$('relationship').value='';$('crop-canvas').getContext('2d').clearRect(0,0,$('crop-canvas').width,$('crop-canvas').height);$('crop-area').hidden=true;$('source-label').textContent='手动输入';resetResults();status('工作台已清空；已导入记录及会话分析仍保留在本机。');});
$('example').addEventListener('click',()=>{setConversationMode('manual');$('conversation').value='对方：明天下午一起把方案过一遍？\n我：可以，你几点方便？\n对方：三点吧，记得带上修改稿。';$('relationship').value='对方是同组同学，我们正在准备项目答辩。';resetResults();status('示例已填入；配置模型后点击分析，不会伪造分析结果。');});
for(const id of ['conversation','relationship'])$(id).addEventListener('input',()=>{if(!busy)resetResults();});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.close==='capture-dialog'&&ocrRunning)return;$(b.dataset.close).close();}));
$('capture-dialog').addEventListener('cancel',e=>{if(ocrRunning)e.preventDefault();});
function populateSettings(s) {
  settings=s;$('judge-enabled').checked=s.judgeEnabled;$('always-top').checked=s.alwaysOnTop;
  $('ntqq-root').value=s.qqDataRoot||'';
  $('reply-provider').value=s.replyProvider;$('codex-path').value=s.codexPath;$('codex-model').value=s.codexModel;
  for(const route of ['judge','reply']){for(const field of ['url','model'])$(`${route}-${field}`).value=s[route+field[0].toUpperCase()+field.slice(1)];$(`${route}-key`).value='';$(`${route}-key`).placeholder=s[`has${route[0].toUpperCase()+route.slice(1)}Key`]?'已保存 · 留空保留':'输入密钥（本机模型可留空）';$(`clear-${route}-key`).checked=false;}
  $('judge-label').textContent=s.replyProvider==='codex'?'ChatGPT · Jev 七题结构':s.judgeEnabled?'JEV 判断':'仅生成候选';
  $('judgment-empty').querySelector('p').textContent=s.replyProvider==='codex'?'选中会话并点击分析，即可查看 ChatGPT 估计的可能意图、建议动作、原文依据和三条排序回复。':s.judgeEnabled?'分析后，这里会显示对方的意图、对话紧张程度与建议动作。':'已关闭 Jev 判断与排序，下方仍可生成三条候选。';
  $('provider-label').textContent=s.replyProvider==='codex'?`ChatGPT · ${s.codexModel}`:'模型 API';
  updateProvider();
}
function updateProvider() {
  const codex=$('reply-provider').value==='codex';
  $('codex-settings').hidden=!codex;$('api-settings').hidden=codex;$('judge-settings').hidden=codex;
  $('api-settings').disabled=codex;$('judge-settings').disabled=codex;$('codex-settings').disabled=!codex;
  $('judge-enabled').disabled=codex;if(codex)$('judge-enabled').checked=false;
}
$('reply-provider').addEventListener('change',updateProvider);
$('settings-open').addEventListener('click',async()=>{try{populateSettings(await api.getSettings());$('settings-status').textContent='';$('settings-dialog').showModal();}catch(e){status(e.message,true);}});
$('settings-form').addEventListener('submit',async e=>{
  e.preventDefault();const input={judgeEnabled:$('judge-enabled').checked,alwaysOnTop:$('always-top').checked,replyProvider:$('reply-provider').value,codexPath:$('codex-path').value,codexModel:$('codex-model').value};
  for(const route of ['judge','reply']){for(const field of ['url','model','key'])input[route+field[0].toUpperCase()+field.slice(1)]=$(`${route}-${field}`).value;input[`clear${route[0].toUpperCase()+route.slice(1)}Key`]=$(`clear-${route}-key`).checked;}
  try{populateSettings(await api.saveSettings(input));$('settings-dialog').close();status(input.replyProvider==='codex'?'已选择本机 Codex 登录；分析在 OpenAI 云端完成，使用账号额度。':'设置已保存，密钥已通过 Windows 加密。');}catch(err){$('settings-status').textContent=err.message;}
});
const presets={openrouter:['https://openrouter.ai/api/v1/chat/completions','deepseek/deepseek-chat-v3.1'],deepseek:['https://api.deepseek.com/v1/chat/completions','deepseek-chat'],qwen:['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions','qwen-plus'],local:['http://127.0.0.1:11434/v1/chat/completions','qwen3:8b']};
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{const p=presets[b.dataset.preset];$('reply-url').value=p[0];$('reply-model').value=p[1];$('reply-key').value='';$('clear-reply-key').checked=true;$('settings-status').textContent='已切换预设并标记清除旧回复密钥，请填写对应服务的新密钥。';}));
async function loadWindows(){
  $('window-list').replaceChildren(node('p','正在读取窗口列表…','hint'));
  try{const windows=await api.listWindows();$('window-list').replaceChildren();if(!windows.length)$('window-list').append(node('p','未找到窗口，请打开聊天软件后刷新。','hint'));
    for(const w of windows){const b=node('button',undefined,'window-option');b.append(node('strong','QQ'),node('span',w.name));b.title=w.name;b.addEventListener('click',()=>selectWindow(w.id));$('window-list').append(b);}}
  catch(e){$('window-list').replaceChildren(node('p',e.message,'warning'));}
}
$('capture-open').addEventListener('click',()=>{$('capture-dialog').showModal();loadWindows();});
$('refresh-windows').addEventListener('click',loadWindows);
async function selectWindow(id){
  if(ocrRunning||captureRunning)return;captureRunning=true;
  $('ocr-status').textContent='正在截取选中的窗口…';
  try{const data=await api.capture(id);const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=data.dataUrl;});screenshot=img;selection={x:0,y:0,width:img.naturalWidth,height:img.naturalHeight};$('crop-area').hidden=false;$('source-label').textContent=data.name;$('ocr-status').textContent='识别仅在本机执行';drawCrop();}
  catch(e){$('ocr-status').textContent=e.message;}finally{captureRunning=false;}
}
function drawCrop(){
  if(!screenshot)return;const canvas=$('crop-canvas');const ratio=Math.min(1,740/screenshot.naturalWidth,360/screenshot.naturalHeight);canvas.width=Math.round(screenshot.naturalWidth*ratio);canvas.height=Math.round(screenshot.naturalHeight*ratio);const ctx=canvas.getContext('2d');ctx.drawImage(screenshot,0,0,canvas.width,canvas.height);const sx=canvas.width/screenshot.naturalWidth,sy=canvas.height/screenshot.naturalHeight;ctx.fillStyle='#18382b66';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(screenshot,selection.x,selection.y,selection.width,selection.height,selection.x*sx,selection.y*sy,selection.width*sx,selection.height*sy);ctx.strokeStyle='#50b786';ctx.lineWidth=2;ctx.strokeRect(selection.x*sx,selection.y*sy,selection.width*sx,selection.height*sy);
}
function point(e){const rect=$('crop-canvas').getBoundingClientRect();return {x:Math.round(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*screenshot.naturalWidth),y:Math.round(Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))*screenshot.naturalHeight)};}
$('crop-canvas').addEventListener('pointerdown',e=>{if(!screenshot||ocrRunning)return;dragStart=point(e);$('crop-canvas').setPointerCapture(e.pointerId);});
$('crop-canvas').addEventListener('pointermove',e=>{if(!dragStart)return;const p=point(e);selection={x:Math.min(p.x,dragStart.x),y:Math.min(p.y,dragStart.y),width:Math.abs(p.x-dragStart.x),height:Math.abs(p.y-dragStart.y)};drawCrop();});
$('crop-canvas').addEventListener('pointerup',()=>{dragStart=null;});
$('reset-crop').addEventListener('click',()=>{if(!screenshot||ocrRunning)return;selection={x:0,y:0,width:screenshot.naturalWidth,height:screenshot.naturalHeight};drawCrop();});
$('ocr').addEventListener('click',async()=>{
  if(ocrRunning)return;ocrRunning=true;$('ocr').disabled=true;$('ocr-status').textContent='正在启动离线 OCR…';
  try{const result=await api.recognize(selection);if(!result.text)throw new Error('未识别到文字，请重新框选或手动粘贴。');$('conversation').value=result.text;$('capture-dialog').close();resetResults();status(`已识别文字（OCR 置信度 ${Math.round(result.confidence)}%）。请删去无关行，并标注每条消息的「我：」或「对方：」。`);}
  catch(e){$('ocr-status').textContent=e.message;}finally{ocrRunning=false;$('ocr').disabled=false;}
});
api.onOcrProgress(info=>{if(ocrRunning)$('ocr-status').textContent=`本地识别中 ${Math.round((info.progress||0)*100)}%`;});
api.getSettings().then(s=>{populateSettings(s);if(s.warning)status(s.warning,true);}).catch(e=>status(e.message,true));

let sessions=[],summarizing=false;
const historyStatus=text=>{$('history-status').textContent=text;};
function setConversationMode(mode){
  $('conversation-mode').value=mode;$('imported-editor').hidden=mode!=='history';$('manual-editor').hidden=mode!=='manual';
  $('source-label').textContent=mode==='history'?(loadedConversation?.name||'已导入会话'):'手动输入 / 截图';resetResults();
}
function conversationOptions(preferred){
  const select=$('conversation-session'),old=preferred??select.value,filter=$('conversation-search').value.trim().toLowerCase();
  const visible=[...sessions].filter(s=>`${s.name} ${s.selfId}`.toLowerCase().includes(filter)).sort((a,b)=>(b.last||'').localeCompare(a.last||''));
  select.replaceChildren(new Option(visible.length?'请选择会话':'没有匹配的会话',''));
  for(const item of visible)select.add(new Option(`${item.name} · ${item.count} 条`,item.id));
  select.value=visible.some(s=>s.id===old)?old:(visible[0]?.id||'');
}
async function loadConversation(id=$('conversation-session').value){
  if(busy)return;const request=++loadRequest;loadedConversation=null;resetResults();$('recent-messages').replaceChildren();
  $('recent-info').textContent=id?'正在载入近期消息…':'请选择已导入会话；导入后无需先生成完整档案。';
  if(!id)return false;
  try{
    const data=await api.historyRecent(id);if(request!==loadRequest)return false;
    loadedConversation=data;$('source-label').textContent=data.name;
    try{localStorage.setItem('last-history-session',id);}catch{}
    $('recent-info').textContent=`共 ${data.count.toLocaleString()} 条 · 本次使用近期 ${data.messages.length} 条 · 最近记录 ${new Date(data.last).toLocaleString()}${data.analysisStale?' · 原分析已过期，请重新分析':''}`;
    for(const message of data.messages){const card=node('article',undefined,`chat-message ${message.from==='me'?'mine':''}`);card.append(node('small',`${message.ref} · ${message.from==='me'?'我':message.sender} · ${new Date(message.time).toLocaleString()}`),node('p',message.text));$('recent-messages').append(card);}
    $('recent-messages').scrollTop=$('recent-messages').scrollHeight;
    if(data.analysis&&$('conversation-mode').value==='history'){renderResult(data.analysis);status('已恢复此会话上次分析；再次分析会使用当前记录与设置。');}
    else status('会话已载入。点击「分析可能性并生成回复」开始；尚未发送到模型。');
    return true;
  }catch(error){if(request===loadRequest){$('recent-info').textContent=error.message;status(error.message,true);}return false;}
}
$('conversation-mode').addEventListener('change',async()=>{setConversationMode($('conversation-mode').value);if($('conversation-mode').value==='history')await loadConversation();else ++loadRequest;});
$('conversation-session').addEventListener('change',()=>{ $('relationship').value='';loadConversation();});
$('conversation-search').addEventListener('input',()=>{conversationOptions();loadConversation();});
$('conversation-refresh').addEventListener('click',async()=>{await refreshHistory();await loadConversation();});
$('conversation-memory').addEventListener('click',async()=>{try{await refreshHistory(loadedConversation?.id);await selectHistory();$('history-dialog').showModal();}catch(e){status(e.message,true);}});
async function refreshHistory(selected){
  sessions=await api.historyList();
  for(const id of ['history-select','history-session']){
    const select=$(id),old=id==='history-session'?(selected??select.value):select.value;
    select.replaceChildren(new Option(id==='history-session'?'新建会话':'仅使用本次对话',''));
    for(const item of sessions)select.add(new Option(`${item.name} · ${item.count} 条`,item.id));
    select.value=sessions.some(s=>s.id===old)?old:'';
  }
  let remembered;try{remembered=localStorage.getItem('last-history-session');}catch{}
  conversationOptions(selected||$('conversation-session').value||remembered);
  if(!sessions.length)setConversationMode('manual');
  if(selected)setConversationMode('history');
  if($('conversation-mode').value==='history')await loadConversation();
}
async function showProfile(id){
  $('history-profile').replaceChildren();$('history-evidence').hidden=true;
  $('profile-coverage').textContent='';
  if(!id)return;
  const profile=await api.historyProfile(id),item=sessions.find(s=>s.id===id);
  if(!profile){$('history-profile').append(node('p','尚未生成完整档案。可直接点击「分析此会话并给出回复」，使用近期消息和相关原文；完整长期档案可稍后生成。','hint'));return;}
  $('profile-coverage').textContent=`已覆盖 ${profile.covered}/${profile.total} 条 · ${profile.memoryCount||0} 段记忆${profile.revision!==item?.revision?' · 有新导入，需更新':''}`;
  for(const [key,title] of [['relationships','关系与偏好观察'],['events','关键事件'],['todos','待办与承诺']]){
    $('history-profile').append(node('h3',title));
    if(!profile.body[key].length)$('history-profile').append(node('p','暂无有依据的条目。','hint'));
    for(const entry of profile.body[key]){
      const div=node('div',undefined,'profile-entry');
      div.append(node('div',`${entry.status?({open:'待办',done:'已完成',unknown:'状态待核对'}[entry.status]+' · '):''}${entry.text}`));
      for(const ref of entry.refs){const b=node('button',ref);b.addEventListener('click',async()=>{const evidence=await api.historyEvidence(id,[ref]);$('history-evidence').textContent=evidence.map(r=>`[M${r.id}] ${r.time}\n${r.sender}：${r.text}`).join('\n\n');$('history-evidence').hidden=false;});div.append(b);}
      $('history-profile').append(div);
    }
  }
}
async function selectHistory(){
  const id=$('history-session').value,item=sessions.find(s=>s.id===id);
  $('history-name').value=item?.name||'';$('history-self').value=item?.selfId||'';
  $('history-name').readOnly=Boolean(id);$('history-self').readOnly=Boolean(id);
  $('history-stats').textContent=item?`${item.count} 条消息 · ${item.first?.slice(0,10)||'暂无'} 至 ${item.last?.slice(0,10)||'暂无'}`:'新建会话：填写名称与本人 QQ 号，再选择文件。';
  $('history-reply').disabled=!item?.count||busy||summarizing;
  $('history-plan-text').textContent='';$('history-summarize').disabled=true;
  await showProfile(id);
}
$('history-open').addEventListener('click',async()=>{try{await refreshHistory();await selectHistory();$('history-dialog').showModal();}catch(e){status(e.message,true);}});
$('history-session').addEventListener('change',()=>selectHistory().catch(e=>historyStatus(e.message)));
$('history-reply').addEventListener('click',async()=>{const id=$('history-session').value;if(!id||busy||summarizing)return;$('history-dialog').close();$('conversation-search').value='';conversationOptions(id);setConversationMode('history');$('relationship').value='';if(await loadConversation(id))await runAnalysis();});
$('history-import').addEventListener('click',async()=>{
  if(summarizing)return;
  const input={name:$('history-name').value.trim(),selfId:$('history-self').value.trim(),sessionId:$('history-session').value};
  if(!input.name){historyStatus('请填写联系人或群聊名称。');return;}
  if(!/^\d{5,12}$/.test(input.selfId)){historyStatus('请填写本人 QQ 号，用来区分你的消息与其他人的消息。');return;}
  $('history-import').disabled=true;
  try{const result=await api.historyImport(input);if(!result)return;await refreshHistory(result.id);await selectHistory();historyStatus(`已导入 ${result.added} 条，跳过重复 ${result.duplicates} 条、非文字 ${result.skipped} 条。没有发送到模型。`);}
  catch(e){historyStatus(e.message);}finally{$('history-import').disabled=false;}
});
$('history-plan').addEventListener('click',async()=>{try{const p=await api.historyPlan($('history-session').value);$('history-plan-text').textContent=`本会话 ${p.count} 条、约 ${p.characters.toLocaleString()} 字。完整分析最多 ${p.batches} 次请求；已完成的分段可续跑。目标：${p.endpoint}，模型：${p.model}。`;$('history-summarize').disabled=false;}catch(e){historyStatus(e.message);}});
$('history-summarize').addEventListener('click',async()=>{
  if(summarizing)return;summarizing=true;
  for(const id of ['history-session','history-import','history-plan','history-summarize','history-delete','history-reply'])$(id).disabled=true;
  $('history-cancel').hidden=false;historyStatus('正在生成长期档案…');
  try{await api.historySummarize($('history-session').value);historyStatus('档案生成完成。可在对话工作台选择此会话，辅助下一次回复。');}
  catch(e){historyStatus(e.message);}finally{summarizing=false;for(const id of ['history-session','history-import','history-plan','history-summarize','history-delete','history-reply'])$(id).disabled=false;$('history-cancel').hidden=true;await showProfile($('history-session').value);}
});
$('history-cancel').addEventListener('click',()=>api.historyCancel());
$('history-delete').addEventListener('click',async()=>{try{if(await api.historyDelete($('history-session').value)){await refreshHistory('');await selectHistory();historyStatus('本机副本与档案已删除，QQ 原始文件未修改。');}}catch(e){historyStatus(e.message);}});
api.onHistoryProgress(p=>historyStatus(`已完成 ${p.batch}/${p.batches} 段，覆盖 ${p.covered}/${p.total} 条；可暂停后续跑。`));
refreshHistory().catch(e=>status(e.message,true));

let ntqqBusy=false,ntqqConversations=[],ntqqAccount='';
const ntqqStatus=text=>{$('ntqq-status').textContent=text;};
function ntqqSetBusy(value){ntqqBusy=value;for(const id of ['ntqq-root','ntqq-browse','ntqq-discover','ntqq-account','ntqq-read','ntqq-import','ntqq-all','ntqq-filter'])$(id).disabled=value;$('ntqq-cancel').hidden=!value;$('ntqq-conversations').querySelectorAll('input').forEach(el=>el.disabled=value);if(!value){$('ntqq-read').disabled=!$('ntqq-account').value;$('ntqq-import').disabled=!ntqqConversations.length;}}
function renderNtqq(){
  $('ntqq-conversations').replaceChildren();const filter=$('ntqq-filter').value.trim().toLowerCase();
  for(const entry of ntqqConversations.filter(c=>`${c.name} ${c.peer}`.toLowerCase().includes(filter))){
    const label=node('label',undefined,'ntqq-row'),check=document.createElement('input');check.type='checkbox';check.checked=Boolean(entry.selected);check.disabled=ntqqBusy;check.addEventListener('change',()=>{entry.selected=check.checked;$('ntqq-all').checked=ntqqConversations.every(c=>c.selected);});
    label.append(check,node('span',entry.name),node('small',`${entry.count.toLocaleString()} 条 · ${new Date(entry.first*1000).toLocaleDateString()} — ${new Date(entry.last*1000).toLocaleDateString()}`));$('ntqq-conversations').append(label);
  }
}
async function discoverNtqq(){
  if(ntqqBusy)return;ntqqSetBusy(true);ntqqStatus('正在读取账号目录…');
  try{const accounts=await api.ntqqDiscover($('ntqq-root').value.trim());$('ntqq-account').replaceChildren();for(const item of accounts)$('ntqq-account').add(new Option(`${item.account} · ${(item.bytes/1048576).toFixed(0)} MB`,item.account));ntqqConversations=[];ntqqAccount='';renderNtqq();ntqqStatus(accounts.length?'请选择已登录的账号并读取。':'没有发现消息库，请检查目录。');}catch(e){ntqqStatus(e.message);}finally{ntqqSetBusy(false);}
}
$('ntqq-open').addEventListener('click',async()=>{$('ntqq-dialog').showModal();if(!$('ntqq-account').options.length||!$('ntqq-account').value){if($('ntqq-root').value)await discoverNtqq();}});
$('ntqq-browse').addEventListener('click',async()=>{try{const root=await api.ntqqChooseRoot();if(root){$('ntqq-root').value=root;await discoverNtqq();}}catch(e){ntqqStatus(e.message);}});
$('ntqq-discover').addEventListener('click',discoverNtqq);
$('ntqq-account').addEventListener('change',()=>{ntqqConversations=[];ntqqAccount='';renderNtqq();$('ntqq-all').checked=false;$('ntqq-import').disabled=true;});
$('ntqq-filter').addEventListener('input',renderNtqq);
$('ntqq-all').addEventListener('change',()=>{for(const c of ntqqConversations)c.selected=$('ntqq-all').checked;renderNtqq();});
$('ntqq-read').addEventListener('click',async()=>{
  if(ntqqBusy)return;const account=$('ntqq-account').value;ntqqSetBusy(true);ntqqStatus('开始读取…');
  try{const result=await api.ntqqRead(account);ntqqConversations=result.conversations;ntqqAccount=result.account;$('ntqq-all').checked=false;renderNtqq();$('ntqq-info').textContent=`${result.conversations.length} 个会话，${result.conversations.reduce((n,c)=>n+c.count,0).toLocaleString()} 条数据库记录；${result.verifiedPages.toLocaleString()} 页通过校验，合并 ${result.walFrames} 个有效日志帧。`;ntqqStatus('读取完成。请选择会话，加入本机长期档案。');}catch(e){ntqqStatus(e.message);}finally{ntqqSetBusy(false);}
});
$('ntqq-import').addEventListener('click',async()=>{
  if(ntqqBusy)return;const selected=ntqqConversations.filter(c=>c.selected).map(c=>c.key);if(!selected.length){ntqqStatus('请先勾选会话。');return;}ntqqSetBusy(true);
  try{const result=await api.ntqqImport({account:ntqqAccount,conversations:selected});await refreshHistory(result.sessions[0]);ntqqStatus(`已加入 ${result.sessions.length} 个会话：新增 ${result.added} 条，更新 ${result.updated} 条，重复 ${result.duplicates} 条，跳过 ${result.skipped} 条。${result.unsupported} 条含附件或未支持内容，其中 ${result.malformed} 条结构未解析；未调用模型。`);}catch(e){ntqqStatus(e.message);}finally{ntqqSetBusy(false);}
});
$('ntqq-cancel').addEventListener('click',()=>api.ntqqCancel());
api.onNtqqProgress(p=>ntqqStatus(p.message));
