import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSecurityMap, resourceReferences } from "../src/server/security-map.js";
import { validateDiagram } from "../src/shared/giotto.js";
import { exportMap } from "../src/server/diagram-export.js";
import { selectionId } from "../src/ui/giotto-selection.js";
import { AgentDiagrams, assertOutsideProject, agentTools } from "../src/server/agent-diagrams.js";
import type { DashboardState, VigilEvent } from "../src/shared/types.js";
import { toSvg, layoutWarnings } from "giotto/render";
import { readFigure } from "giotto/figure";
import { VigilDatabase } from "../src/server/database.js";

const session={id:"session",projectPath:"/project",projectName:"project",agent:"Codex",status:"running" as const,startedAt:"2026-01-01T00:00:00Z",endedAt:null,simulated:false};
const event:VigilEvent={id:"attempt",sessionId:session.id,timestamp:"2026-01-01T00:00:01Z",eventType:"tool_attempt",toolName:"exec_command",input:{cmd:"cat secrets/credentials.env"},decision:"denied",ruleId:"VIGIL-CODEX-PATH-001",reason:"Protected read denied",simulated:false};
const source:DashboardState={sessions:[session],events:[event],findings:[{id:"finding",sessionId:session.id,eventId:event.id,title:"Protected file read denied",resource:"secrets/credentials.env",source:"Vigil policy",severity:"high",status:"open",evidence:"Denied before execution",remediation:"Review policy",createdAt:event.timestamp,simulated:false}],coverage:[]};

