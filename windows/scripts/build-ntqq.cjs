const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const result=spawnSync(process.env.JEV_DOTNET||'dotnet',['publish',path.join(__dirname,'../native/ntqq/NtqqBridge.csproj'),'-c','Release','-o',path.join(__dirname,'../resources/ntqq'),'--nologo'],{stdio:'inherit',windowsHide:true,env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false'}});
if(result.error){console.error('Building QQ reader requires .NET 8 SDK. Set JEV_DOTNET to its dotnet executable.');process.exitCode=1;}else process.exitCode=result.status||0;
if(process.exitCode===0){
 const list=spawnSync(process.env.JEV_DOTNET||'dotnet',['--list-sdks'],{encoding:'utf8',windowsHide:true});
 const sdkRoot=list.stdout?.match(/\[([^\]]+)\]/)?.[1];
 if(!sdkRoot)throw new Error('Cannot locate .NET license files.');
 for(const name of ['LICENSE.txt','ThirdPartyNotices.txt'])fs.copyFileSync(path.join(sdkRoot,'..',name),path.join(__dirname,'../resources/ntqq',name));
}
