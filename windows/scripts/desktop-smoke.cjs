const {_electron: electron} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function main(){
  const output=path.resolve(__dirname,'../.qa');await fs.mkdir(output,{recursive:true});
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'jev-qa-'));
  const received=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);received.push(body);
    const isSummary=body.messages?.[0]?.content.includes('QQ 长期聊天整理助手');
    const ref=isSummary?JSON.parse(body.messages[1].content).messages[0].match(/^\[(M\d+)\]/)[1]:null;
    const response=isSummary?{choices:[{message:{content:JSON.stringify({relationships:[{text:'共同准备答辩，分工合作。',refs:[ref]}],events:[],todos:[{text:'核对系统结构图。',refs:[ref],status:'open'}]})}}]}:body.questions?.best_reply?{answers:{best_reply:{probabilities:{reply_a:.7,reply_b:.2,reply_c:.1}}}}:body.questions?{answers:{true_intent:{choice:'request_action'},danger_level:{score:2},she_needs:{choice:'action'},best_action:{choice:'make_plan'},should_reply_now:{noul:.85}}}:{choices:[{message:{content:JSON.stringify(['好，明天下午三点见，我带上修改稿。','收到，我先把修改稿整理好。','三点可以，我们到时一起过一遍。'])}}]};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(response));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  let app;
  const checks=[];const errors=[];
  try{
    const executablePath=process.env.JEV_TEST_EXECUTABLE;
    app=await electron.launch({...(executablePath?{executablePath}:{}),args:[...(executablePath?[]:[path.resolve(__dirname,'..')]),'--smoke-test','--force-renderer-accessibility'],env:{...process.env,JEV_TEST_DATA:data},timeout:60000});
    const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
    await page.getByRole('heading',{name:'准备对话'}).waitFor();
    await page.screenshot({path:path.join(output,'startup.png')});checks.push('Native Electron window starts with isolated renderer');
    assert.equal(await page.evaluate(()=>typeof require),'undefined');
    await page.locator('#settings-open').click();
    await page.locator('#judge-url').fill(`http://127.0.0.1:${port}/judge`);
    await page.locator('#reply-url').fill(`http://127.0.0.1:${port}/reply`);
    await page.locator('#judge-key').fill('TEST-ONLY-JUDGE');await page.locator('#reply-key').fill('TEST-ONLY-REPLY');
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.locator('#settings-dialog').waitFor({state:'hidden'});
    const saved=await fs.readFile(path.join(data,'settings.json'),'utf8');assert.ok(!saved.includes('TEST-ONLY'));checks.push('Settings saved with Windows encrypted keys');
    await page.locator('#example').click();await page.locator('#analyze').click();
    await page.locator('.reply').first().waitFor({timeout:60000});assert.equal(await page.locator('.reply').count(),3);assert.equal(received.length,3);
    await page.locator('.reply-actions button').first().click();
    const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.match(copied,/明天下午三点/);checks.push('Mock HTTP judgment, candidate generation, ranking, copy all pass');
    await page.screenshot({path:path.join(output,'analysis.png'),fullPage:true,scale:'css'});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve(__dirname,'../examples/qq-history.json'));
    await page.locator('#history-open').click();await page.locator('#history-name').fill('QA 合成项目组');await page.locator('#history-self').fill('100001');await page.locator('#history-import').click();
    await page.waitForFunction(()=>document.querySelector('#history-stats').textContent.includes('4 条消息'));
    await page.locator('#history-plan').click();await page.locator('#history-summarize').click();
    await page.waitForFunction(()=>document.querySelector('#profile-coverage').textContent.includes('4/4'));
    await page.locator('.profile-entry button').first().click();assert.ok((await page.locator('#history-evidence').innerText()).includes('这次答辩'));
    await page.screenshot({path:path.join(output,'history.png'),scale:'css'});
    await page.locator('[data-close="history-dialog"]').click();
    const historyId=await page.locator('#history-select option').nth(1).getAttribute('value');await page.locator('#history-select').selectOption(historyId);
    await page.locator('#analyze').click();await page.locator('.reply').first().waitFor();
    assert.ok(received.some(body=>body.messages?.[1]?.content.includes('profileCoverage')));checks.push('QQ history import, summary, evidence links and history-assisted replies pass with synthetic data');
    // Capture only a synthetic fixture. Real user conversation is never submitted or saved by QA.
    const fixturePromise=app.waitForEvent('window');
    await app.evaluate(async({BrowserWindow,app})=>{
      app.setAccessibilitySupportEnabled(true);
      const fixture=new BrowserWindow({width:820,height:620,title:'Jev QA Synthetic QQ',webPreferences:{contextIsolation:true,nodeIntegration:false}});
      await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><head><title>Jev QA Synthetic QQ</title></head><body style="font:28px Segoe UI,Microsoft YaHei;background:white;padding:35px"><h2>LOCAL OCR TEST</h2><p>对方：明天下午三点见。</p><p>我：好的，带上修改稿。</p><label for="chat">Message</label><textarea id="chat" style="display:block;width:90%;height:80px;font-size:24px"></textarea></body></html>'));
    });
    const fixture=await fixturePromise;await fixture.waitForLoadState();
    await page.bringToFront();await page.locator('#capture-open').click();
    await page.getByTitle('Jev QA Synthetic QQ',{exact:true}).click({timeout:30000});
    await page.locator('#crop-canvas').waitFor();await page.locator('#ocr').click();
    await page.locator('#capture-dialog').waitFor({state:'hidden',timeout:120000});
    const recognized=await page.locator('#conversation').inputValue();assert.ok(/LOCAL|OCR/.test(recognized),'Synthetic marker must be present; OCR content is intentionally not logged.');checks.push('Selected native window capture and bundled Chinese/English OCR succeed');
    // Restore labeled text, then use the product's normal explicit fill action.
    await page.locator('#example').click();await page.locator('#analyze').click();await page.locator('.reply').first().waitFor();
    await page.locator('.reply-actions button').nth(1).click();
    await app.evaluate(({BrowserWindow})=>{const target=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Jev QA Synthetic QQ');target.focus();target.webContents.focus();});
    await fixture.locator('#chat').click();
    await page.waitForFunction(()=>!document.querySelector('.reply-actions button').disabled,{},{timeout:25000});
    const fillStatus=await page.locator('#status').innerText();const filled=await fixture.locator('#chat').inputValue();
    if(filled===copied){assert.ok(fillStatus.startsWith('已填入'),'Successful fill must be verified by the native provider');checks.push('Windows UI Automation fills focused synthetic input without sending');}
    else{assert.ok(!fillStatus.startsWith('已填入'),'Failed fill must not be reported as success');assert.match(fillStatus,/复制|填入|focus|input/i);checks.push('Unsupported, nonempty or unfocused input fails closed and offers manual copy');}
    await page.bringToFront();await page.locator('#clear').click();assert.equal(await page.locator('#conversation').inputValue(),'');assert.equal(await page.locator('.reply').count(),0);checks.push('Clear removes screenshot, conversation and rendered results');
    assert.deepEqual(errors,[]);checks.push('No renderer JavaScript errors');
    await fs.writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify({timestamp:new Date().toISOString(),checks,ocrMarkerVerified:true,fillStatus,fillSucceeded:filled===copied,rendererErrors:errors,realProviderTested:false},null,2));
    console.log(JSON.stringify({checks,fillStatus,output},null,2));
  }finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
