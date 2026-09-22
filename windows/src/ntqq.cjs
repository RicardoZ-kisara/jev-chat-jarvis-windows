'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');

const TABLES=['c2c_msg_table','group_msg_table'];
function wire(buffer) {
  const data=Buffer.from(buffer);if(data.length>2*1024*1024)throw new Error('消息结构超过支持大小。');
  let pos=0;const fields=[];
  const read=()=>{let value=0n;for(let shift=0n;shift<70n;shift+=7n){if(pos>=data.length)throw new Error('消息结构截断。');const byte=data[pos++];if(shift===63n&&byte>1)throw new Error('消息整数溢出。');value|=BigInt(byte&127)<<shift;if(!(byte&128))return value;}throw new Error('消息整数无效。');};
  while(pos<data.length){
    if(fields.length>10000)throw new Error('消息字段过多。');
    const key=read(),field=Number(key>>3n),type=Number(key&7n);if(field<=0||field>536870911)throw new Error('消息字段无效。');
    let value;
    if(type===0)value=read();
    else if(type===2){const size=Number(read());if(!Number.isSafeInteger(size)||size>data.length-pos)throw new Error('消息结构截断。');value=data.subarray(pos,pos+size);pos+=size;}
    else if(type===1||type===5){const size=type===1?8:4;if(pos+size>data.length)throw new Error('消息结构截断。');value=data.subarray(pos,pos+size);pos+=size;}
    else throw new Error('消息编码类型不支持。');
    fields.push({field,type,value});
  }
  return fields;
}
function decodeBody(blob) {
  if(!blob?.length)return {text:'',unsupported:true};
  try {
    const parts=[];let unsupported=false;
    const elements=wire(blob).filter(x=>x.field===40800&&x.type===2);
    if(!elements.length)return {text:'',unsupported:true};
    for(const element of elements){
      const fields=wire(element.value),get=n=>fields.find(f=>f.field===n);
      const kind=Number(get(45002)?.value||0n);
      const text=f=>{const item=get(f);return item?.type===2?new TextDecoder('utf-8',{fatal:true}).decode(item.value):'';};
      const body=text(45101);
      if(body){parts.push(body);continue;}
      if(kind===7){parts.push('[引用先前消息]');continue;}
      if(kind===6){parts.push(text(47602)||'[QQ 表情]');continue;}
      const labels={2:'图片',3:'文件',4:'语音',5:'视频',8:'系统消息',9:'红包消息',10:'卡片',11:'贴图',14:'Markdown 消息',16:'合并转发',17:'按钮',21:'通话记录'};
      parts.push(`[${labels[kind]||'未解析消息类型 '+kind}${kind===3&&text(45402)?'：'+text(45402):''}]`);
      unsupported=true;
    }
    return {text:parts.join(''),unsupported};
  }catch{return {text:'[无法解析的消息]',unsupported:true,malformed:true};}
}
function openSnapshot(file) {
  const db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA query_only=ON;PRAGMA trusted_schema=OFF;');return db;
}
function inspectSnapshot(file) {
  const db=openSnapshot(file);
  try {
    const check=db.prepare('PRAGMA quick_check').all();if(check.length!==1||Object.values(check[0])[0]!=='ok')throw new Error('解密副本未通过 SQLite 完整性检查，未导入。');
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(r=>r.name);
    const sessions=[];
    for(const table of TABLES){
      if(!tables.includes(table))continue;
      const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
      if(['40001','40030','40033','40050','40800'].some(c=>!columns.has(c)))throw new Error('QQ 数据库字段与已验证版本不兼容，未猜测解析。');
      const rows=db.prepare(`SELECT CAST("40030" AS TEXT) AS peer,count(*) AS count,min("40050") AS first,max("40050") AS last FROM ${table} WHERE "40030">0 GROUP BY "40030" ORDER BY count(*) DESC`).all();
      for(const row of rows){
        let name='';
        if(table==='c2c_msg_table'&&columns.has('40093'))name=db.prepare(`SELECT "40093" AS name FROM ${table} WHERE "40030"=? AND "40033"=? AND "40093"<>'' ORDER BY "40050" DESC LIMIT 1`).get(row.peer,row.peer)?.name||'';
        sessions.push({...row,table,key:`${table}:${row.peer}`,name:table==='group_msg_table'?`群聊 ${row.peer}`:`${name||'QQ 好友'} (${row.peer})`});
      }
    }
    if(!sessions.length)throw new Error('副本中没有可识别的私聊或群聊记录。');
    return sessions;
  }finally{db.close();}
}
function *readConversation(file,session,account,batchSize=1000) {
  if(!TABLES.includes(session.table)||!/^\d{5,12}$/.test(String(account)))throw new Error('会话或本人 QQ 号无效。');
  const db=openSnapshot(file);
  try {
    const columns=new Set(db.prepare(`PRAGMA table_info(${session.table})`).all().map(c=>c.name));
    const optional=column=>columns.has(column)?`"${column}"`:'NULL';
    const statement=db.prepare(`SELECT CAST("40001" AS TEXT) AS messageId,CAST("40033" AS TEXT) AS sender,"40050" AS time,${optional('40093')} AS nickname,${optional('40090')} AS card,${optional('40013')} AS direction,"40800" AS body FROM ${session.table} WHERE "40030"=? ORDER BY "40050","40001"`);
    let messages=[],skipped=0,unsupported=0,malformed=0;
    for(const row of statement.iterate(session.peer)){
      const decoded=decodeBody(row.body);if(decoded.unsupported)unsupported++;if(decoded.malformed)malformed++;
      if(!decoded.text){skipped++;continue;}
      const timestamp=Number(row.time)*1000;
      if(!Number.isFinite(timestamp)||timestamp<0||timestamp>8640000000000000||!row.messageId){skipped++;continue;}
      let sender=row.sender;
      if(!sender||sender==='0')sender=[1,2].includes(Number(row.direction))?String(account):`unknown:${session.peer}`;
      const uid=createHash('sha256').update(`ntqq:${account}:${session.table}:${session.peer}:${row.messageId}`).digest('hex');
      messages.push({uid,time:new Date(timestamp).toISOString(),sender,senderName:String(row.card||row.nickname||sender).slice(0,100),side:sender===String(account)?'me':'other',text:decoded.text});
      if(messages.length>=batchSize){yield {messages,skipped,unsupported,malformed};messages=[];skipped=unsupported=malformed=0;}
    }
    if(messages.length||skipped||unsupported)yield {messages,skipped,unsupported,malformed};
  }finally{db.close();}
}
async function discover(root) {
  const found=[];for(const item of await fs.readdir(root,{withFileTypes:true})){
    if(!item.isDirectory()||!/^\d{5,12}$/.test(item.name))continue;
    const file=path.join(root,item.name,'nt_qq','nt_db','nt_msg.db');
    try{const stat=await fs.stat(file);found.push({account:item.name,sourceDb:file,bytes:stat.size,modified:stat.mtime.toISOString()});}catch{}
  }return found.sort((a,b)=>b.modified.localeCompare(a.modified));
}
const errors={KEY_NOT_FOUND_LOGIN_REQUIRED:'没有找到这个账号的消息库密钥。请保持该 QQ 账号已登录，再重新读取。',SOURCE_CHANGED_RETRY:'QQ 正在更新数据库，未得到稳定副本。请稍候重试。',PAGE_HMAC_FAILED:'消息页校验失败，副本未导入。请重新读取。',WAL_CHECKSUM_FAILED:'QQ WAL 日志校验失败，未忽略最近消息，请重试。',ACCESS_DENIED:'无法只读访问 QQ 数据或进程，请检查当前用户权限。',FILE_LOCKED_OR_READ_FAILED:'QQ 文件正在被锁定或读取失败，请稍候重试。',KEY_OR_CIPHER_UNSUPPORTED:'当前 QQ 版本的密钥或加密参数不兼容。'};
function extract(executable,sourceDb,workspace,signal,onProgress=()=>{}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('已取消读取。'));return;}
    const child=spawn(executable,[],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let output='',result,done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){child.kill();reject(error);}else resolve(value);};
    const abort=()=>finish(new Error('已取消读取。'));
    const timer=setTimeout(()=>finish(new Error('读取超过 5 分钟，已停止。请检查 QQ 登录状态后重试。')),300000);
    child.stdout.setEncoding('utf8');child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('error',()=>finish(new Error('无法启动 QQ 数据读取程序，请确认安装完整。')));
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){finish(new Error('读取程序输出异常。'));return;}let index;while((index=output.indexOf('\n'))!==-1){const line=output.slice(0,index).replace(/^\uFEFF/,'');output=output.slice(index+1);try{const item=JSON.parse(line);if(item.type==='progress')onProgress(item);if(item.type==='result')result=item;}catch{}}});
    child.on('close',code=>{if(code===0&&result?.ok)finish(null,result);else finish(new Error(errors[result?.code]||`QQ 数据读取未完成（${/^[A-Z_]+$/.test(result?.code||'')?result.code:'UNKNOWN'}）。`));});
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    child.stdin.end(JSON.stringify({sourceDb,workspace})+'\n');
  });
}
module.exports={wire,decodeBody,inspectSnapshot,readConversation,discover,extract};
