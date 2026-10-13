// Browser smoke test against the real HTTP hook handler, using synthetic hook envelopes and credentials.
// No Codex process or model call is required. Run after npm run build, on a machine that allows local servers.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { startService } from "../src/server/service.js";
import type { SecurityMap } from "../src/shared/giotto.js";

const root=mkdtempSync(path.join(tmpdir(),"vigil-browser-")), project=path.join(root,"project");
mkdirSync(path.join(project,"secrets"),{recursive:true});
const credential="ghp_000000000000000000000000000000000000";
writeFileSync(path.join(project,"secrets/credentials.env"),`GITHUB_TOKEN=${credential}`);
const session={id:"browser-smoke",projectPath:project,projectName:"Synthetic hook smoke",agent:"Codex hook test",status:"running" as const,startedAt:new Date().toISOString(),endedAt:null,simulated:false};
const token="synthetic-smoke-hook-token-12345";
const service=await startService({port:0,token,databasePath:path.join(root,"vigil.db"),session,protectedPaths:[path.join(project,"secrets/credentials.env")],uiDirectory:path.resolve("dist/ui")});
const base=`http://127.0.0.1:${service.port}`;
const chrome=spawn(process.env.CHROME_BIN??(process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":"google-chrome"),["--headless","--disable-gpu","--no-first-run","--remote-debugging-pipe",`--user-data-dir=${path.join(root,"chrome")}`],{stdio:["ignore","ignore","pipe","pipe","pipe"]});
let next=0,buffer="";const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
chrome.on("error",e=>{for(const p of pending.values())p.reject(e);});
chrome.on("exit",()=>{for(const p of pending.values())p.reject(new Error("Chrome exited before the smoke test completed"));});
const pipeOut=chrome.stdio[4]!,pipeIn=chrome.stdio[3]!;
pipeOut.on("data",chunk=>{buffer+=String(chunk);let at;while((at=buffer.indexOf("\0"))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;const msg=JSON.parse(line);const p=pending.get(msg.id);if(p){clearTimeout(p.timer);pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);}}});
const command=(method:string,params:unknown={},sessionId?:string)=>new Promise<any>((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>reject(new Error(`CDP timeout: ${method}`)),10000);pending.set(id,{resolve,reject,timer});(pipeIn as NodeJS.WritableStream).write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+"\0");});
let browserSession="";
const evaluate=async(expression:string)=>{const result=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},browserSession);if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const until=async(expression:string)=>{const deadline=Date.now()+10000;while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Browser condition timed out: ${expression}`);};
const hook=async(name:string,cmd:string,id:string)=>{const response=await fetch(`${base}/api/hooks`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({session_id:"synthetic-codex",hook_event_name:name,tool_name:"exec_command",tool_use_id:id,tool_input:{cmd},cwd:project,tool_response:name==="PostToolUse"?"Synthetic response":undefined})});assert.equal(response.status,200);return response.json();};
try{
  await hook("PreToolUse","cat README.md","readme");
  const target=await command("Target.createTarget",{url:`${base}/#session=${session.id}&view=map`});
  browserSession=(await command("Target.attachToTarget",{targetId:target.targetId,flatten:true})).sessionId;
  await command("Runtime.enable",{},browserSession);
  await until('!!document.querySelector("giotto-player")?.shadowRoot?.querySelector("[data-id]")');
  const denied=await hook("PreToolUse","cat secrets/credentials.env","denied");assert.equal(denied.hookOutput.hookSpecificOutput.permissionDecision,"deny");
  await until('document.querySelector("giotto-player")?.shadowRoot?.textContent.includes("Policy denied")');
  const payload=await (await fetch(`${base}/api/security-map?session=${session.id}`)).json() as {map:SecurityMap};
  const node=payload.map.diagram.elements.find(e=>e.id.startsWith("action-")&&payload.map.evidence[e.id].status==="denied")!;
  const eventId=payload.map.evidence[node.id].eventIds[0];
  await evaluate(`document.querySelector('giotto-player').shadowRoot.querySelector('[data-id="${node.id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}))`);
  await until(`document.querySelector('.map-evidence')?.textContent.includes('${eventId}')`);
  assert.ok(await evaluate("document.querySelector('.map-evidence').textContent.includes('denied')"));
  await hook("PostToolUse","cat README.md","readme");
  await until('document.querySelector("giotto-player")?.shadowRoot?.textContent.includes("Tool returned")');
  await command("Page.reload",{},browserSession);
  await until('document.querySelector("giotto-player")?.shadowRoot?.textContent.includes("Policy denied")');
  for(const format of ["json","svg"]){const response=await fetch(`${base}/api/security-map?session=${session.id}&format=${format}`);assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes(credential));assert.ok(!body.includes(token));}
  await evaluate(`window.originalFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.originalFetch(...args);if(String(args[0]).includes('/api/security-map')){const d=await response.json();d.map.diagram={title:'Invalid diagram',elements:[{id:'invalid',type:'image',href:'https://example.com'}]};return new Response(JSON.stringify(d),{status:200,headers:{'content-type':'application/json'}});}return response;}`);
  await hook("PreToolUse","cat README.md","redraw-failure");
  await until("document.querySelector('.map-status')?.textContent.includes('rendering failed')");
  const protectedAfterFailure=await hook("PreToolUse","cat secrets/credentials.env","still-denied");
  assert.equal(protectedAfterFailure.hookOutput.hookSpecificOutput.permissionDecision,"deny");
  console.log("PASS: synthetic hook → live embedded map → selected evidence; denied state, returned tool, reload, JSON/SVG redaction.");
}finally{for(const p of pending.values())clearTimeout(p.timer);chrome.kill();await service.close();rmSync(root,{recursive:true,force:true});}
