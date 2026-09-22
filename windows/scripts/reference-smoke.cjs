// Isolated synthetic regression for invalid references; never uses real QQ data.
// JEV_REFERENCE_REAL=1 additionally makes one real ChatGPT call with synthetic data.
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const fixture=require('../test/helpers/decision.cjs');
async function main(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'jev-reference-qa-'));
 const executablePath=process.env.JEV_TEST_EXECUTABLE;
 const app=await electron.launch({...(executablePath?{executablePath}:{}),args:[...(executablePath?[]:[path.resolve(__dirname,'..')]),'--smoke-test'],env:{...process.env,JEV_TEST_DATA:profile},timeout:60000});
 const errors=[];
 try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({app})=>{
   const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
   const {HistoryStore,normalizeHistory}=req('./src/history.cjs');
   const store=new HistoryStore(req('node:path').join(app.getPath('userData'),'qq-history.sqlite'));
   const lines=['我们这周整理答辩演示稿。','我先检查结构图的标注。','实验数据我会再核对，先别填没有验证的数字。','收到，结构图里我把数据流补上。','演示时间还没有最终确定，先不要写死。','好的，等老师通知再确认时间。','刚才发的初稿我收到了，还缺一张系统结构图。','我记下了，先核对需要补哪些模块。'];
   const rows=Array.from({length:48},(_,i)=>({id:`synthetic-${i}`,sender:i%2?'100001':'100002',senderName:i%2?'本人':'合成同学',time:new Date(Date.UTC(2026,8,22,4,i)).toISOString(),text:lines[i%lines.length]}));
   const data=normalizeHistory(JSON.stringify(rows),{name:'合成测试 · 引用回归',selfId:'100001'});store.import(data);
   store.db.exec('UPDATE messages SET id=149000+id*17');store.close();
   const codex=req('./src/codex.cjs');globalThis.__jevOriginalGenerate=codex.generate;globalThis.__jevMockCodex=codex;
  });
  await page.evaluate(()=>window.jev.saveSettings({replyProvider:'codex',codexModel:'gpt-6-astra',judgeEnabled:false}));
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.chat-message').length===40);
  const id=await page.locator('#conversation-session').inputValue();
  const refs=await page.evaluate(async id=>(await window.jev.historyRecent(id)).messages.map(m=>m.ref),id);
  const bad=fixture(refs);bad.analysis.refs=[...refs,'M1'];bad.replies[0].refs=['[M999]'];bad.replies[1].refs=[` [${refs[0]}] `];
  await app.evaluate((_electron,data)=>{globalThis.__jevMockCodex.generate=async()=>JSON.stringify(data);},bad);
  await page.locator('#analyze').click();await page.waitForFunction(()=>!document.querySelector('#analyze').disabled);
  assert.equal(await page.locator('.reply').count(),3,await page.locator('#status').innerText());
  const recovered=(await page.evaluate(id=>window.jev.historyRecent(id),id)).analysis;
  assert.equal(recovered.referenceValidation.dropped,2);assert.equal(recovered.referenceValidation.truncated,32);assert.equal(recovered.referenceValidation.normalized,1);
  assert.equal(recovered.analysis.evidenceStatus,'partial');assert.equal(recovered.replies[0].evidenceStatus,'unverified');
  assert.ok(recovered.evidence.every(e=>refs.includes(`M${e.id}`)));assert.ok(recovered.evidence.length>0);
  assert.ok((await page.locator('#replies').innerText()).includes('依据待核对'));
  await page.locator('.reply-actions button').first().click();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),recovered.replies[0].text);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.reply').length===3);
  const out=path.resolve(__dirname,'../.qa');await fs.mkdir(out,{recursive:true});
  await page.screenshot({path:path.join(out,'references-recovered.png'),fullPage:true});
  const report={syntheticDataOnly:true,nonContiguousMessageIds:true,recentMessages:40,invalidReferencesExcluded:true,rankedReplies:3,warningVisible:true,copyVerified:true,reloadRestored:true,realInference:false,rendererErrors:errors};
  if(process.env.JEV_REFERENCE_REAL==='1'){
   await app.evaluate(()=>{globalThis.__jevMockCodex.generate=globalThis.__jevOriginalGenerate;});
   await page.locator('#analyze').click();await page.waitForFunction(()=>!document.querySelector('#analyze').disabled,{},{timeout:200000});
   assert.equal(await page.locator('.reply').count(),3,await page.locator('#status').innerText());
   const actual=(await page.evaluate(id=>window.jev.historyRecent(id),id)).analysis;
   assert.notEqual(actual.generatedAt,recovered.generatedAt);assert.equal(Object.keys(actual.answers).length,7);
   assert.ok(actual.evidence.every(e=>refs.includes(`M${e.id}`)));
   report.realInference=true;report.realReferenceValidation=actual.referenceValidation;report.realValidEvidenceCount=actual.evidence.length;
   await page.screenshot({path:path.join(out,'references-real.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'reference-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
