import { createHash } from "node:crypto";
import type { DashboardState, VigilEvent } from "../shared/types.js";
import { validateDiagram, type DiagramElement, type EvidenceLink, type SecurityMap } from "../shared/giotto.js";
import { redactKnown, redactString } from "./redaction.js";

const stable = (kind: string, value: string) => `${kind}-${createHash("sha256").update(value).digest("hex").slice(0,24)}`;
// Never put command text, responses, file content or URL credentials/query strings on the canvas.
const safe = (s: string) => redactString(s).replace(/[\u0000-\u001f]/g," ").slice(0,160);
export function actionStatus(e: VigilEvent): EvidenceLink["status"] {
  if (e.decision === "denied") return "denied";
  if (e.decision === "error") return "failed";
  if (e.eventType === "tool_attempt") return "attempted";
  if (e.eventType === "tool_result") return "completed_tool";
  return "observed";
}
export function resourceReferences(e: VigilEvent): { kind: string; name: string }[] {
  const out: {kind: string; name: string}[] = [];
  const raw = e.input && typeof e.input === "object" ? e.input as Record<string,unknown> : {};
  const input = e.eventType === "tool_result" && raw.input && typeof raw.input === "object" ? raw.input as Record<string,unknown> : raw;
  for (const field of ["file_path","path","filename"]) if (typeof input[field] === "string") out.push({kind:"File reference",name:safe(input[field] as string)});
  // Only one literal operand of a simple direct read; arbitrary shell parsing would imply false coverage.
  const cmd = input.cmd ?? input.command;
  if (typeof cmd === "string") {
    const read = /^(?:cat|head|tail|less|more|bat|xxd|strings|wc)\s+(?:"([^"\n]+)"|'([^'\n]+)'|([^\s;&|<>$`]+))\s*$/.exec(cmd);
    if (read) out.push({kind:"File reference",name:safe(read[1] ?? read[2] ?? read[3])});
  }
  const urls = [input.url, ...(typeof cmd === "string" ? cmd.match(/https?:\/\/[^\s'"<>]+/g) ?? [] : [])];
  for (const value of urls) if (typeof value === "string") { try { const u = new URL(value); if (["http:","https:"].includes(u.protocol)) out.push({kind:"Destination reference",name:safe(u.origin)}); } catch { /* unknown destination */ } }
  const server = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(e.toolName ?? "");
  if (server) out.push({kind:"MCP server",name:safe(server[1])});
  if (typeof input.server === "string" && e.toolName?.startsWith("mcp")) out.push({kind:"MCP server",name:safe(input.server)});
  return [...new Map(out.map(r=>[`${r.kind}:${r.name}`,r])).values()].slice(0,3);
}

export function buildSecurityMap(state: DashboardState, sessionId: string, findingId?: string, knownSecrets: readonly string[] = []): SecurityMap {
  const rawSession = state.sessions.find(s=>s.id===sessionId);
  if (!rawSession) throw new Error("session_not_found");
  const session=redactKnown(rawSession,knownSecrets);
  let events = [...new Map(state.events.filter(e=>e.sessionId===sessionId).map(e=>[e.id,e])).values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.id.localeCompare(b.id));
  const allFindings = state.findings.filter(f=>f.sessionId===sessionId).map(f=>redactKnown(f,knownSecrets));
  const finding = findingId ? allFindings.find(f=>f.id===findingId) : undefined;
  if (findingId && !finding) throw new Error("finding_not_found");
  const notices = ["References describe recorded tool inputs, not proof of file access or network delivery. A returned tool does not prove an inner operation completed.","Subprocess operations, unreported files, MCP internals and external destinations may be unavailable. Timeline order does not establish causality."];
  if (finding) {
    const i = events.findIndex(e=>e.id===finding.eventId);
    events = i < 0 ? [] : events.slice(Math.max(0,i-2),i+3);
    notices.push(i < 0 ? "This scanner finding has no recorded event sequence." : "Showing adjacent recorded events in the same session; no causal link is inferred.");
  } else if (events.length > 30) { notices.push(`Showing the latest 30 of ${events.length} recorded events.`); events = events.slice(-30); }
  events=events.map(e=>redactKnown(e,knownSecrets));
  const findings = (finding ? [finding] : allFindings.slice(0,50));
  if(events.some(e=>e.eventType.startsWith("tool_")&&!e.toolUseId)) notices.push("Some events have no invocation identifier. Attempts and results cannot be reliably paired for those records.");
  if (!finding && allFindings.length > 50) notices.push(`Showing 50 of ${allFindings.length} findings.`);
  const elements: DiagramElement[] = [];
  const evidence: Record<string,EvidenceLink> = Object.create(null);
  const add = (e: DiagramElement, link: EvidenceLink) => { elements.push(e); evidence[e.id] = link; };
  const agentId = stable("agent",sessionId);
  add({id:agentId,type:"ellipse",label:{title:safe(session.agent),lines:[safe(session.projectName),session.simulated ? "Simulated session" : "Recorded session"]},tone:"gray"}, {eventIds:events.map(e=>e.id),findingIds:[],resource:null,status:"observed"});
  const buckets = new Map<string,{id:string;events:VigilEvent[];refs:ReturnType<typeof resourceReferences>;status:EvidenceLink["status"]}>();
  for (const event of events) {
    const refs = resourceReferences(event), status = actionStatus(event);
    const key = JSON.stringify([event.toolName,event.eventType,status,refs,event.ruleId,event.simulated]);
    let b = buckets.get(key); if (!b) { b={id:stable("action",sessionId+key),events:[],refs,status}; buckets.set(key,b); } b.events.push(event);
  }
  const rows: string[] = [], steps: SecurityMap["steps"] = [];
  for (const b of buckets.values()) {
    const e = b.events[0], ids = b.events.map(e=>e.id), tone = b.status === "denied" || b.status === "failed" ? "red" : b.status === "completed_tool" ? "green" : "blue";
    const statusText = b.status === "completed_tool" ? "Tool returned · resource outcome unknown" : b.status;
    const link: EvidenceLink = {eventIds:ids,findingIds:[],resource:b.refs.map(r=>r.name).join(", ")||null,status:b.status};
    add({id:b.id,type:"rectangle",tone,strokeStyle:b.status === "attempted" ? "dashed" : "solid",label:{title:safe(e.toolName ?? e.eventType),lines:[statusText,`${ids.length} recorded event${ids.length===1?"":"s"}${e.simulated?" · Simulated":""}`,`Evidence: ${safe(ids[0])}`]}},link);
    add({id:stable("edge",b.id),type:"arrow",start:{id:agentId},end:{id:b.id},tone,label:{text:`${statusText} · ${ids.length} evidence`}},link);
    const children = [b.id];
    for (const ref of b.refs) {
      const id = stable("resource",b.id+ref.kind+ref.name), rLink = {...link,resource:ref.name};
      add({id,type:"rectangle",tone:"gray",label:{title:ref.kind,lines:[ref.name,"Referenced in tool input"]}},rLink); children.push(id);
      add({id:stable("reference",id),type:"arrow",start:{id:b.id},end:{id},tone,strokeStyle:"dotted",label:{text:`${b.status === "denied" ? "Denied attempt references" : "Input references"} · evidence`}},rLink);
    }
    if (!b.refs.length) notices.includes("Some tool resources are unavailable.") || notices.push("Some tool resources are unavailable.");
    if (e.ruleId || e.decision === "denied") {
      const id=stable("policy",b.id); add({id,type:"diamond",tone,label:{title:e.decision === "denied" ? "Policy denied" : "Policy decision",lines:[safe(e.ruleId ?? "Rule unavailable")]}},link); children.push(id);
      add({id:stable("decision",b.id),type:"arrow",start:{id:b.id},end:{id},tone,label:{text:"Recorded decision · evidence"}},link);
    }
    const row=stable("group",b.id); elements.push({id:row,type:"group",children,layout:{direction:"row",gap:80}}); rows.push(row);
    for (const ev of b.events) steps.push({eventId:ev.id,elementId:b.id,text:`${ev.simulated?"Simulated: ":""}${safe(ev.toolName ?? ev.eventType)} — ${statusText}. Evidence ${safe(ev.id)} at ${ev.timestamp}.`});
  }
  for (const f of findings) {
    const id=stable("finding",f.id), eventIds=f.eventId && events.some(e=>e.id===f.eventId)?[f.eventId]:[];
    const link: EvidenceLink={eventIds,findingIds:[f.id],resource:safe(f.resource),status:"finding"};
    add({id,type:"rectangle",tone:"yellow",label:{title:safe(f.title),lines:[safe(f.resource),`${f.severity} · ${f.simulated?"Simulated · ":""}${safe(f.source)}`,`Finding: ${safe(f.id)}`]}},link); rows.push(id);
    const source=eventIds.length ? buckets.size && [...buckets.values()].find(b=>b.events.some(e=>e.id===f.eventId))?.id : undefined;
    // Scanner findings without an event remain unconnected rather than inventing an agent action.
    if (source) add({id:stable("finding-edge",f.id),type:"arrow",start:{id:source},end:{id},tone:"yellow",label:{text:"Finding cites recorded event"}},link);
  }
  elements.push({id:"activity",type:"group",children:rows,layout:{direction:"column",gap:60}}, {id:"root",type:"group",children:[agentId,"activity"],layout:{direction:"row",gap:100}});
  steps.sort((a,b)=>events.findIndex(e=>e.id===a.eventId)-events.findIndex(e=>e.id===b.eventId));
  const diagram: SecurityMap["diagram"] = {title:`${safe(session.projectName)} — Security Map${session.simulated ? " · Simulated" : ""}`,elements};
  if (finding && steps.length) diagram.scenes=[{label:"Observed sequence",beats:steps.map(s=>({say:s.text,light:[s.elementId],ms:2500}))}];
  validateDiagram(diagram);
  return {sessionId,diagram,evidence,notices,steps};
}