test("map uses valid upstream format, stable IDs, evidence on every relationship, and denied attempts",async()=>{
  const map=buildSecurityMap(source,session.id);validateDiagram(map.diagram);
  assert.deepEqual(map,buildSecurityMap({...source,events:[event,event]},session.id));
  const svg=toSvg(map.diagram,{shadow:false});
  assert.match(svg,/data-id="action-/);assert.match(svg,/denied/);
  assert.equal(layoutWarnings(map.diagram).filter(w=>/doesn't exist/.test(w)).length,0);
  for(const e of map.diagram.elements.filter(e=>e.type==="arrow")){assert.ok(map.evidence[e.id]);assert.ok(map.evidence[e.id].eventIds.length||map.evidence[e.id].findingIds.length);}
  assert.equal(Object.values(map.evidence).some(l=>l.status==="completed_tool"),false);
  const node=map.diagram.elements.find(e=>e.id.startsWith("action-"))!;
  const picked=selectionId([{getAttribute:()=>node.id}],new Set(Object.keys(map.evidence)));
  assert.equal(picked,node.id);assert.deepEqual(map.evidence[picked!].eventIds,[event.id]);
  assert.equal(selectionId([{getAttribute:()=>"invented"}],new Set(Object.keys(map.evidence))),null);
});

test("attempts, returned tools, errors, destinations and unavailable subprocess information stay distinct",()=>{
  const events=[{...event,id:"network",decision:"allowed" as const,input:{cmd:"curl https://user:secret@example.com/path?token=secret"}},{...event,id:"returned",eventType:"tool_result" as const,decision:"allowed" as const,input:{input:{cmd:"cat README.md"},result:"contents"}},{...event,id:"failed",eventType:"tool_result" as const,decision:"error" as const},{...event,id:"subprocess",decision:"allowed" as const,input:{cmd:"python script.py"}}];
  const map=buildSecurityMap({...source,events,findings:[]},session.id);
  assert.deepEqual(resourceReferences(events[0]),[{kind:"Destination reference",name:"https://example.com"}]);
  assert.equal(resourceReferences(events[3]).length,0);
  assert.ok(Object.values(map.evidence).some(l=>l.status==="attempted"));assert.ok(Object.values(map.evidence).some(l=>l.status==="completed_tool"));assert.ok(Object.values(map.evidence).some(l=>l.status==="failed"));
  assert.match(JSON.stringify(map),/resource outcome unknown/);assert.doesNotMatch(JSON.stringify(map),/user:secret|path\?token|contents/);
});

test("visual explanation uses only recorded same-session adjacency and labels simulated steps",()=>{
  const map=buildSecurityMap({...source,events:[{...event,simulated:true},{...event,id:"other",sessionId:"other"}]},session.id,"finding");
  assert.equal(map.steps.length,1);assert.match(map.steps[0].text,/Simulated/);assert.equal(map.diagram.scenes?.[0].beats.length,1);
  const scanner=buildSecurityMap({...source,findings:[{...source.findings[0],eventId:null}]},session.id,"finding");
  assert.equal(scanner.steps.length,0);assert.equal(scanner.diagram.elements.some(e=>e.type==="arrow"),false);
});

test("all export bytes and embedded diagram metadata are redacted, including large SVGs",async()=>{
  const token="ghp_000000000000000000000000000000000000",known="synthetic-known-value-12345";
  const map=buildSecurityMap({...source,sessions:[{...session,projectName:`token=${token}`}],events:[{...event,input:{cmd:`echo ${token} ${known}`}}],findings:[{...source.findings[0],title:`password=${known}`}]},session.id,undefined,[known]);
  const json=await exportMap(map,"json",[known]);const svg=await exportMap(map,"svg",[known]);
  for(const output of [json,svg]){assert.ok(!output.includes(token));assert.ok(!output.includes(known));}
  const embedded=readFigure(svg);assert.ok(embedded);validateDiagram(embedded);assert.deepEqual(embedded,map.diagram);
  const many=buildSecurityMap({...source,events:Array.from({length:40},(_,i)=>({...event,id:`id-${i}`,toolName:`tool-${i}`}))},session.id);
  assert.ok((await exportMap(many,"svg",[])).length>64000);
});

test("reject HTML, external resources, duplicate IDs, dangling references and group cycles",()=>{
  for(const diagram of [{title:"x",html:"<script/>",elements:[]},{title:"x",elements:[{id:"x",type:"image",href:"https://x"}]},{title:"x",elements:[{id:"x",type:"rectangle"},{id:"x",type:"rectangle"}]},{title:"x",elements:[{id:"x",type:"arrow",start:{id:"missing"},end:{id:"x"}}]},{title:"x",elements:[{id:"x",type:"group",children:["y"]},{id:"y",type:"group",children:["x"]}]},{title:"x",elements:[{id:"x",type:"rectangle",label:{logo:"https://x"}}]}]) assert.throws(()=>validateDiagram(diagram));
});

test("restricted MCP uses reviewed schemas and stores separate redacted inferred diagrams",async()=>{
  const root=mkdtempSync(path.join(tmpdir(),"vigil-agent-"));try{
    const store=new AgentDiagrams(root);
    assert.throws(()=>assertOutsideProject(root,root));assertOutsideProject(root,"/unrelated");
    assert.deepEqual(agentTools.map(t=>t.name),["list_diagrams","create_diagram","get_diagram","edit_diagram"]);
    const made=await store.call("create_diagram",{title:"Architecture token=ghp_000000000000000000000000000000000000",elements:[{id:"a",type:"rectangle",label:{text:"Agent"}},{id:"b",type:"rectangle",label:{text:"API"}},{id:"edge",type:"arrow",start:{id:"a"},end:{id:"b"}}]}) as {id:string};
    const doc=store.get(made.id);assert.match(doc.title,/Inferred/);assert.match(doc.elements[2].label!.text!,/Inferred/);assert.doesNotMatch(readFileSync(path.join(root,`${made.id}.json`),"utf8"),/ghp_000/);
    await assert.rejects(store.call("create_page",{html:"<script/>"}));
    await assert.rejects(store.call("edit_diagram",{id:made.id,update:[{id:"a",href:"https://example.com"}]}));
    await store.call("edit_diagram",{id:made.id,update:[{id:"a",label:{text:"Updated"}}]});assert.equal(store.get(made.id).elements[0].label?.text,"Updated");
    await assert.rejects(store.call("get_diagram",{id:"../../security_maps"}));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("vendored renderer/player/MCP source blobs match the immutable reviewed commit",()=>{
  const root=path.resolve("vendor/giotto"),manifest=JSON.parse(readFileSync(path.join(root,"UPSTREAM.json"),"utf8"));
  assert.equal(manifest.commit,"4c06069944fd0f515e4e7bf89b9cca8398cd7936");
  for(const item of manifest.blobs){const bytes=readFileSync(path.join(root,item.path));assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),item.sha,item.path);}
});

test("SQLite reload restores stable diagrams and mappings, and bounds select the latest records",()=>{
  const root=mkdtempSync(path.join(tmpdir(),"vigil-map-reload-"));const file=path.join(root,"vigil.db");
  let db=new VigilDatabase(file);
  try{
    db.upsertSession(session);db.addEvent(event);db.addFinding(source.findings[0]);
    const map=buildSecurityMap(db.sessionEvidence(session.id),session.id);db.saveSecurityMap(map);db.close();db=new VigilDatabase(file);
    assert.deepEqual(db.securityMapSnapshot(session.id),JSON.parse(JSON.stringify(map)));assert.deepEqual(buildSecurityMap(db.sessionEvidence(session.id),session.id),map);
    const many=Array.from({length:600},(_,i)=>({...event,id:`event-${i}`,timestamp:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()}));
    const latest=buildSecurityMap({...source,events:many,findings:[]},session.id);
    assert.ok(Object.values(latest.evidence).some(e=>e.eventIds.includes("event-599")));assert.ok(!Object.values(latest.evidence).some(e=>e.eventIds.includes("event-100")));
    assert.match(latest.notices.join(" "),/latest 30 of 600/);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test("synthetic credential assignments are redacted before storage and diagram export",async()=>{
  const raw="API_KEY=synthetic-key-for-redaction\nGITHUB_TOKEN=ghp_000000000000000000000000000000000000";
  const values=raw.split("\n").filter(l=>l.includes("=")).map(l=>l.slice(l.indexOf("=")+1));
  const root=mkdtempSync(path.join(tmpdir(),"vigil-synthetic-"));const db=new VigilDatabase(path.join(root,"vigil.db"));
  try{
    db.upsertSession(session);db.addEvent({...event,input:{cmd:`echo ${raw}`}});
    const state=db.sessionEvidence(session.id),map=buildSecurityMap(state,session.id);db.saveSecurityMap(map);
    const outputs=[JSON.stringify(state),JSON.stringify(db.securityMapSnapshot(session.id)),await exportMap(map,"json",[]),await exportMap(map,"svg",[])];
    for(const output of outputs)for(const credential of values)assert.ok(!output.includes(credential));
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
