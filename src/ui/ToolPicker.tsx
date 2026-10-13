import { useState } from "react";
import type { CoverageItem, Session } from "../shared/types";
import { restoreToolChoices, toolOptions, toolStatus } from "./tools";

export function ToolPicker({session, coverage}: {session: Session; coverage: CoverageItem[]}) {
  const key = `vigil:tool-choices:v1:${session.simulated ? "demo" : "live"}:${session.id}`;
  const [choices, setChoices] = useState<string[]>(() => {try {return restoreToolChoices(localStorage.getItem(key));} catch {return [];}});
  const [message, setMessage] = useState("");
  const toggle = (id: string) => {
    const next = choices.includes(id) ? choices.filter(value => value !== id) : [...choices, id];
    setChoices(next);
    try {localStorage.setItem(key, JSON.stringify(next)); setMessage(session.simulated ? "Demo choices saved. No tools were installed." : "Setup choices saved in this browser.");}
    catch {setMessage("Your choices are available for this visit. Browser storage is unavailable.");}
  };
  return <section className="tool-picker" aria-labelledby="tools-title">
    <div className="tool-picker__heading"><div><p className="eyebrow">Build your workflow</p><h2 id="tools-title">Choose your tools</h2><p>{session.simulated ? "Try activating tools in this demo. These switches do not install software or change your agent." : "Select the tools you want to set up, then follow their guides. Selections do not activate protection on a running agent."}</p></div><span className="count">{choices.length} selected</span></div>
    <div className="tool-grid">{toolOptions.map(tool => {
      const selected = choices.includes(tool.id);
      return <article className={`tool-card ${selected ? "tool-card--selected" : ""}`} key={tool.id}>
        <div className="tool-card__top"><span className="eyebrow">{tool.audience}</span><label className="tool-toggle"><span className="sr-only">{session.simulated ? "Activate in demo:" : "Select for setup:"} {tool.name}</span><input type="checkbox" role={session.simulated ? "switch" : undefined} checked={selected} onChange={() => toggle(tool.id)}/><span className="toggle-track" aria-hidden="true"/></label></div>
        <h3>{tool.name}</h3><p>{tool.purpose}</p>
        <div className="tool-card__footer"><span className="tool-status">{toolStatus(tool, selected, session.simulated, coverage)}</span><a href={tool.guide} target="_blank" rel="noopener noreferrer" aria-label={`Open setup guide for ${tool.name} in a new tab`}>Setup guide <span aria-hidden="true">↗</span></a></div>
        {selected && !session.simulated && <div className="tool-setup"><strong>Next step</strong><p>{tool.setup}</p>{tool.id === "claude-controls" && <a href="https://code.claude.com/docs/en/permissions" target="_blank" rel="noopener noreferrer">Permission settings ↗</a>}</div>}
      </article>;
    })}</div>
    <p className="tool-picker__feedback" role="status">{message}</p>
  </section>;
}
