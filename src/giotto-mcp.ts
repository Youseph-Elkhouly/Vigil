// Session-scoped stdio sidecar. Never starts a canvas, listens on a port, or kills another instance.
import { createInterface } from "node:readline";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { AgentDiagrams, agentTools, assertOutsideProject } from "./server/agent-diagrams.js";

const directory=process.env.GIOTTO_DIR;
const project=process.env.VIGIL_PROJECT_PATH;
if(!directory||!project) throw new Error("Session-scoped GIOTTO_DIR and VIGIL_PROJECT_PATH are required");
assertOutsideProject(directory,project);
const store=new AgentDiagrams(directory,[process.env.VIGIL_HOOK_TOKEN??""]);
const status=path.join(directory,"status.json"), lock=path.join(directory,"sidecar.lock");
try{writeFileSync(lock,String(process.pid),{mode:0o600,flag:"wx"});}catch{throw new Error("This session's Giotto sidecar is already running or has a stale lock; use a new Vigil session.");}
const report=(state:string)=>writeFileSync(status,JSON.stringify({state,pid:process.pid,at:new Date().toISOString()}),{mode:0o600});
report("active");const heartbeat=setInterval(()=>report("active"),2000);heartbeat.unref();
const cleanup=()=>{clearInterval(heartbeat);report("stopped");rmSync(lock,{force:true});};
process.once("exit",cleanup);process.once("SIGTERM",()=>process.exit(0));process.once("SIGINT",()=>process.exit(0));
const reply=(v:unknown)=>process.stdout.write(JSON.stringify(v)+"\n");
// Bound the buffer before readline can accumulate an unbounded request.
let pendingBytes=0;process.stdin.on("data",(chunk:Buffer)=>{for(const byte of chunk){pendingBytes=byte===10?0:pendingBytes+1;if(pendingBytes>512000)process.exit(1);}});
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  let msg:{id?:string|number;method:string;params?:{protocolVersion?:string;name?:string;arguments?:Record<string,unknown>}};
  try{msg=JSON.parse(line);}catch{reply({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}});continue;}
  if(!msg||typeof msg!=="object"||typeof msg.method!=="string") {reply({jsonrpc:"2.0",id:null,error:{code:-32600,message:"Invalid request"}});continue;}
  if(msg.id===undefined) continue;
  try{
    let result:unknown;
    if(msg.method==="initialize") result={protocolVersion:msg.params?.protocolVersion??"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"vigil-giotto",version:"0.1.0"},instructions:"Create inferred project architecture and visual explanations here. Never treat authored relations as security evidence. Stored security maps are read-only and separate."};
    else if(msg.method==="ping")result={};
    else if(msg.method==="tools/list")result={tools:agentTools};
    else if(msg.method==="tools/call") {try{result={content:[{type:"text",text:JSON.stringify(await store.call(msg.params?.name??"",msg.params?.arguments??{}))}]};}catch{result={isError:true,content:[{type:"text",text:"Diagram rejected: invalid input, unavailable field, or missing authored diagram."}]};}}
    else{reply({jsonrpc:"2.0",id:msg.id,error:{code:-32601,message:"Method not found"}});continue;}
    reply({jsonrpc:"2.0",id:msg.id,result});
  }catch{reply({jsonrpc:"2.0",id:msg.id,error:{code:-32603,message:"Diagram sidecar unavailable"}});}
}
