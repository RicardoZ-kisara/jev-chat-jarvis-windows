const {test}=require('node:test');
const assert=require('node:assert/strict');
const fixture=require('./helpers/decision.cjs');
const {parseDecision,resolveReferences,decisionPrompt}=require('../src/decision.cjs');
const {validateMessages}=require('../src/core.cjs');
const {HistoryStore,normalizeHistory}=require('../src/history.cjs');
test('model decisions have seven validated answers, alternatives and evidence; source is never labeled Jev model',()=>{
 const data=fixture(['M1']);const result=parseDecision(JSON.stringify(data),new Set(['M1']));
 assert.equal(Object.keys(result.answers).length,7);assert.ok(Math.abs(result.replies[0].probability-.6)<1e-10);assert.equal(result.rankingSource,'ChatGPT 偏好');
 assert.match(result.judgmentSource,/ChatGPT/);assert.deepEqual(result.analysis.refs,['M1']);
 const values=result.answers.true_intent.probabilities;assert.ok(Math.abs(Object.values(values).reduce((a,b)=>a+b,0)-1)<.0001);
});
test('invalid probability and identical replies still fail without fake fallback',()=>{
 for(const mutate of [d=>d.answers.true_intent.probabilities.confirm_you_care=2,d=>d.replies[0].probability=.1,d=>d.answers.danger_level.score=11,d=>d.replies[1].text=d.replies[0].text]){
  const data=fixture(['M1']);mutate(data);assert.throws(()=>parseDecision(JSON.stringify(data),new Set(['M1'])));
 }
});
test('more than eight valid references no longer masquerade as out-of-scope references',()=>{
 const refs=Array.from({length:40},(_,i)=>`M${149003+i*17}`);
 const result=parseDecision(JSON.stringify(fixture(refs)),new Set(refs));
 assert.equal(result.replies.length,3);assert.deepEqual(result.analysis.refs,refs.slice(0,8));assert.equal(result.analysis.evidenceStatus,'available');
 assert.equal(result.referenceValidation.dropped,0);assert.equal(result.referenceValidation.truncated,96);assert.deepEqual(result.warnings,[]);
});
test('format normalization keeps exact database IDs without guessing missing or cross-session IDs',()=>{
 const allowed=new Set(['M149003','M149020']);
 const value=resolveReferences([' [M149003] ','m149020',149003,'M1','M999','M149003-M149020',Number.MAX_SAFE_INTEGER+1,{id:'M149003'}],allowed);
 assert.deepEqual(value.refs,['M149003','M149020']);assert.equal(value.dropped,5);assert.equal(value.normalized,3);assert.equal(value.status,'partial');
 assert.deepEqual(resolveReferences('【Ｍ１４９００３】',allowed).refs,['M149003']);
});
test('unsupported citations are excluded and marked, while genuine model replies remain usable',()=>{
 const data=fixture(['M999']);data.replies[1].refs=['[M149003]','M999'];
 const result=parseDecision(JSON.stringify(data),new Set(['M149003']));
 assert.equal(result.replies.length,3);assert.equal(result.replies[0].text,data.replies[0].text);
 assert.deepEqual(result.analysis.refs,[]);assert.equal(result.analysis.evidenceStatus,'unverified');
 assert.equal(result.replies[0].evidenceStatus,'unverified');assert.equal(result.replies[1].evidenceStatus,'partial');assert.deepEqual(result.replies[1].refs,['M149003']);
 assert.ok(result.warnings.some(w=>w.includes('已排除')));assert.equal(result.referenceValidation.missing,1);
 data.analysis.refs=[];assert.equal(parseDecision(JSON.stringify(data),new Set(['M149003'])).analysis.evidenceStatus,'unverified');
});
test('model sees one explicit allowed selection set and structured background, not inferred numbers in chat text',()=>{
 const state={chat:{messages:[{ref:'M149003',text:'这是一段数据 M999，不是可用引用'}]},background:JSON.stringify({referenceIds:['M149020'],evidence:['[M149020] 合成记录']})};
 const payload=JSON.parse(decisionPrompt(state,new Set(['M149003','M149020']))[1].content);
 assert.deepEqual(payload.allowedReferenceIds,['M149003','M149020']);assert.equal(typeof payload.state.background,'object');assert.match(payload.referenceRules,/不能从 M1 重新编号/);
});
test('imported current context preserves forty messages, multiline bodies and group sender names',t=>{
 const store=new HistoryStore(':memory:');t.after(()=>store.close());
 const rows=Array.from({length:60},(_,i)=>({id:`message-${i}`,sender:i%2?'100001':'100002',senderName:i%2?'本人':'组员甲',time:new Date(Date.UTC(2026,8,22,0,i)).toISOString(),text:`消息 ${i}\n第二行：保持原文`}));
 const id=store.import(normalizeHistory(JSON.stringify(rows),{name:'合成项目组',selfId:'100001'})).id;
 const recent=store.recent(id),messages=validateMessages(recent.messages);
 assert.equal(messages.length,40);assert.match(messages[0].text,/消息 20/);assert.match(messages.at(-1).text,/消息 59/);assert.equal(messages[0].sender,'组员甲');assert.equal(messages.at(-1).from,'me');assert.match(messages[0].text,/\n第二行/);
 assert.equal(recent.analysis,null);assert.throws(()=>validateMessages([...messages,messages[0]]));
});
test('conversation analysis survives reload, stays isolated, and expires after source updates',t=>{
 const store=new HistoryStore(':memory:');t.after(()=>store.close());
 const data=normalizeHistory(JSON.stringify([{id:'one',sender:'100002',time:'2026-09-22T00:00:00Z',text:'请核对修改稿'}]),{name:'甲',selfId:'100001'});
 const a=store.import(data).id,b=store.import({...data,name:'乙'}).id;
 const recent=store.recent(a),result={...parseDecision(JSON.stringify(fixture([recent.messages[0].ref])),new Set([recent.messages[0].ref])),generatedAt:new Date().toISOString()};
 store.saveAnalysis(a,recent.revision,result);assert.deepEqual(store.recent(a).analysis,result);assert.equal(store.recent(b).analysis,null);
 const context=store.context(a,'修改稿');assert.ok(context.referenceIds.includes(recent.messages[0].ref));assert.ok(!context.referenceIds.includes(store.recent(b).messages[0].ref));
 store.import({...data,messages:data.messages.map(m=>({...m,text:'修改安排变了'}))},a,{updateExisting:true});
 assert.equal(store.recent(a).analysis,null);assert.equal(store.recent(a).analysisStale,true);assert.throws(()=>store.saveAnalysis(a,recent.revision,result),/变化/);
 store.remove(a);assert.equal(store.db.prepare('SELECT count(*) AS n FROM conversation_analyses').get().n,0);
});
test('very long messages expose truncation and stay within bounded context',t=>{
 const store=new HistoryStore(':memory:');t.after(()=>store.close());
 const data=normalizeHistory(JSON.stringify([{sender:'100002',time:'2026-09-22T00:00:00Z',text:'长'.repeat(15000)}]),{name:'合成',selfId:'100001'});
 const id=store.import(data).id,recent=store.recent(id);
 assert.equal(recent.messages[0].truncated,true);assert.ok(recent.characters<=12000);assert.doesNotThrow(()=>validateMessages(recent.messages));
 assert.equal(store.evidence(id,[recent.messages[0].ref])[0].text.length,15000);
});
