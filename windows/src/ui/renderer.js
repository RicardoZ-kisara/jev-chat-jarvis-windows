'use strict';
const $ = id => document.getElementById(id);
const api = window.jev;
let settings, screenshot, selection, dragStart, busy = false, filling = false, ocrRunning = false, captureRunning = false, generation = 0;
const labels = {confirm_you_care:'确认你是否在意',vent_anger:'表达不满或委屈',request_action:'希望你采取行动',seek_explanation:'需要事实解释',casual_chat:'轻松交流',close_topic:'平静结束话题',check_history:'先核对历史与事实',apologize:'真诚道歉',give_commitment:'给出具体承诺',explain:'解释事实',acknowledge:'接住对方的情绪',say_less:'少说一点',make_plan:'商量具体安排',apology:'一个真诚的道歉',action:'具体行动',explanation:'解释来龙去脉',care:'你的在意与关注',nothing:'暂时无需更多回应'};
function status(text, error=false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if(className)el.className=className; return el; }
function resetResults() { $('judgment').replaceChildren(); $('judgment').hidden=true; $('judgment-empty').hidden=false; $('replies').replaceChildren(); $('replies-empty').hidden=false; }
function updateBusy(value) {busy=value; for(const id of ['analyze','example','capture-open','clear']) $(id).disabled=value; $('cancel').hidden=!value; $('conversation').readOnly=value; $('relationship').readOnly=value; $('analyze').textContent=value?'正在理解对话…':'分析对话 ↗';}
function renderResult(result) {
  resetResults();
  if (result.answers) {
    $('judgment').hidden=false; $('judgment-empty').hidden=true;
    const a=result.answers, score=a.danger_level?.score;
    if (typeof score==='number' && Number.isFinite(score)) {const d=node('div',undefined,'danger');d.append(node('strong',String(Math.round(score*10)/10)),node('span','对话紧张程度 · 模型估计\n请结合真实语境理解'));$('judgment').append(d);}
    const grid=node('div',undefined,'metrics');
    for (const [title,value] of [['可能的意图',a.true_intent?.choice],['对方可能需要',a.she_needs?.choice],['建议动作',a.best_action?.choice],['是否已有可实质回应的内容',typeof a.should_reply_now?.noul==='number'?(a.should_reply_now.noul>=.5?'有可回应的信息':'先核对信息，避免猜测'):null]]) {const item=node('div',undefined,'metric');item.append(node('small',title),node('strong',labels[value] || value || '暂无判断'));grid.append(item);}
    $('judgment').append(grid,node('p','模型判断存在不确定性，不代表对方的真实心理。','analysis-note'));
  }
  for(const warning of result.warnings || []) $('replies').append(node('p',warning,'warning'));
  if(result.historyInfo)$('replies').append(node('p',`已关联「${result.historyInfo.name}」：${result.historyInfo.total} 条历史，档案覆盖 ${result.historyInfo.coverage}，检索 ${result.historyInfo.evidenceCount} 条原文。`,'hint'));
  if(result.replies.length) $('replies-empty').hidden=true;
  result.replies.forEach((reply,index)=>{
    const card=node('article',undefined,'reply'),top=node('div',undefined,'reply-top');
    top.append(node('span',`候选 ${String(index+1).padStart(2,'0')}`),node('span',reply.probability===null?'未排序':`Jev 匹配 ${(reply.probability*100).toFixed(0)}%`));
    const actions=node('div',undefined,'reply-actions'),copy=node('button','复制'),fill=node('button','5 秒后填入');
    copy.addEventListener('click',async()=>{try{await api.copy(reply.text);status('已复制候选，请自行粘贴并决定是否发送。');}catch(e){status(e.message,true);}});
    fill.addEventListener('click',async()=>{
      if(filling)return;
      filling=true; document.querySelectorAll('.reply-actions button').forEach(b=>b.disabled=true);
      status('请在 5 秒内点击刚才截图窗口中的空白聊天输入框；程序只填字，不发送。');
      try{await api.fill(reply.text);status('已填入并核对文字。请检查后自行决定是否发送。');}catch(e){status(`${e.message} 可使用「复制」后手动粘贴。`,true);}finally{filling=false;document.querySelectorAll('.reply-actions button').forEach(b=>b.disabled=false);}
    });
    actions.append(copy,fill);card.append(top,node('p',reply.text),actions);$('replies').append(card);
  });
}
$('analyze').addEventListener('click',async()=>{
  if(busy)return; updateBusy(true);resetResults();const current=++generation;status('正在请求模型；可随时取消。');
  try{const result=await api.analyze({text:$('conversation').value,relationship:$('relationship').value,historyId:$('history-select').value});if(current===generation){renderResult(result);status(result.warnings.length?'已完成，部分接口不可用，请查看提示。':'分析完成。选择适合你的表达，发送仍由你决定。');}}
  catch(e){if(current===generation)status(e.message,true);}finally{updateBusy(false);}
});
$('cancel').addEventListener('click',async()=>{await api.cancel();status('正在取消…');});
$('clear').addEventListener('click',async()=>{++generation;await api.clear();screenshot=null;selection=null;$('conversation').value='';$('relationship').value='';$('crop-canvas').getContext('2d').clearRect(0,0,$('crop-canvas').width,$('crop-canvas').height);$('crop-area').hidden=true;$('source-label').textContent='手动输入';resetResults();status('本次对话与截图已从应用会话中清空；已复制的文字仍在系统剪贴板。');});
$('example').addEventListener('click',()=>{$('conversation').value='对方：明天下午一起把方案过一遍？\n我：可以，你几点方便？\n对方：三点吧，记得带上修改稿。';$('relationship').value='对方是同组同学，我们正在准备项目答辩。';resetResults();status('示例已填入；配置模型后点击分析，不会伪造分析结果。');});
for(const id of ['conversation','relationship'])$(id).addEventListener('input',()=>{if(!busy)resetResults();});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.close==='capture-dialog'&&ocrRunning)return;$(b.dataset.close).close();}));
$('capture-dialog').addEventListener('cancel',e=>{if(ocrRunning)e.preventDefault();});
function populateSettings(s) {
  settings=s;$('judge-enabled').checked=s.judgeEnabled;$('always-top').checked=s.alwaysOnTop;
  for(const route of ['judge','reply']){for(const field of ['url','model'])$(`${route}-${field}`).value=s[route+field[0].toUpperCase()+field.slice(1)];$(`${route}-key`).value='';$(`${route}-key`).placeholder=s[`has${route[0].toUpperCase()+route.slice(1)}Key`]?'已保存 · 留空保留':'输入密钥（本机模型可留空）';$(`clear-${route}-key`).checked=false;}
  $('judge-label').textContent=s.judgeEnabled?'JEV 判断':'仅生成候选';
}
$('settings-open').addEventListener('click',async()=>{try{populateSettings(await api.getSettings());$('settings-status').textContent='';$('settings-dialog').showModal();}catch(e){status(e.message,true);}});
$('settings-form').addEventListener('submit',async e=>{
  e.preventDefault();const input={judgeEnabled:$('judge-enabled').checked,alwaysOnTop:$('always-top').checked};
  for(const route of ['judge','reply']){for(const field of ['url','model','key'])input[route+field[0].toUpperCase()+field.slice(1)]=$(`${route}-${field}`).value;input[`clear${route[0].toUpperCase()+route.slice(1)}Key`]=$(`clear-${route}-key`).checked;}
  try{populateSettings(await api.saveSettings(input));$('settings-dialog').close();status('设置已保存，密钥已通过 Windows 加密。');}catch(err){$('settings-status').textContent=err.message;}
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
async function refreshHistory(selected){
  sessions=await api.historyList();
  for(const id of ['history-select','history-session']){
    const select=$(id),old=id==='history-session'?(selected??select.value):select.value;
    select.replaceChildren(new Option(id==='history-session'?'新建会话':'仅使用本次对话',''));
    for(const item of sessions)select.add(new Option(`${item.name} · ${item.count} 条`,item.id));
    select.value=sessions.some(s=>s.id===old)?old:'';
  }
}
async function showProfile(id){
  $('history-profile').replaceChildren();$('history-evidence').hidden=true;
  $('profile-coverage').textContent='';
  if(!id)return;
  const profile=await api.historyProfile(id),item=sessions.find(s=>s.id===id);
  if(!profile){$('history-profile').append(node('p','尚未生成档案。请先查看范围，再开始分段分析。','hint'));return;}
  $('profile-coverage').textContent=`已覆盖 ${profile.covered}/${profile.total} 条${profile.revision!==item?.revision?' · 有新导入，需重建':''}`;
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
  $('history-stats').textContent=item?`${item.count} 条消息 · ${item.first.slice(0,10)} 至 ${item.last.slice(0,10)}`:'新建会话：填写名称与本人 QQ 号，再选择文件。';
  $('history-plan-text').textContent='';$('history-summarize').disabled=true;
  await showProfile(id);
}
$('history-open').addEventListener('click',async()=>{try{await refreshHistory();await selectHistory();$('history-dialog').showModal();}catch(e){status(e.message,true);}});
$('history-session').addEventListener('change',()=>selectHistory().catch(e=>historyStatus(e.message)));
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
  for(const id of ['history-session','history-import','history-plan','history-summarize','history-delete'])$(id).disabled=true;
  $('history-cancel').hidden=false;historyStatus('正在生成长期档案…');
  try{await api.historySummarize($('history-session').value);historyStatus('档案生成完成。可在对话工作台选择此会话，辅助下一次回复。');}
  catch(e){historyStatus(e.message);}finally{summarizing=false;for(const id of ['history-session','history-import','history-plan','history-summarize','history-delete'])$(id).disabled=false;$('history-cancel').hidden=true;await showProfile($('history-session').value);}
});
$('history-cancel').addEventListener('click',()=>api.historyCancel());
$('history-delete').addEventListener('click',async()=>{try{if(await api.historyDelete($('history-session').value)){await refreshHistory('');await selectHistory();historyStatus('本机副本与档案已删除，QQ 原始文件未修改。');}}catch(e){historyStatus(e.message);}});
api.onHistoryProgress(p=>historyStatus(`已完成 ${p.batch}/${p.batches} 段，覆盖 ${p.covered}/${p.total} 条；可暂停后续跑。`));
refreshHistory().catch(e=>status(e.message,true));
