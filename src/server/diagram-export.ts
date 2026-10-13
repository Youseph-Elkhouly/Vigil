import { validateDiagram, type SecurityMap } from "../shared/giotto.js";
import { redactKnown, redactString } from "./redaction.js";

export async function exportMap(map: SecurityMap, format: "json" | "svg", secrets: readonly string[]): Promise<string> {
  const safe = redactKnown(map,secrets); validateDiagram(safe.diagram);
  const check=(output:string):void=>{if(redactString(output,Infinity)!==output||secrets.some(s=>s.length>=8&&output.includes(s))) throw new Error("export_redaction_check_failed");};
  if (format === "json") {const output=JSON.stringify(safe,null,2);check(output);return output;}
  const { figureSvg, readFigure } = await import("giotto/figure");
  const svg = figureSvg(safe.diagram, {background:"#f5f5f5",fill:"#ffffff",text:"#171717",stroke:"#dedede",shadow:false}, {theme:"light",animated:false});
  // Check the WHOLE file, including embedded JSON, before releasing bytes.
  check(svg);
  const embedded=readFigure(svg); if (!embedded) throw new Error("export_metadata_missing"); validateDiagram(embedded);
  if (/<(?:script|foreignObject|image)\b|\b(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)/i.test(svg)) throw new Error("unsupported_export_resource");
  return svg;
}
