import { ChatCompletionTool } from "openai/resources/index";
import { ToolName } from "./toolName.enum";

const executeBashSchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.Bash,
        description: "Execute a bash command on the system.",
        parameters: {
            type: "object",
            properties: {
                command: {
                    type: "string",
                    description: "The bash command to execute",
                },
            },
            required: ["command"],
        },
    },
};

const editSchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.Edit,
        description:
            "Edit a file by replacing an exact old_string with new_string",
        parameters: {
            type: "object",
            properties: {
                filePath: {
                    type: "string",
                    description: "The path to the file to edit",
                },
                oldString: {
                    type: "string",
                    description: "The exact string to replace in the file",
                },
                newString: {
                    type: "string",
                    description: "The new string to replace with",
                },
            },
            required: ["filePath", "oldString", "newString"],
        },
    },
};

const exploreSchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.Explore,
        description: "Explore the directory structure with tree view",
        parameters: {
            type: "object",
            properties: {
                directoryPath: {
                    type: "string",
                    description:
                        "The root directory to explore (default: current working directory)",
                },
                maxDepth: {
                    type: "number",
                    description: "Maximum depth to explore (default: 3)",
                },
                ignorePatterns: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "List of directory/file names to ignore (overrides default)",
                },
            },
        },
    },
};

const globSchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.Glob,
        description:
            "Find files matching a glob pattern (like **/*.ts, src/**/*.json, etc.)",
        parameters: {
            type: "object",
            properties: {
                pattern: {
                    type: "string",
                    description:
                        "The glob pattern to match (e.g., **/*.ts, src/**/*.json)",
                },
                path: {
                    type: "string",
                    description:
                        "The directory to search in (default: current working directory)",
                },
            },
            required: ["pattern"],
        },
    },
};

const grepSchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.Grep,
        description: "Search for patterns in files using regular expressions",
        parameters: {
            type: "object",
            properties: {
                pattern: {
                    type: "string",
                    description: "The regular expression pattern to search for",
                },
                path: {
                    type: "string",
                    description:
                        "The directory or file to search in (default: current working directory)",
                },
                glob: {
                    type: "string",
                    description:
                        "Glob pattern to filter files (e.g., **/*.ts, *.js)",
                },
                output_mode: {
                    type: "string",
                    enum: ["files_with_matches", "content", "count"],
                    description:
                        "Output format: files_with_matches (list of files), content (show matching lines), count (show match counts)",
                },
                multiline: {
                    type: "boolean",
                    description: "Enable multiline matching",
                },
                case_insensitive: {
                    type: "boolean",
                    description: "Case-insensitive search",
                },
            },
            required: ["pattern"],
        },
    },
};

const readSchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.Read,
        description: "Read the content of a file with pagination support",
        parameters: {
            type: "object",
            properties: {
                filePath: {
                    type: "string",
                    description: "The path to the file to read",
                },
                offset: {
                    type: "number",
                    description: "Starting character position (default: 0)",
                },
                limit: {
                    type: "number",
                    description:
                        "Maximum number of characters to read (default: 8000)",
                },
            },
            required: ["filePath"],
        },
    },
};

const writeSchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.Write,
        description: "Write content to a file",
        parameters: {
            type: "object",
            properties: {
                filePath: {
                    type: "string",
                    description: "The path to the file to write",
                },
                content: {
                    type: "string",
                    description: "The content to write to the file",
                },
            },
            required: ["filePath", "content"],
        },
    },
};

const saveMemorySchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.SaveMemory,
        description:
            "Save a piece of information to long-term memory for future sessions. Use this when you learn something worth remembering across conversations (user preferences, key decisions, project conventions, durable facts). Do NOT use it for transient task state or trivial chatter. Default scope is project (this workspace); use global for cross-project preferences.",
        parameters: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description:
                        "The memory content to persist. Write it as a concise, self-contained note (you control phrasing).",
                },
                scope: {
                    type: "string",
                    enum: ["project", "global"],
                    description:
                        "project = this workspace only (default); global = cross-project general preference.",
                },
            },
            required: ["content"],
        },
    },
};

const askQuestionSchema: ChatCompletionTool = {
    type: "function",
    function: {
        name: ToolName.AskQuestion,
        description:
            "Ask the user 1-5 questions and block until they answer. Use when genuinely blocked on a decision that is theirs (ambiguous requirement, implementation approach with real trade-offs). Do NOT use for low-stakes choices (pick a sensible default yourself) or for confirming dangerous commands (the permission layer handles that). Put the recommended option first and suffix its label with ' (Recommended)' when you have a preference. Free-text ('Other') is auto-added per question — do not include an Other option yourself. Answers come back as a tool result (not a new user message).",
        parameters: {
            type: "object",
            properties: {
                questions: {
                    type: "array",
                    minItems: 1,
                    maxItems: 5,
                    items: {
                        type: "object",
                        properties: {
                            question: {
                                type: "string",
                                description: "The question to ask.",
                            },
                            header: {
                                type: "string",
                                description: "Short label for the question (modal title).",
                            },
                            options: {
                                type: "array",
                                minItems: 2,
                                maxItems: 4,
                                items: { type: "string" },
                                description:
                                    "2-4 choice labels. Omit for a free-text question. The first may be the recommended option (suffix ' (Recommended)').",
                            },
                            multiSelect: {
                                type: "boolean",
                                description:
                                    "Allow selecting multiple options. Requires `options`.",
                            },
                        },
                        required: ["question"],
                    },
                },
            },
            required: ["questions"],
        },
    },
};

export {
    globSchema,
    grepSchema,
    readSchema,
    writeSchema,
    editSchema,
    exploreSchema,
    executeBashSchema,
    saveMemorySchema,
    askQuestionSchema,
};
