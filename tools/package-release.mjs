// Allowlisted source and built assets, with a self-contained Git clone.
import JSZip from 'jszip';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,readdir,stat,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(process.argv[2]||resolve(root,'../交付包/查重小助手-网站完全体.zip'));
const prefix='查重小助手-网站完全体/',zip=new JSZip(),sums=[];
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>/^(?:src|tools|public|docs|assets|legal|\.github)\//.test(p)||/^(?:README\.md|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.gitignore|启动本地预览\.(?:command|cmd))$/.test(p));
async function walk(dir){for(const entry of await readdir(resolve(root,dir),{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.name==='.DS_Store')continue;if(entry.isDirectory())await walk(path);else if(entry.isFile())files.push(path);}}
await walk('dist');files.push('src/model-assets.js');
async function add(path,data,mode=0o644){zip.file(prefix+path,data,{unixPermissions:mode});sums.push(createHash('sha256').update(data).digest('hex')+'  '+path);}
for(const path of [...new Set(files)].sort()){const absolute=resolve(root,path);await add(path,await readFile(absolute),(await stat(absolute)).mode);}
// Clone reachable history without local hardlinks/alternates or machine credentials.
const temporary=await mkdtemp(resolve(tmpdir(),'receipt-release-git-'));
try{
 const clone=resolve(temporary,'repository');
 execFileSync('git',['clone','--no-local',root,clone],{stdio:['ignore','ignore','pipe']});
 const remote=execFileSync('git',['remote','get-url','origin'],{cwd:root,encoding:'utf8'}).trim();
 const url=new URL(remote);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Release origin must be a public HTTP(S) URL without embedded credentials');
 execFileSync('git',['remote','set-url','origin',url.href],{cwd:clone});
 await writeFile(resolve(clone,'.git/info/exclude'),'# Generated delivery metadata\n/release.json\n/SHA256SUMS.txt\n');
 async function addGit(dir){for(const entry of await readdir(resolve(clone,dir),{withFileTypes:true})){const path=dir+'/'+entry.name;if(['logs','hooks'].includes(entry.name)&&dir==='.git')continue;if(entry.isDirectory())await addGit(path);else if(entry.isFile())await add(path,await readFile(resolve(clone,path)),(await stat(resolve(clone,path))).mode);}}
 await addGit('.git');
}finally{await rm(temporary,{recursive:true,force:true});}
const manifest={name:'查重小助手-网站完全体',createdAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:'24 LTS',packageManager:'pnpm@11.25.0',sourceFiles:files.length,includes:['源码','已构建网站','OCR 模型及 WASM','测试','代码和部署说明','第三方许可','完整 Git 历史、分支、标签与远程信息'],excludes:['私人凭证','浏览器数据','node_modules','Git 凭据、机器配置及 reflog']};
await add('release.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
zip.file(prefix+'SHA256SUMS.txt',sums.sort().join('\n')+'\n');
await mkdir(dirname(output),{recursive:true});await writeFile(output,await zip.generateAsync({type:'nodebuffer',platform:'UNIX',compression:'DEFLATE',compressionOptions:{level:6}}));
console.log(relative(process.cwd(),output)+' ('+(await stat(output)).size+' bytes)');
