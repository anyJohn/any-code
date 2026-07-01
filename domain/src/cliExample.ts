#!/usr/bin/env node

import { AnyAgent, EventType } from "./index";

console.log("Starting AnyCode CLI...");

if (process.argv.length < 3) {
    console.error("Usage: node cli.ts <task>");
    console.error('Example: node cli.ts "列出当前目录文件"');
    process.exit(1);
}

const task = process.argv.slice(2).join(" ");

const agent = await AnyAgent.create();

agent.eventStream$.subscribe((event) => {
    switch (event.type) {
        case EventType.SYSTEM:
            console.log(`🔵 ${event.message}`);
            break;
        case EventType.USER:
            console.log(`👤 ${event.message}`);
            break;
        case EventType.ASSISTANT:
            console.log(`🤖 ${event.message}`);
            break;
        case EventType.TOOL:
            console.log(`🔧 ${event.message}`);
            break;
        case EventType.ITERATION:
            console.log(`🔄 ${event.message}`);
            break;
        case EventType.ERROR:
            console.error(`❌ ${event.message}`);
            if (event.data) {
                console.error(event.data);
            }
            break;
        default:
            console.log(event.message);
    }
});

agent.pendingTasks$.subscribe((tasks) => {
    if (tasks.length > 0) {
        console.log(`Processing ${tasks.length} tasks...`);
    }
});

agent.submit(task);

const timeout = setTimeout(() => {
    console.log("Operation timed out");
    agent.stop();
    process.exit(1);
}, 60000);

agent.pendingTasks$.subscribe((tasks) => {
    if (tasks.length === 0 && timeout) {
        clearTimeout(timeout);
        setTimeout(() => {
            console.log("Task completed");
            agent.stop();
            process.exit(0);
        }, 1000);
    }
});
