import { mkdir,readFile,writeFile,rename } from "node:fs/promises";
import { execFileSync,spawnSync } from "node:child_process";
import path from "node:path";
import { PUBLICATION_JOBS,publicationHealthPlan,type PublicationJob,type PublicationHealth } from "../../lib/news/supervision.ts";
import { shouldRunRepairAgent } from "../../lib/news/repair-agent.ts";

const root="/root/OddsFront";
const directory=path.join(root,".local/news");
const output=path.join(directory,"monitor");
await mkdir(output,{recursive:true,mode:0o700});
if(!process.env.ODDSFRONT_MONITOR_LOCKED) {
  const child=spawnSync("flock",["-n",path.join(output,"monitor.lock"),process.execPath,...process.execArgv,...process.argv.slice(1)],{stdio:"inherit",env:{...process.env,ODDSFRONT_MONITOR_LOCKED:"1"}});
  process.exit(child.status??1);
}
async function read(file:string,fallback:Record<string,unknown>={}) { try{return JSON.parse(await readFile(file,"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return fallback;throw error;} }
async function atomic(file:string,value:unknown) { const temporary=`${file}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,file); }
function systemctl(...args:string[]) { return spawnSync("systemctl",args,{encoding:"utf8",timeout:15_000}); }
const now=Date.now();
const maintenance=await read(path.join(directory,"maintenance.json"));
const snapshots:PublicationHealth[]=[];
for(const job of Object.keys(PUBLICATION_JOBS) as PublicationJob[]) {
  const config=PUBLICATION_JOBS[job];
  const ledger=await read(path.join(directory,config.file));
  const service=systemctl("show",`oddsfront-${job}.service`,"--property=ActiveState","--value").stdout.trim();
  const pause=Number(maintenance[job]);
  snapshots.push({job,lastPublication:Number(ledger[config.timestamp]??0),pending:Boolean(ledger.pending),timerActive:systemctl("is-active","--quiet",`oddsfront-${job}.timer`).status===0,serviceRunning:service==="active"||service==="activating",pausedUntil:Number.isFinite(pause)&&pause<=now+12*3_600_000?pause:undefined});
}
const plan=publicationHealthPlan(snapshots,now);
if(process.argv.includes("--check")){console.log(JSON.stringify({checkedAt:new Date(now).toISOString(),...plan}));process.exit(0);}
const ledgerFile=path.join(output,"state.json");
const ledger=await read(ledgerFile,{failures:{},lastAction:{}});
const lastAction:Record<string,number>=ledger.lastAction??{};
const results=[];
for(const item of plan.actions) {
  const key=`${item.job}:${item.action}`;
  if(now-(lastAction[key]??0)<15*60_000)continue;
  const result=item.action==="enable-timer"?systemctl("enable","--now",`oddsfront-${item.job}.timer`):systemctl("start","--no-block",`oddsfront-${item.job}.service`);
  lastAction[key]=now;
  results.push({...item,accepted:result.status===0});
}
const failures:Record<string,number>={};
for(const item of plan.incidents)failures[item.job]=(ledger.failures?.[item.job]??0)+1;
let issueUrl=ledger.issueUrl as string|undefined;
// Only meaningful persistent failures notify the project, once per incident.
// Receipts and ambiguous sends are never erased to manufacture a healthy state.
if(!issueUrl && Object.values(failures).some(count=>count>=3)) {
  const bodyFile=path.join(output,"incident.md");
  await writeFile(bodyFile,`The OddsFront publication supervisor detected a persistent delivery incident at ${new Date(now).toISOString()}.\n\n${plan.incidents.map(item=>`- ${item.job}: ${item.reason}`).join("\n")}\n\nBounded timer/service recovery has been attempted. Inspect the private OddsFront publication receipts and service logs. Never clear an ambiguous send without verifying whether it was delivered.\n`,{mode:0o600});
  try { issueUrl=execFileSync("gh",["issue","create","--repo","svg8bit/OddsFront","--title","Publication incident: automatic recovery needs attention","--body-file",bodyFile],{cwd:root,encoding:"utf8",timeout:20_000,stdio:["ignore","pipe","ignore"]}).trim(); } catch { /* The private incident persists even if GitHub is unavailable. */ }
}
if(issueUrl && !plan.incidents.length) {
  const closed=spawnSync("gh",["issue","close",issueUrl,"--repo","svg8bit/OddsFront","--comment","Publication timestamps are current again; the supervisor recorded recovery."],{cwd:root,encoding:"utf8",timeout:20_000,stdio:"ignore"});
  if(closed.status===0)issueUrl=undefined;
}
await atomic(ledgerFile,{checkedAt:new Date(now).toISOString(),failures,lastAction,issueUrl});
await atomic(path.join(output,"latest.json"),{checkedAt:new Date(now).toISOString(),snapshots,...plan,results,issueUrl});
const agent=await read(path.join(output,"agent/state.json"));
const agentStatus=systemctl("show","oddsfront-publishing-repair.service","--property=ActiveState","--value").stdout.trim();
if(shouldRunRepairAgent({incidents:plan.incidents,failures,running:agentStatus==="active"||agentStatus==="activating",lastStartedAt:agent.lastStartedAt},now)) {
  const started=systemctl("start","--no-block","oddsfront-publishing-repair.service");
  console.log(JSON.stringify({status:"agent-repair-requested",accepted:started.status===0}));
}
if(plan.incidents.length||results.length)console.log(JSON.stringify({status:plan.incidents.length?"recovering":"recovered",incidents:plan.incidents,results,issueUrl}));
