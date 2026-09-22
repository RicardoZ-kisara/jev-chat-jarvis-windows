// Opt-in real account test: synthetic conversations only, consumes account quota.
const {_electron: electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(),'jev-account-qa-'));
  const out=path.resolve(__dirname,'../.qa');await fs.mkdir(out,{recursive:true});
  const executablePath=process.env.JEV_TEST_EXECUTABLE;
  const app=await electron.launch({...(executablePath?{executablePath}:{}),args:[...(executablePath?[]:[path.resolve(__dirname,'..')]),'--smoke-test'],env:{...process.env,JEV_TEST_DATA:profile},timeout:60000});
  const errors=[];
  try {
    const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
    await page.locator('#settings-open').click();
    await page.locator('#reply-provider').selectOption('codex');
    assert.equal(await page.locator('#api-settings').isVisible(),false);
    assert.equal(await page.locator('#judge-enabled').isDisabled(),true);
    await page.locator('#codex-model').fill('gpt-6-astra');
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.locator('#settings-dialog').waitFor({state:'hidden'});
    await page.locator('#settings-open').click();
    assert.equal(await page.locator('#reply-provider').inputValue(),'codex');
    await page.screenshot({path:path.join(out,'codex-settings.png')});
    await page.locator('[data-close="settings-dialog"]').click();
    await page.locator('#example').click();await page.locator('#analyze').click();
    await page.waitForFunction(()=>!document.querySelector('#analyze').disabled,{},{timeout:200000});
    assert.equal(await page.locator('.reply').count(),3,await page.locator('#status').innerText());
    assert.ok((await page.locator('#provider-label').innerText()).includes('gpt-6-astra'));
    await page.screenshot({path:path.join(out,'codex-replies.png'),fullPage:true});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve(__dirname,'../examples/qq-history.json'));
    await page.locator('#history-open').click();await page.locator('#history-name').fill('合成测试 · 答辩项目组');await page.locator('#history-self').fill('100001');await page.locator('#history-import').click();
    await page.waitForFunction(()=>document.querySelector('#history-stats').textContent.includes('4 条消息'));
    await page.locator('#history-plan').click();
    assert.ok((await page.locator('#history-plan-text').innerText()).includes('OpenAI 云端'));
    await page.locator('#history-summarize').click();
    await page.waitForFunction(()=>document.querySelector('#history-cancel').hidden,{},{timeout:200000});
    assert.ok((await page.locator('#profile-coverage').innerText()).includes('4/4'),await page.locator('#history-status').innerText());
    assert.ok(await page.locator('.profile-entry button').count());
    await page.locator('.profile-entry button').first().click();
    assert.ok((await page.locator('#history-evidence').innerText()).includes('[M'));
    await page.screenshot({path:path.join(out,'codex-history.png')});
    const id=await page.locator('#history-session').inputValue();
    const stored=await page.evaluate(id=>window.jev.historyProfile(id),id);
    assert.equal(stored.model,'codex:gpt-6-astra');
    assert.ok(stored.body.events.length>0);assert.ok(stored.body.todos.length>0);
    await page.locator('[data-close="history-dialog"]').click();
    await page.locator('#history-select').selectOption(id);
    await page.locator('#analyze').click();
    await page.waitForFunction(()=>!document.querySelector('#analyze').disabled,{},{timeout:200000});
    assert.equal(await page.locator('.reply').count(),3,await page.locator('#status').innerText());
    assert.ok((await page.locator('#replies').innerText()).includes('档案覆盖 4/4'));
    assert.deepEqual(errors,[]);
    const result={date:new Date().toISOString(),model:'gpt-6-astra',provider:'Codex CLI / ChatGPT login',realInference:true,syntheticDataOnly:true,replyCount:3,historyCoverage:'4/4',historyAssistedReply:true,rendererErrors:errors};
    await fs.writeFile(path.join(out,'codex-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally {await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
