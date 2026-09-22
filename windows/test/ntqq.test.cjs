const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {decodeBody,wire,inspectSnapshot,readConversation}=require('../src/ntqq.cjs');
const {HistoryStore,summarizeHistory}=require('../src/history.cjs');const {DEFAULTS}=require('../src/core.cjs');
function varint(n){n=BigInt(n);const out=[];do{let byte=Number(n&127n);n>>=7n;out.push(byte|(n?128:0));}while(n);return Buffer.from(out);}
function field(number,value){const bytes=typeof value==='string'?Buffer.from(value):value;return Buffer.isBuffer(bytes)?Buffer.concat([varint(number*8+2),varint(bytes.length),bytes]):Buffer.concat([varint(number*8),varint(value)]);}
const element=(kind,text)=>field(40800,Buffer.concat([field(45002,kind),...(text?[field(45101,text)]:[])]));
test('protobuf restores repeated text in order and marks unsupported media explicitly',()=>{
 assert.equal(decodeBody(Buffer.concat([element(1,'你好，'),element(1,'明天见')])).text,'你好，明天见');
 const mixed=decodeBody(Buffer.concat([element(1,'这张图'),element(2)]));assert.equal(mixed.text,'这张图[图片]');assert.equal(mixed.unsupported,true);
 assert.equal(decodeBody(Buffer.from([0xff])).malformed,true);assert.throws(()=>wire(Buffer.from([0])));
});
test('snapshot parsing preserves 64-bit message IDs, separates groups and direction; reimport updates without duplicates',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-ntqq-test-'));const file=path.join(dir,'messages.sqlite');
 t.after(()=>{fs.unlinkSync(file);fs.rmdirSync(dir);});
 const db=new DatabaseSync(file);
 for(const table of ['c2c_msg_table','group_msg_table'])db.exec(`CREATE TABLE ${table}("40001" INTEGER PRIMARY KEY,"40030" INTEGER,"40033" INTEGER,"40050" INTEGER,"40013" INTEGER,"40093" TEXT,"40800" BLOB)`);
 db.prepare('INSERT INTO c2c_msg_table VALUES(?,?,?,?,?,?,?)').run(9007199254740993n,100002,100001,1790000000,1,'本人',element(1,'明天检查方案'));
 db.prepare('INSERT INTO group_msg_table VALUES(?,?,?,?,?,?,?)').run(9007199254740994n,100002,100003,1790000001,0,'同学',element(1,'一起检查'));
 db.close();const sessions=inspectSnapshot(file);assert.equal(sessions.length,2);assert.notEqual(sessions[0].key,sessions[1].key);
 const store=new HistoryStore(':memory:');t.after(()=>store.close());
 const session=sessions.find(s=>s.table==='c2c_msg_table');const data=[...readConversation(file,session,'100001')][0];
 assert.equal(data.messages[0].side,'me');assert.equal(data.messages[0].sender,'100001');
 const id=store.sourceSession('100001',session.key,session.name);
 assert.equal(store.sourceSession('100001',session.key,session.name),id);
 assert.equal(store.import({name:session.name,selfId:'100001',...data},id,{updateExisting:true}).added,1);
 assert.equal(store.import({name:session.name,selfId:'100001',...data},id,{updateExisting:true}).duplicates,1);
 data.messages[0].text='计划已更新';assert.equal(store.import({name:session.name,selfId:'100001',...data},id,{updateExisting:true}).updated,1);
 assert.equal(store.rows(id).length,1);assert.equal(store.rows(id)[0].text,'计划已更新');
});
test('old segment memories survive rolling compression; unchanged prefixes reuse cache and edited memories become inactive',async t=>{
 const store=new HistoryStore(':memory:');t.after(()=>store.close());
 const rows=Array.from({length:200},(_,i)=>({uid:String(i),time:new Date(1700000000000+i*1000).toISOString(),sender:'100002',senderName:'同学',side:'other',text:i<100?'远古灯塔项目':'近期火星项目'}));
 const id=store.import({name:'合成长期会话',selfId:'100001',messages:rows,skipped:0}).id;
 let calls=0;const fetcher=async(_,options)=>{calls++;const data=JSON.parse(JSON.parse(options.body).messages[1].content),ref=data.messages[0].match(/\[(M\d+)\]/)[1];return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({relationships:[],events:[{text:data.messages[0].includes('远古')?'远古灯塔项目':'近期火星项目',refs:[ref]}],todos:[]})}}]})};};
 const settings={...DEFAULTS,judgeEnabled:false};await summarizeHistory(store,id,settings,null,()=>{},fetcher);assert.equal(calls,2);assert.equal(store.memoryCount(id),2);
 assert.ok(!store.profile(id).body.events[0].text.includes('远古'));assert.ok(JSON.stringify(store.context(id,'远古灯塔').memories).includes('远古灯塔'));
 store.import({name:'合成长期会话',selfId:'100001',messages:[{...rows.at(-1),uid:'new',time:new Date(1700000300000).toISOString()}],skipped:0},id);
 assert.deepEqual(store.context(id,'远古灯塔').memories,[]);
 await summarizeHistory(store,id,settings,null,()=>{},fetcher);assert.equal(calls,3,'two unchanged chunks were reused');assert.equal(store.memoryCount(id),3);
 store.import({name:'合成长期会话',selfId:'100001',messages:[{...rows[0],text:'修订后的事件'}],skipped:0},id,{updateExisting:true});assert.deepEqual(store.context(id,'远古灯塔').memories,[]);
});
