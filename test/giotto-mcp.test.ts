import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("stdio Giotto sidecar initializes, restricts tools, persists redacted explanations and cleans up on EOF",async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"vigil-mcp-test-"));
  const child=spawn(process.execPath,["--import","tsx","src/giotto-mcp.ts"],{env:{...process.env,GIOTTO_DIR:dir,VIGIL_PROJECT_PATH:"/unrelated-project",VIGIL_HOOK_TOKEN:"known-sidecar-secret-12345"},stdio:["pipe","pipe","pipe"]});
  let counter=0; const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const rpc=(method:string,params?:unknown)=>new Promise<any>((resolve,reject)=>{const id=++counter;const timer=setTimeout(()=>reject(new Error("MCP timeout")),4000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");});
  const lines=createInterface({input:child.stdout}); lines.on("line",line=>{const v=JSON.parse(line),p=pending.get(v.id);if(p){clearTimeout(p.timer);pending.delete(v.id);p.resolve(v.result);}});
  const exit=new Promise<void>(resolve=>child.once("exit",()=>resolve()));
  try{
    const info=await rpc("initialize",{protocolVersion:"2025-06-18"});assert.equal(info.serverInfo.name,"vigil-giotto");
    const tools=await rpc("tools/list");assert.equal(tools.tools.length,4);assert.ok(!tools.tools.some((t:any)=>t.name==="create_page"));
    const made=await rpc("tools/call",{name:"create_diagram",arguments:{title:"Architecture",elements:[{id:"a",type:"rectangle",label:{text:"known-sidecar-secret-12345"}}]}});
    assert.ok(!made.isError);const doc=JSON.parse(made.content[0].text);assert.match(doc.title,/Inferred architecture/);assert.ok(!JSON.stringify(doc).includes("known-sidecar-secret"));
    const blocked=await rpc("tools/call",{name:"create_page",arguments:{title:"unsafe",html:"<script/>"}});assert.equal(blocked.isError,true);
    assert.equal(JSON.parse(readFileSync(path.join(dir,"status.json"),"utf8")).state,"active");
    child.stdin.end();await exit;assert.equal(JSON.parse(readFileSync(path.join(dir,"status.json"),"utf8")).state,"stopped");assert.equal(existsSync(path.join(dir,"sidecar.lock")),false);
  }finally{child.kill();lines.close();for(const p of pending.values())clearTimeout(p.timer);rmSync(dir,{recursive:true,force:true});}
});
