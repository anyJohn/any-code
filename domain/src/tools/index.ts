import { toolCall } from "./toolCall";
import {
  globSchema,
  grepSchema,
  planSchema,
  readSchema,
  writeSchema,
  editSchema,
  exploreSchema,
  executeBashSchema,
} from "./schema";

const ToolKit = {
  allTools: [
    executeBashSchema,
    readSchema,
    editSchema,
    writeSchema,
    exploreSchema,
    planSchema,
    globSchema,
    grepSchema,
  ],
  readOnlyTools: [readSchema, exploreSchema, globSchema, grepSchema],
  executeTools: [
    executeBashSchema,
    readSchema,
    editSchema,
    writeSchema,
    exploreSchema,
    globSchema,
    grepSchema,
  ],
};

export { toolCall, ToolKit };
