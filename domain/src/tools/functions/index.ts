import { executeBashFunc } from "./bash";
import { readFunc } from "./read";
import { editFunc } from "./edit";
import { writeFunc } from "./write";
import { exploreFunc } from "./explore";
import { planFunc } from "./plan";
import { globFunc } from "./glob";
import { grepFunc } from "./grep";
import { ToolName } from "../toolName.enum";

const ToolsMap: { [k: string]: (args: any) => Promise<string> } = {
  [ToolName.Bash]: executeBashFunc,
  [ToolName.Read]: readFunc,
  [ToolName.Edit]: editFunc,
  [ToolName.Write]: writeFunc,
  [ToolName.Explore]: exploreFunc,
  [ToolName.Plan]: planFunc,
  [ToolName.Glob]: globFunc,
  [ToolName.Grep]: grepFunc,
};

export { ToolsMap };
