import { useEffect, useMemo, useState } from "react";
import type { Diagram } from "../shared/giotto";
import { GiottoDiagram } from "./GiottoDiagram";

export function AgentArchitecture({sessionId}:{sessionId:string}) {
  const [data,setData]=useState<{status:string;diagrams:{id:string;title:string}[];diagram?:Diagram}|null>(null);
  const [id,setId]=useState(""),[error,setError]=useState(""),[selected,setSelected]=useState("");
  useEffect(()=>{
    let disposed=false,running=false;let controller:AbortController|undefined;
    const update=async()=>{if(running)return;running=true;controller=new AbortController();try{
      const response=await fetch(`/api/architecture?session=${encodeURIComponent(sessionId)}${id?`&id=${encodeURIComponent(id)}`:""}`,{signal:controller.signal});
      if(!response.ok)throw new Error("Agent diagrams unavailable. Security monitoring remains active.");
      const next=await response.json();if(!disposed){setData(current=>JSON.stringify(current)===JSON.stringify(next)?current:next);setError("");}
    }catch(e){if(!disposed)setError(e instanceof Error?e.message:"Agent diagrams unavailable");}finally{running=false;}};
    void update();const timer=setInterval(()=>void update(),2000);return()=>{disposed=true;controller?.abort();clearInterval(timer);};
  },[sessionId,id]);
  const ids=useMemo(()=>data?.diagram?.elements.map(e=>e.id)??[],[data]);
  return <div className="map-steps"><p><strong>Agent-authored architecture · inferred</strong></p><p>These diagrams are explanations supplied by an agent. They do not establish observed operations or change security evidence.</p>
    <p role="status">Giotto MCP: {error||data?.status||"Loading…"}</p>
    {data?.status==="not_configured"&&<p>Start a Vigil session with <code>--giotto-mcp</code> to enable local diagram tools.</p>}
    <label>Architecture diagram <select value={id} onChange={e=>{setId(e.target.value);setSelected("");}}><option value="">Choose a diagram</option>{data?.diagrams.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
    {data?.diagram&&<GiottoDiagram doc={data.diagram} selectableIds={ids} onSelect={setSelected}/>}
    {selected&&<aside className="finding-detail">Selected element: <code>{selected}</code>. Inferred; no verified security event or finding is attached.</aside>}
  </div>;
}
