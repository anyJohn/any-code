// 内置连接器冒烟：spawn server → MCP-lite 握手 → tools/list → tools/call → 打印 → 退出
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(dir, "..", "src", "builtin-servers");

function handshake(script, args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(SERVER_DIR, script)], {
      env: {
        ...process.env,
        ABILITY_CONFIG: args.config ? JSON.stringify(args.config) : "",
      },
    });
    let buf = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error(label + " 超时"));
    }, 20000);
    function send(msg) {
      const s = JSON.stringify(msg);
      p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
    }
    p.stderr.on("data", (c) => process.stderr.write(`[${label} stderr] ${c}`));
    p.stdout.on("data", (c) => {
      buf += c.toString();
      while (true) {
        const i = buf.search(/\r\n\r\n|\n\n/);
        if (i < 0) break;
        const head = buf.slice(0, i);
        const len = /Content-Length:\s*(\d+)/i.exec(head);
        const sep = buf.startsWith("\r\n\r\n", i) ? 4 : 2;
        if (!len) {
          buf = buf.slice(i + sep);
          continue;
        }
        const n = Number(len[1]);
        const s = i + sep;
        if (buf.length < s + n) break;
        const msg = JSON.parse(buf.slice(s, s + n));
        buf = buf.slice(s + n);
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        } else if (msg.id === 2) {
          const tool = msg.result.tools[0];
          console.log(`${label} tools: ${msg.result.tools.map((t) => t.name).join(",")}`);
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: tool.name, arguments: args.callArgs },
          });
        } else if (msg.id === 3) {
          clearTimeout(timer);
          const txt = msg.result.content?.[0]?.text ?? "";
          const err = msg.result.isError ? " [isError]" : "";
          console.log(`${label} call → ${txt.slice(0, 140).replace(/\n/g, " ")}${err}`);
          p.kill();
          resolve(txt);
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
    });
  });
}

// 顺序：web-fetch（真抓 example.com）→ web-search（ddg 尽力）
await handshake("web-fetch-server.mjs", { callArgs: { url: "https://example.com" } }, "web-fetch");
await handshake("web-search-server.mjs", { callArgs: { query: "nodejs" } }, "web-search(ddg)");
console.log("SMOKE OK");
process.exit(0);