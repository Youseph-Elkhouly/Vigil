// Constrained subset of the reviewed Giotto format. No HTML, images, URLs or scene edits.
export interface DiagramElement {
  id: string;
  type: "rectangle" | "ellipse" | "diamond" | "group" | "arrow";
  x?: number; y?: number; width?: number;
  label?: { text?: string; title?: string; lines?: string[] };
  tone?: "gray" | "blue" | "red" | "green" | "yellow";
  strokeStyle?: "solid" | "dashed" | "dotted";
  children?: string[];
  layout?: { direction: "row" | "column"; gap: number };
  start?: { id: string }; end?: { id: string };
}
export interface Diagram {
  title: string;
  elements: DiagramElement[];
  scenes?: { label: string; beats: { say: string; light: string[]; ms: number }[] }[];
}
export interface EvidenceLink {
  eventIds: string[]; findingIds: string[];
  resource: string | null;
  status: "attempted" | "denied" | "completed_tool" | "failed" | "observed" | "finding" | "inferred";
}
export interface SecurityMap {
  sessionId: string;
  diagram: Diagram;
  evidence: Record<string, EvidenceLink>;
  notices: string[];
  steps: { eventId: string; text: string; elementId: string }[];
}
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const fail = (): never => { throw new Error("Unsupported or invalid diagram"); };
const text = (v: unknown): void => { if (typeof v !== "string" || v.length > 1000) fail(); };
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail();
  return v as Record<string, unknown>;
};
const keys = (o: Record<string, unknown>, allowed: string[]): void => { if (Object.keys(o).some(k => !allowed.includes(k))) fail(); };
export function validateDiagram(value: unknown): asserts value is Diagram {
  const d = obj(value); keys(d, ["title", "elements", "scenes"]); text(d.title);
  if (!Array.isArray(d.elements) || d.elements.length > 500) fail();
  const ids = new Set<string>();
  for (const raw of d.elements as unknown[]) {
    const e = obj(raw); keys(e, ["id","type","x","y","width","label","tone","strokeStyle","children","layout","start","end"]);
    if (typeof e.id !== "string" || !ID.test(e.id) || ids.has(e.id) || ["__proto__","constructor","prototype"].includes(e.id)) fail(); ids.add(e.id as string);
    if (!["rectangle","ellipse","diamond","group","arrow"].includes(String(e.type))) fail();
    for (const key of ["x","y","width"]) if (e[key] !== undefined && (typeof e[key] !== "number" || !Number.isFinite(e[key]) || Math.abs(e[key] as number) > 100000 || (key === "width" && (e[key] as number) < 30))) fail();
    if (e.tone !== undefined && !["gray","blue","red","green","yellow"].includes(String(e.tone))) fail();
    if (e.strokeStyle !== undefined && !["solid","dashed","dotted"].includes(String(e.strokeStyle))) fail();
    if (e.label !== undefined) { const l = obj(e.label); keys(l,["text","title","lines"]); for (const k of ["text","title"]) if (l[k] !== undefined) text(l[k]); if (l.lines !== undefined) { if (!Array.isArray(l.lines) || l.lines.length > 8) fail(); (l.lines as unknown[]).forEach(text); } }
    if (e.type === "group") {
      if (!Array.isArray(e.children) || e.children.length > 600 || e.children.some(c => typeof c !== "string")) fail();
      if (e.layout !== undefined) { const l = obj(e.layout); keys(l,["direction","gap"]); if (!["row","column"].includes(String(l.direction)) || typeof l.gap !== "number" || l.gap < 0 || l.gap > 500) fail(); }
    } else if (e.children !== undefined || e.layout !== undefined) fail();
    if (e.type === "arrow") { for (const key of ["start","end"]) { const r = obj(e[key]); keys(r,["id"]); if (typeof r.id !== "string") fail(); } }
    else if (e.start !== undefined || e.end !== undefined) fail();
  }
  const parent = new Map<string,string>();
  for (const e of d.elements as DiagramElement[]) {
    for (const ref of [...(e.children ?? []), ...(e.start ? [e.start.id, e.end!.id] : [])]) if (!ids.has(ref) || ref === e.id) fail();
    for (const child of e.children ?? []) { if (parent.has(child)) fail(); parent.set(child,e.id); }
  }
  for (const id of ids) { let p: string | undefined = id; const seen = new Set<string>(); while (p) { if (seen.has(p)) fail(); seen.add(p); p = parent.get(p); } }
  if (d.scenes !== undefined) {
    if (!Array.isArray(d.scenes) || d.scenes.length > 10) fail();
    for (const raw of d.scenes as unknown[]) {
      const s = obj(raw); keys(s,["label","beats"]); text(s.label);
      if (!Array.isArray(s.beats) || s.beats.length < 1 || s.beats.length > 50) fail();
      for (const rawBeat of s.beats as unknown[]) { const b = obj(rawBeat); keys(b,["say","light","ms"]); text(b.say); if (!Array.isArray(b.light) || b.light.length > 50 || b.light.some(id => !ids.has(id))) fail(); if (typeof b.ms !== "number" || b.ms < 100 || b.ms > 10000) fail(); }
    }
  }
  if (JSON.stringify(d).length > 512000) fail();
}
