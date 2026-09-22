const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DEFAULTS, endpoint, parseConversation, parseReplies, analyze, post} = require('../src/core.cjs');
const text = '我：刚才在开会。\n对方：今天能把修改稿给我吗？';
function mock({judgeFail=false, rankFail=false, replyFail=false, malformed=false}={}) {
  const calls=[];
  const fetcher=async(url, options)=>{
    const body=JSON.parse(options.body);calls.push({url,body,headers:options.headers});
    if(body.questions?.best_reply) return {ok:!rankFail,status:429,json:async()=>({answers:{best_reply:{probabilities:{reply_a:.2,reply_b:.7,reply_c:.1}}}})};
    if(body.questions) return {ok:!judgeFail,status:401,json:async()=>({answers:{true_intent:{choice:'request_action'},danger_level:{score:3}}})};
    return {ok:!replyFail,status:503,json:async()=>({choices:[{message:{content:malformed?'not json':'["我先核对一下修改要求。","可以，我整理后给你。","收到，我看看进度。"]'}}]})};
  };return {fetcher,calls};
}
test('conversation requires explicit speakers; preserves colons and last ten messages',()=>{
  assert.throws(()=>parseConversation('无法判断是谁说的'),/标为/);
  assert.deepEqual(parseConversation('我：时间：三点\n对方：好的')[0],{from:'me',text:'时间：三点'});
  assert.equal(parseConversation(Array.from({length:12},(_,i)=>`我：${i}`).join('\n')).length,10);
  assert.throws(()=>parseConversation('我：'+'a'.repeat(16000)),/过长/);
});
test('reply parser rejects malformed, missing, invented filler and non-string candidates',()=>{
  assert.deepEqual(parseReplies('```json\n["a","b","c"]\n```'),['a','b','c']);
  for(const value of ['hello','["a"]','["a",null,"c"]','["a"," ","c"]']) assert.throws(()=>parseReplies(value));
});
test('only HTTPS and loopback HTTP; disallow URL-embedded secrets',()=>{
  assert.equal(endpoint('http://127.0.0.1:11434/v1/chat/completions'),'http://127.0.0.1:11434/v1/chat/completions');
  for(const url of ['http://example.com','https://user:pass@example.com','file:///etc/passwd','https://example.com?key=123'])assert.throws(()=>endpoint(url));
});
test('original seven questions, separate credentials and ranking are sent correctly',async()=>{
  const m=mock();const result=await analyze({text,relationship:'同学'},{...DEFAULTS,judgeKey:'judge-test',replyKey:'reply-test'},null,m.fetcher);
  assert.equal(Object.keys(m.calls.find(c=>c.body.questions?.true_intent).body.questions).length,7);
  assert.equal(m.calls.find(c=>c.body.messages).headers.Authorization,'Bearer reply-test');
  assert.equal(m.calls.find(c=>c.body.questions).headers.Authorization,'Bearer judge-test');
  assert.equal(result.replies[0].probability,.7);assert.equal(result.replies[0].text,'可以，我整理后给你。');
});
test('judge failure retains real candidates with explicit warning',async()=>{
  const result=await analyze({text},DEFAULTS,null,mock({judgeFail:true}).fetcher);
  assert.equal(result.answers,null);assert.equal(result.replies.length,3);assert.match(result.warnings[0],/401/);
});
test('ranking failure never creates fake probabilities',async()=>{
  const result=await analyze({text},DEFAULTS,null,mock({rankFail:true}).fetcher);
  assert.equal(result.replies[0].probability,null);assert.match(result.warnings[0],/未排序/);
});
test('draft failure still shows available judgment',async()=>{
  const result=await analyze({text},DEFAULTS,null,mock({replyFail:true}).fetcher);
  assert.ok(result.answers);assert.deepEqual(result.replies,[]);assert.match(result.warnings[0],/候选生成失败/);
});
test('disabled judge makes only one request; reply key never falls back to judge key',async()=>{
  const m=mock();const result=await analyze({text},{...DEFAULTS,judgeEnabled:false,judgeKey:'private'},null,m.fetcher);
  assert.equal(m.calls.length,1);assert.equal(m.calls[0].headers.Authorization,undefined);assert.equal(result.replies[0].probability,null);
});
test('HTTP errors do not expose response bodies or keys; redirects are disallowed',async()=>{
  let redirect;
  await assert.rejects(post('https://example.com','SECRET',{},null,async(_url,opts)=>{redirect=opts.redirect;return {ok:false,status:500,text:async()=>'SECRET CHAT'}}),error=>!error.message.includes('SECRET'));
  assert.equal(redirect,'error');
});
test('cancellation discards even late successful replies',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(analyze({text},DEFAULTS,controller.signal,mock().fetcher),/取消/);
});
