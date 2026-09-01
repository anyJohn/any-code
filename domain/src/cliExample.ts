#!/usr/bin/env node

// 纯 CLI demo 入口（pnpm dev:domain / start）。演示 AnyAgent 事件流订阅；
// 完整 CLI/TUI 见 tui 包。

import { AnyAgent } from "./index";

console.log("Starting AnyCode CLI...");

if (process.argv.length < 3) {
    console.error("Usage: node cli.ts <task>");
    console.error('Example: node cli.ts "列出当前目录文件"');
    process.exit(1);
}

const task = process.argv.slice(2).join(" ");

const agent = await AnyAgent.create({ rootPath: process.cwd() });

agent.eventStream$.subscribe((event) => {
    switch (event.type) {
        case "System":
            console.log(`🔵 ${event.message}`);
            break;
        case "User":
            console.log(`👤 ${event.message}`);
            break;
        case "Assistant":
            console.log(`🤖 ${event.message}`);
            break;
        case "Tool":
            console.log(`🔧 ${event.message}`);
            break;
        case "Iteration":
            console.log(`🔄 ${event.message}`);
            break;
        case "Error":
            console.error(`❌ ${event.message}`);
            if (event.error) {
                console.error(event.error);
            }
            break;
        default:
            console.log(event.message);
    }
});

let doneTimer: NodeJS.Timeout | null = null;
const timeout = setTimeout(() => {
    console.log("Operation timed out");
    agent.stop();
    process.exit(1);
}, 60000);

agent.pendingTasks$.subscribe((tasks) => {
    if (tasks.length > 0) {
        console.log(`Processing ${tasks.length} tasks...`);
    } else if (doneTimer === null) {
        clearTimeout(timeout);
        doneTimer = setTimeout(() => {
            console.log("Task completed");
            agent.stop();
            process.exit(0);
        }, 1000);
    }
});

agent.submit(task);
