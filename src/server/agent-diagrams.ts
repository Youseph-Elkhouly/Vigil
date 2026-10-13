import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateDiagram, type Diagram } from "../shared/giotto.js";
import { redactKnown } from "./redaction.js";
import schemas from "./giotto-upstream-schemas.json";

const ID=/^agent-[a-f0-9-]{36}$/;
export function assertOutsideProject(directory:string, project:string):void {
  const resolveExisting=(p:string):string=>existsSync(p)?realpathSync(p):path.join(resolveExisting(path.dirname(p)),path.basename(p));
  const d=resolveExisting(path.resolve(directory)),p=resolveExisting(path.resolve(project));
  if(d===p||d.startsWith(p+path.sep)) throw new Error("Giotto data directory must be outside the monitored project");
}
export function agentDirectory(databasePath:string, sessionId:string):string {
  // Session IDs are untrusted at API boundaries: use an opaque directory, never interpolate a path.
  const key=Buffer.from(sessionId).toString("hex");
  if(key.length>400) throw new Error("Invalid session ID");
  return path.join(path.dirname(databasePath),"giotto-agent",key);
}
function safeDoc(raw:unknown,secrets:readonly string[]):Diagram {
  validateDiagram(raw); const doc=redactKnown(raw,secrets); validateDiagram(doc);
  // Every authored relation remains inferred; this store cannot establish links to security evidence.
  return {...doc,title:`Inferred architecture: ${doc.title.replace(/^Inferred architecture: /,"").slice(0,120)}`,
    elements:doc.elements.map(e=>e.type==="arrow"?{...e,strokeStyle:"dashed",label:{text:`Inferred: ${(e.label?.text??"relationship").replace(/^Inferred: /,"").slice(0,160)}`}}:e)};
}
export class AgentDiagrams {
  constructor(readonly directory:string, readonly secrets:readonly string[] = []) { mkdirSync(directory,{recursive:true,mode:0o700}); if(lstatSync(directory).isSymbolicLink()) throw new Error("Symlink diagram directory rejected"); }
  private file(id:string):string { if(!ID.test(id)) throw new Error("Invalid authored diagram ID"); return path.join(this.directory,`${id}.json`); }
  list():{id:string;title:string;kind:string}[] {
    return readdirSync(this.directory).filter(f=>f.endsWith(".json")&&ID.test(f.slice(0,-5))).slice(0,100).flatMap(f=>{try{const id=f.slice(0,-5);return [{id,title:this.get(id).title,kind:"inferred architecture"}];}catch{return [];}});
  }
  get(id:string):Diagram { const file=this.file(id); if(lstatSync(file).isSymbolicLink()||lstatSync(file).size>512000) throw new Error("Invalid diagram file"); return safeDoc(JSON.parse(readFileSync(file,"utf8")),this.secrets); }
  private save(id:string,doc:unknown):Diagram {
    const safe=safeDoc(doc,this.secrets), file=this.file(id), tmp=`${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp,JSON.stringify(safe,null,2),{mode:0o600,flag:"wx"}); renameSync(tmp,file);return safe;
  }
  async call(name:string,args:Record<string,unknown>):Promise<unknown> {
    const fields:Record<string,string[]>={list_diagrams:[],get_diagram:["id"],create_diagram:["title","elements","scenes"],edit_diagram:["id","title","add","update","remove","scenes"]};
    if(!fields[name]||Object.keys(args).some(k=>!fields[name].includes(k))) throw new Error("Tool or fields unavailable in Vigil's restricted Giotto integration");
    if(name==="list_diagrams") return this.list();
    if(name==="get_diagram") return {id:args.id,...this.get(String(args.id))};
    if(name==="create_diagram") { const id=`agent-${randomUUID()}`; return {id,...this.save(id,{title:args.title,elements:args.elements??[],...(args.scenes?{scenes:args.scenes}:{})})}; }
    const id=String(args.id);const original=this.get(id);
    // Validate only the resulting immutable diagram. No arbitrary HTML, resources, style or exports.
    const {applyEdit}=await import("giotto/edit");
    const edited=applyEdit(original,args);
    if(args.title!==undefined) edited.title=args.title as string;
    if(args.scenes===null) delete edited.scenes; else if(args.scenes!==undefined) edited.scenes=args.scenes as Diagram["scenes"];
    return {id,...this.save(id,edited)};
  }
}
export const agentTools=schemas.map(tool=>{
  const fields:Record<string,string[]>={list_diagrams:[],get_diagram:["id"],create_diagram:["title","elements","scenes"],edit_diagram:["id","title","add","update","remove","scenes"]};
  return {name:tool.name,description:`Vigil restricted Giotto ${tool.name}. Architecture relationships are inferred. Only rectangle, ellipse, diamond, group and arrow elements; plain labels; no HTML, images, URLs, styles or scene edits. Scenes allow label and beats with say, light, ms. Security evidence is separate and immutable.`,inputSchema:{...tool.inputSchema,additionalProperties:false,properties:Object.fromEntries(Object.entries(tool.inputSchema.properties).filter(([key])=>fields[tool.name].includes(key)))}};
});
