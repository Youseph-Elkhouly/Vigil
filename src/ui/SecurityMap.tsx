import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EvidenceLink, SecurityMap as MapData } from "../shared/giotto";
import type { Finding, Session, VigilEvent } from "../shared/types";
import { GiottoDiagram } from "./GiottoDiagram";
import { AgentArchitecture } from "./AgentArchitecture";

interface MapResponse {map:MapData;events:VigilEvent[];findings:Finding[]}
export function SecurityMapView({session,revision,findingId,onFinding,onEvent,onCloseExplanation}: {
  session?:Session;revision:string;findingId:string|null;
  onFinding:(finding:Finding,onClose:()=>void)=>ReactNode;
  onEvent:(event:VigilEvent,link:EvidenceLink)=>ReactNode;
  onCloseExplanation:()=>void;
}) {
  const [data,setData]=useState<MapResponse|null>(null),[error,setError]=useState("");
  const [selected,setSelected]=useState<string|null>(null),[step,setStep]=useState(0);
  const [selectedEventId,setSelectedEventId]=useState<string|null>(null);
  const [authored,setAuthored]=useState(false);
  const dirty=useRef(true); const latest=useRef(revision); latest.current=revision;
  useEffect(()=>{dirty.current=true;},[revision]);
  useEffect(()=>{
    setData(null);setSelected(null);setSelectedEventId(null);setStep(0);setError("");setAuthored(false);
    if(!session) return;
    let disposed=false, running=false; let last=""; let controller:AbortController|undefined;
    const update=async()=>{
      if(running || (!dirty.current && latest.current===last)) return;
      running=true;dirty.current=false;last=latest.current;controller=new AbortController();
      try{
        const url=`/api/security-map?session=${encodeURIComponent(session.id)}${findingId?`&finding=${encodeURIComponent(findingId)}`:""}`;
        const response=await fetch(url,{signal:controller.signal}); if(!response.ok) throw new Error("Security Map unavailable. Monitoring and enforcement remain active.");
        const next=await response.json() as MapResponse;
        if(!disposed){setData(current=>JSON.stringify(current)===JSON.stringify(next)?current:next);setError("");}
      }catch(e){if(!disposed)setError(e instanceof Error?e.message:"Diagram unavailable");}finally{running=false;}
    };
    dirty.current=true;void update();
    // Maximum four map requests/redraws per second, using the existing state stream as invalidation.
    const timer=window.setInterval(()=>void update(),250);
    return ()=>{disposed=true;controller?.abort();window.clearInterval(timer);};
  },[session?.id,findingId]);
  const selectable=useMemo(()=>data?Object.keys(data.map.evidence):[],[data]);
  const link=selected ? data?.map.evidence[selected] : undefined;
  const finding=link?.findingIds.map(id=>data?.findings.find(f=>f.id===id)).find(Boolean);
  const event=(selectedEventId&&link?.eventIds.includes(selectedEventId)?data?.events.find(e=>e.id===selectedEventId):undefined)??link?.eventIds.map(id=>data?.events.find(e=>e.id===id)).find(Boolean);
  const current=data?.map.steps[step];
  const exportUrl=(format:string)=>`/api/security-map?session=${encodeURIComponent(session!.id)}${findingId?`&finding=${encodeURIComponent(findingId)}`:""}&format=${format}`;
  return <section className="panel security-map-panel" aria-labelledby="security-map-title">
    <div className="panel-heading"><div><p className="eyebrow">Recorded evidence</p><h2 id="security-map-title">{findingId?"Explain visually":"Security Map"}</h2></div><div className="map-actions">{session&&<button className="text-button" aria-pressed={authored} onClick={()=>setAuthored(!authored)}>{authored?"Recorded security map":"Agent architecture"}</button>}{findingId&&<button className="text-button" onClick={onCloseExplanation}>Live map</button>}{session&&!authored&&<><a className="text-button" href={exportUrl("json")} download>Export JSON</a><a className="text-button" href={exportUrl("svg")} download>Export SVG</a></>}</div></div>
    {authored&&session?<AgentArchitecture sessionId={session.id}/>:<>
    {!session?<div className="empty">Choose a project and agent session to see its Security Map.</div>:<>
      {error&&<p className="error-banner" role="alert">{error}</p>}
      {!data&&!error&&<p className="empty" role="status">Loading recorded evidence…</p>}
      {data&&<>
        <div className="map-legend"><span className="map-attempt">Attempted</span><span className="map-completed">Tool returned</span><span className="map-denied">Denied / failed</span><span className="map-finding">Finding</span><span>Animations paused by default</span></div>
        <div className="map-layout"><div className="map-canvas"><GiottoDiagram doc={data.map.diagram} selectableIds={selectable} stepIndex={findingId?step:undefined} onSelect={id=>{setSelected(id);setSelectedEventId(null);}}/></div>
          {link&&<div className="map-evidence">{finding&&onFinding(finding,()=>setSelected(null))}{event&&onEvent(event,link)}{!finding&&!event&&<p>No recorded evidence for this element.</p>}
            <div className="map-evidence-links"><strong>Supporting records</strong>{link.eventIds.map(id=><button className="text-button" key={id} onClick={()=>setSelectedEventId(id)} aria-pressed={event?.id===id}>{id}</button>)}</div>
          </div>}
        </div>
        {findingId&&<div className="map-steps"><strong>Observed sequence · temporal order only</strong>{current?<><p>{current.text}</p><button className="text-button" disabled={step===0} onClick={()=>{setStep(step-1);setSelected(data.map.steps[step-1].elementId);}}>Previous</button><span>{step+1} / {data.map.steps.length}</span><button className="text-button" disabled={step===data.map.steps.length-1} onClick={()=>{setStep(step+1);setSelected(data.map.steps[step+1].elementId);}}>Next</button></>:<p>No event sequence was recorded for this finding.</p>}</div>}
        <ul className="map-notices">{data.map.notices.map(n=><li key={n}>{n}</li>)}</ul>
      </>}
    </>}
    </>}
  </section>;
}
