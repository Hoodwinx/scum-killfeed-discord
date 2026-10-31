import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import SftpClient from 'ssh2-sftp-client';
import { decodeLog, parseKill } from './parser.js';

const envPath = path.resolve('.env');
try {
  for (const line of (await fs.readFile(envPath, 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*?)\s*$/);
    if (match && !line.trim().startsWith('#') && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { if (e.code !== 'ENOENT') throw e; }

const cfg = {
  source: (process.env.SOURCE || 'local').toLowerCase(),
  localDir: path.resolve(process.env.LOCAL_LOG_DIR || './logs'),
  remoteDir: process.env.SFTP_LOG_DIR || '.',
  statePath: path.resolve(process.env.STATE_PATH || './data/state.json'),
  interval: Math.max(5, Number(process.env.POLL_SECONDS || 15)) * 1000,
  backfill: process.env.BACKFILL === 'true',
  dryRun: process.env.DRY_RUN !== 'false',
  webhook: process.env.DISCORD_WEBHOOK_URL
};
if (!['local','sftp'].includes(cfg.source)) throw Error('SOURCE must be local or sftp');
if (!cfg.dryRun && !cfg.webhook) throw Error('DISCORD_WEBHOOK_URL is required unless DRY_RUN=true');

async function loadState() {
  try { return JSON.parse(await fs.readFile(cfg.statePath, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { files: {} }; throw e; }
}
async function saveState(state) {
  await fs.mkdir(path.dirname(cfg.statePath), {recursive:true});
  const temp = cfg.statePath + '.tmp';
  await fs.writeFile(temp, JSON.stringify(state,null,2));
  await fs.rename(temp,cfg.statePath);
}
async function sourceFiles(sftp) {
  if (sftp) {
    const files = await sftp.list(cfg.remoteDir);
    return files.filter(f=>/^kill_.*\.log$/i.test(f.name) && f.type !== 'd')
      .map(f=>({name:f.name,size:f.size,modified:f.modifyTime||0}));
  }
  const files = await fs.readdir(cfg.localDir, {withFileTypes:true});
  const results=[];
  for(const file of files.filter(f=>f.isFile() && /^kill_.*\.log$/i.test(f.name))) {
    const stat=await fs.stat(path.join(cfg.localDir,file.name));
    results.push({name:file.name,size:stat.size,modified:stat.mtimeMs});
  }
  return results;
}
async function readFile(name,sftp) {
  if (sftp) {
    const chunks=await sftp.get(path.posix.join(cfg.remoteDir,name));
    if (!Buffer.isBuffer(chunks)) throw Error('SFTP download did not return a buffer');
    return chunks;
  }
  return fs.readFile(path.join(cfg.localDir,name));
}
function makeMessage(kill) {
  const esc = value => String(value).replace(/([\\*_~`>|])/g,'\\$1').slice(0,150);
  return {
    embeds:[{
      title:'💀 SCUM Killfeed',
      color:0xd65c5c,
      description:`**${esc(kill.killer)}** eliminated **${esc(kill.victim)}**`,
      fields:[
        {name:'Weapon',value:esc(kill.weapon),inline:true},
        {name:'Distance',value:kill.distance===null?'Unknown':`${kill.distance} m`,inline:true}
      ],
      footer:{text:`Kill log: ${kill.timestamp || 'timestamp unavailable'}`}
    }]
  };
}
async function deliver(kill) {
  if (cfg.dryRun) { console.log('[dry run]',JSON.stringify(kill)); return; }
  for(let attempt=0;attempt<4;attempt++){
    const res=await fetch(cfg.webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(makeMessage(kill))});
    if(res.ok) return;
    if(res.status!==429 && res.status<500) throw Error(`Discord webhook HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
    const retryAfter=Number(res.headers.get('retry-after'));
    await new Promise(resolve=>setTimeout(resolve,Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:1000*(attempt+1)));
  }
  throw Error('Discord delivery retries exhausted');
}
async function poll(sftp,state) {
  const files=await sourceFiles(sftp);
  files.sort((a,b)=>a.name.localeCompare(b.name));
  for(const file of files) {
    const previous=state.files[file.name];
    if(!previous && !cfg.backfill) {
      state.files[file.name]={size:file.size,modified:file.modified,lines:null};
      await saveState(state);
      console.log('Tracking new log at current end:',file.name);
      continue;
    }
    if(previous && previous.size===file.size && previous.modified===file.modified) continue;
    const data=await readFile(file.name,sftp);
    const decoded=decodeLog(data);
    const complete=decoded.endsWith('\n')?decoded:decoded.slice(0,decoded.lastIndexOf('\n')+1);
    const lines=complete.split(/\r?\n/).filter(Boolean);
    let cursor=(previous?.lines ?? 0);
    if(previous?.lines===null) {
      // Existing file at initial startup: ignore lines that predate observation.
      const oldComplete=previous.size===file.size ? complete : decodeLog(data.subarray(0,Math.min(previous.size,data.length)));
      cursor=oldComplete.split(/\r?\n/).filter(Boolean).length;
    }
    if(file.size<(previous?.size??0) || cursor>lines.length) cursor=0;
    for(let i=cursor;i<lines.length;i++){
      const kill=parseKill(lines[i]);
      if(kill) await deliver(kill);
      state.files[file.name]={size:file.size,modified:file.modified,lines:i+1};
      await saveState(state);
    }
    state.files[file.name]={size:file.size,modified:file.modified,lines:lines.length};
    await saveState(state);
  }
}
let stopping=false;
process.on('SIGTERM',()=>{stopping=true});
process.on('SIGINT',()=>{stopping=true});
console.log(`SCUM killfeed started: source=${cfg.source}, dryRun=${cfg.dryRun}, host=${os.hostname()}`);
const state=await loadState();
while(!stopping) {
  let sftp=null;
  try {
    if(cfg.source==='sftp'){
      sftp=new SftpClient();
      const options={host:process.env.SFTP_HOST,port:Number(process.env.SFTP_PORT||22),username:process.env.SFTP_USER};
      if(process.env.SFTP_PRIVATE_KEY_PATH) options.privateKey=await fs.readFile(process.env.SFTP_PRIVATE_KEY_PATH);
      else options.password=process.env.SFTP_PASSWORD;
      await sftp.connect(options);
    }
    await poll(sftp,state);
  }catch(e){console.error('[poll]',e.message)}
  finally{if(sftp) await sftp.end().catch(()=>{})}
  if(!stopping) await new Promise(resolve=>setTimeout(resolve,cfg.interval));
}
