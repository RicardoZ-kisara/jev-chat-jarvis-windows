const {test}=require('node:test');
const assert=require('node:assert/strict');
const {HistoryStore,normalizeHistory,chunks,validateProfile,summarizeHistory}=require('../src/history.cjs');
const {DEFAULTS}=require('../src/core.cjs');
function fixture(n=5){return JSON.stringify({meta:{platform:'qq',ownerId:'100001'},messages:Array.from({length:n},(_,i)=>({platformMessageId:`m${i}`,sender:i%2?'100001':'100002',timestamp:1700000000+i,content:`答辩项目修改稿第 ${i} 条，明天交付。`}))});}
test('QQ import maps sender/time; rejects non-QQ data and invalid dates',()=>{
  const data=normalizeHistory(fixture(),{name:'同学'});assert.equal(data.messages[1].side,'me');assert.equal(data.messages.length,5);
  assert.throws(()=>normalizeHistory('{"meta":{"platform":"wechat"},"messages":[]}',{name:'x'}),/仅支持 QQ/);
  assert.throws(()=>normalizeHistory('[{"sender":"1","content":"x"}]',{name:'x'}),/时间戳/);
});
test('QQ TXT parser handles multiline messages and explicit sender account',()=>{
  const data=normalizeHistory('2026-09-01 12:00:00 同学(100002)\n你好\n补充一句\n2026-09-01 12:01:00 我(100001)\n收到',{name:'同学',selfId:'100001',format:'txt'});
  assert.equal(data.messages.length,2);assert.equal(data.messages[0].text,'你好\n补充一句');assert.equal(data.messages[1].side,'me');
});
test('SQLite separates sessions, deduplicates overlap, and preserves same-length different messages',()=>{
  const store=new HistoryStore(':memory:');try{
    const data=normalizeHistory(fixture(),{name:'同学'});const a=store.import(data);assert.equal(a.added,5);
    assert.equal(store.import(data,a.id).duplicates,5);
    const b=store.import({...data,name:'另一会话'});assert.equal(store.list().length,2);assert.equal(store.evidence(a.id,[`M${store.rows(b.id)[0].id}`]).length,0);
    assert.equal(store.context(a.id,'修改稿').total,5);store.remove(a.id);assert.equal(store.rows(a.id).length,0);
  }finally{store.close();}
});
test('summary refuses fabricated or cross-session evidence identifiers',()=>{
  assert.throws(()=>validateProfile(JSON.stringify({relationships:[],events:[{text:'没有来源的事实',refs:['M999']}],todos:[]}),new Set(['M1'])),/引用/);
  assert.deepEqual(validateProfile(JSON.stringify({relationships:[],events:[],todos:[{text:'待办',refs:['M1'],status:'bad'}]}),new Set(['M1'])).todos[0].status,'unknown');
});
test('long histories split into bounded chronological batches, not last-ten truncation',()=>{
  const rows=Array.from({length:350},(_,i)=>({id:i+1,time:'2026-09-22',sender:'同学',text:'修改稿'.repeat(40)}));
  const groups=chunks(rows);assert.ok(groups.length>3);assert.equal(groups.flat().length,350);assert.equal(groups.at(-1).at(-1).id,350);
});
test('summary checkpoints resume without resending completed batches; new import invalidates old profile',async()=>{
  const store=new HistoryStore(':memory:');try{
    const id=store.import(normalizeHistory(fixture(205),{name:'同学'})).id;
    let calls=0;const abort=new AbortController();
    const fetcher=async(_url,opts)=>{calls++;const input=JSON.parse(JSON.parse(opts.body).messages[1].content);const ref=input.messages[0].match(/^\[(M\d+)\]/)[1];return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({relationships:[],events:[{text:'讨论修改稿',refs:[ref]}],todos:[]})}}]})};};
    await assert.rejects(summarizeHistory(store,id,DEFAULTS,abort.signal,()=>abort.abort(),fetcher),/暂停/);
    const covered=store.profile(id).covered;assert.ok(covered>0&&covered<205);const firstCalls=calls;
    await summarizeHistory(store,id,DEFAULTS,new AbortController().signal,()=>{},fetcher);
    assert.equal(store.profile(id).covered,205);assert.equal(calls,chunks(store.rows(id)).length);assert.ok(calls>firstCalls);
    const newer=normalizeHistory(JSON.stringify([{id:'later',sender:'100001',timestamp:1800000000,content:'修改稿已完成'}]),{name:'同学',selfId:'100001'});
    store.import(newer,id);assert.equal(store.context(id,'修改稿').profile,null);
  }finally{store.close();}
});
test('partial summaries and matching source snippets are explicitly marked in reply context',()=>{
  const store=new HistoryStore(':memory:');try{const id=store.import(normalizeHistory(fixture(),{name:'同学'})).id;const session=store.list()[0];store.saveProfile(id,session.revision,2,2,5,'mock',{relationships:[],events:[],todos:[]});const ctx=store.context(id,'修改稿');assert.equal(ctx.profileCoverage,'2/5');assert.ok(ctx.evidence[0].includes('[M'));}finally{store.close();}
});
