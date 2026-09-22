// Explicit local-account integration check. Never requests model inference.
// Uses the normal user profile only when JEV_NTQQ_CONFIGURE=1 is supplied.
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
async function main(){
 const root=process.env.JEV_NTQQ_ROOT,account=process.env.JEV_NTQQ_ACCOUNT;
 if(!root||!account)throw new Error('Set JEV_NTQQ_ROOT and JEV_NTQQ_ACCOUNT for an explicitly authorized local run.');
 const normal=process.env.JEV_NTQQ_CONFIGURE==='1';
 const profile=normal?null:await fs.mkdtemp(path.join(os.tmpdir(),'jev-ntqq-qa-'));
 const executablePath=process.env.JEV_TEST_EXECUTABLE;
 const app=await electron.launch({executablePath,args:normal?[]:['--smoke-test'],env:{...process.env,...(profile?{JEV_TEST_DATA:profile}:{})},timeout:60000});
 const errors=[];const started=Date.now();
 try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#ntqq-open').click();await page.locator('#ntqq-root').fill(root);await page.locator('#ntqq-discover').click();
  await page.waitForFunction(()=>!document.querySelector('#ntqq-discover').disabled);
  await page.locator('#ntqq-account').selectOption(account);await page.locator('#ntqq-read').click();
  await page.waitForFunction(()=>!document.querySelector('#ntqq-read').disabled,{},{timeout:310000});
  const conversationCount=await page.locator('.ntqq-row').count();
  assert.ok(conversationCount>0,await page.locator('#ntqq-status').innerText());
  await page.locator('#ntqq-all').check();await page.locator('#ntqq-import').click();
  await page.waitForFunction(()=>!document.querySelector('#ntqq-import').disabled,{},{timeout:310000});
  const status=await page.locator('#ntqq-status').innerText();assert.ok(status.includes('已加入'),status);
  const sessions=await page.evaluate(()=>window.jev.historyList());
  assert.ok(sessions.length>=conversationCount);assert.deepEqual(errors,[]);
  // Verify incremental reimport is idempotent without exposing messages or names.
  await page.locator('#ntqq-import').click();
  await page.waitForFunction(()=>!document.querySelector('#ntqq-import').disabled,{},{timeout:310000});
  const second=await page.locator('#ntqq-status').innerText();assert.ok(second.includes('新增 0 条'),second);
  await page.locator('[data-close="ntqq-dialog"]').click();
  if(normal){await page.evaluate(()=>window.jev.saveSettings({replyProvider:'codex',codexModel:'gpt-6-astra',judgeEnabled:false}));await page.reload();await page.waitForFunction(()=>document.querySelector('#provider-label').textContent.includes('gpt-6-astra'));}
  const result={date:new Date().toISOString(),configured:normal,conversationCount,storedMessages:sessions.reduce((n,s)=>n+s.count,0),firstImport:status,repeatImport:second,seconds:(Date.now()-started)/1000,modelRequests:0,rendererErrors:errors};
  await fs.mkdir(path.resolve(__dirname,'../.qa'),{recursive:true});
  await fs.writeFile(path.resolve(__dirname,'../.qa/ntqq-desktop.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
