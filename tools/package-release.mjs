// Allowlisted source files plus built assets; never archive local receipts or Git history.
import JSZip from 'jszip';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,readdir,stat,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(process.argv[2]||resolve(root,'../交付包/查重小助手-网站完全体.zip'));
const prefix='查重小助手-网站完全体/',zip=new JSZip(),sums=[];
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>/^(?:src|tools|public|docs|assets|legal|\.github)\//.test(p)||/^(?:README\.md|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.gitignore|启动本地预览\.(?:command|cmd))$/.test(p));
async function walk(dir){for(const entry of await readdir(resolve(root,dir),{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.name==='.DS_Store')continue;if(entry.isDirectory())await walk(path);else if(entry.isFile())files.push(path);}}
await walk('dist');files.push('src/model-assets.js');
async function add(path,data,mode=0o644){zip.file(prefix+path,data,{unixPermissions:mode});sums.push(createHash('sha256').update(data).digest('hex')+'  '+path);}
for(const path of [...new Set(files)].sort()){const absolute=resolve(root,path);await add(path,await readFile(absolute),(await stat(absolute)).mode);}
const manifest={name:'查重小助手-网站完全体',createdAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:'24 LTS',packageManager:'pnpm@11.25.0',sourceFiles:files.length,includes:['源码','已构建网站','OCR 模型及 WASM','测试','代码和部署说明','第三方许可'],excludes:['私人凭证','浏览器数据','node_modules','Git 历史']};
await add('release.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
zip.file(prefix+'SHA256SUMS.txt',sums.sort().join('\n')+'\n');
await mkdir(dirname(output),{recursive:true});await writeFile(output,await zip.generateAsync({type:'nodebuffer',platform:'UNIX',compression:'DEFLATE',compressionOptions:{level:6}}));
console.log(relative(process.cwd(),output)+' ('+(await stat(output)).size+' bytes)');
