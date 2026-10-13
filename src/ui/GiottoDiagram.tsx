import { createElement, useEffect, useRef, useState } from "react";
import { validateDiagram, type Diagram } from "../shared/giotto";
import { selectionId } from "./giotto-selection";

interface PlayerElement extends HTMLElement { doc: Diagram; figStyle: unknown; draw(): void; jump(index:number):void; step(direction:number):void }
function showStep(player:PlayerElement,doc:Diagram,index:number|undefined):void {
  if(index===undefined||!doc.scenes?.[0]) return;
  // Verified player jump() lands on the last beat when paused; step(-1) visits earlier beats.
  player.jump(0);
  for(let i=doc.scenes[0].beats.length-1;i>index;i--) player.step(-1);
}
export function GiottoDiagram({doc, selectableIds, onSelect, stepIndex}: {doc: Diagram; selectableIds: string[]; onSelect: (id: string)=>void; stepIndex?:number}) {
  const host=useRef<HTMLDivElement>(null);
  const callback=useRef(onSelect); callback.current=onSelect;
  const livePlayer=useRef<PlayerElement|null>(null), stepRef=useRef(stepIndex);stepRef.current=stepIndex;
  const [status,setStatus]=useState("Loading diagram…");
  useEffect(()=>{
    let disposed=false; let player: PlayerElement | undefined; let observer: MutationObserver | undefined;
    const known=new Set(selectableIds);
    const select=(event: Event) => {
      if (event instanceof KeyboardEvent && !["Enter"," "].includes(event.key)) return;
      const id=selectionId(event.composedPath(),known);
      if (id) { if (event instanceof KeyboardEvent) event.preventDefault(); callback.current(id); }
    };
    const fail=()=>{if(!disposed) setStatus("Giotto rendering failed. Activity and enforcement remain available in the dashboard.");};
    void import("giotto/player").then(()=>{
      if(disposed || !host.current) return;
      validateDiagram(doc);
      player=document.createElement("giotto-player") as PlayerElement;
      player.setAttribute("autoplay","false");
      player.setAttribute("theme","light");
      // Guard the verified draw method, including hover and animation redraws.
      const draw=player.draw.bind(player);
      player.draw=()=>{try {draw();} catch {fail();}};
      player.figStyle={shadow:false,fontSize:14,maxLabelWidth:240,groupPadding:16,background:"#ffffff",text:"#171717",stroke:"#737373",fill:"#ffffff",arrowColor:"#737373",accent:"#171717",groupFill:"#f5f5f5",groupStroke:"#dedede",tones:{
        gray:{fill:"#f5f5f5",stroke:"#737373",text:"#171717"},
        blue:{fill:"#ffffff",stroke:"#737373",text:"#171717"},
        green:{fill:"#ffffff",stroke:"#171717",text:"#171717"},
        red:{fill:"#171717",stroke:"#171717",text:"#ffffff"},
        yellow:{fill:"#ededed",stroke:"#171717",text:"#171717"},
      }};
      player.doc=doc;
      host.current.replaceChildren(player);
      livePlayer.current=player; showStep(player,doc,stepRef.current);
      const root=player.shadowRoot;
      if(!root || !root.querySelector("svg [data-id]")) throw new Error("Diagram did not render");
      root.addEventListener("click",select); root.addEventListener("keydown",select);
      const annotate=()=>{
        root.querySelectorAll("[data-id]").forEach(el=>{
          const id=el.getAttribute("data-id")!;
          if(!known.has(id)) return;
          el.setAttribute("tabindex","0"); el.setAttribute("role","button");
          el.setAttribute("aria-label",`Open evidence: ${el.textContent || id}`);
        });
      };
      observer=new MutationObserver(annotate); observer.observe(root,{childList:true,subtree:true}); annotate();
      setStatus("");
    }).catch(fail);
    return ()=>{disposed=true; livePlayer.current=null; observer?.disconnect(); player?.shadowRoot?.removeEventListener("click",select); player?.shadowRoot?.removeEventListener("keydown",select); player?.remove();};
  },[doc,selectableIds]);
  useEffect(()=>{if(livePlayer.current) {try{showStep(livePlayer.current,doc,stepIndex);}catch{setStatus("Giotto step unavailable. Recorded evidence remains available.");}}},[doc,stepIndex]);
  return createElement("div",{className:"giotto-container"},status && createElement("p",{role:"status",className:"map-status"},status),createElement("div",{ref:host}));
}
