const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).filter(item=>!['bin','obj'].includes(item.name)).flatMap(item=>item.isDirectory()?walk(path.join(dir,item.name)):[path.join(dir,item.name)]); }
const shipped = [...walk(path.join(root,'src')), ...walk(path.join(root,'native')), ...walk(path.join(root,'licenses')), path.join(root,'resources/icon.ico')];
for (const file of shipped) {
  const packaged = path.join(root,'dist/win-unpacked/resources/app',path.relative(root,file));
  if (digest(file)!==digest(packaged)) throw new Error(`Packaged file differs from source: ${path.relative(root,file)}`);
}
for(const file of walk(path.join(root,'resources/ntqq'))){const packed=path.join(root,'dist/win-unpacked/resources/ntqq',path.relative(path.join(root,'resources/ntqq'),file));if(digest(file)!==digest(packed))throw new Error('Packaged QQ reader differs.');}
const version=require('../package.json').version;
const binaries=fs.readdirSync(path.join(root,'dist')).filter(name=>name.startsWith('Jev-QQ-Windows-')&&name.includes(`-${version}-`)&&name.endsWith('.exe')).map(name=>({name,size:fs.statSync(path.join(root,'dist',name)).size,sha256:digest(path.join(root,'dist',name))}));
const manifest={version:require('../package.json').version,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),verifiedAt:new Date().toISOString(),packagedSourceMatches:true,sourceFiles:shipped.map(file=>({path:path.relative(root,file).replaceAll('\\','/'),sha256:digest(file)})),binaries};
fs.writeFileSync(path.join(root,'dist/release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(root,'dist/SHA256SUMS.txt'),binaries.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n');
console.log(JSON.stringify({packagedSourceMatches:true,binaries},null,2));
