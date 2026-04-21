# AnyCode

一个轻量级的 Typescript 语言 AI Agent 代码助手。

Keep It Sample, 希望简单的设计，实现高效的 Code Agent

## 功能特性

- 🤖 AI 驱动：使用 OpenAI 兼容的 API（支持火山引擎方舟、OpenAI、Claude 等）
- 💻 系统交互：支持执行 bash 命令、文件操作、代码搜索等
- 🔄 循环推理：可以多次调用工具解决复杂问题（最多 30 次迭代）
- 📦 轻量级设计：简洁的代码结构，易于理解和扩展
- 🚀 响应式架构：基于 rxjs 的响应式编程，事件驱动
- 🧠 记忆系统：会话记忆管理，支持规则和技能加载
- 🔧 可扩展：支持 MCP 工具加载和自定义工具开发

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式运行

```bash
npm run dev "你的任务描述"
```

### 构建项目

```bash
npm run build
```

## 环境变量

你可以通过以下环境变量配置 Agent：

- `OPENAI_API_KEY`: API 密钥
- `OPENAI_BASE_URL`: API 基础 URL
- `OPENAI_MODEL`: 使用的模型名称

## 使用示例

### 使用 CLI 接口

```bash
npm run dev "列出当前目录文件"
npm run dev "创建一个名为 hello.txt 的文件，内容为 Hello World"
npm run dev "显示当前系统的基本信息"
```

### 使用编程接口

```typescript
import AnyAgent from './src/main';

const agent = new AnyAgent();

// 监听事件
agent.eventStream$.subscribe(event => {
    console.log(`[${event.type}] ${event.message}`);
});

// 监听任务完成
agent.pendingTasks$.subscribe(tasks => {
    if (tasks.length === 0) {
        console.log('所有任务已完成');
    }
});

// 提交任务
agent.submit("列出当前目录的所有文件");
```

## 项目结构

```bash
.
├── src/
│   ├── main.ts          # 主程序文件，定义 AnyAgent 类
│   ├── core.ts          # 核心推理循环 agentLoop()
│   ├── llm.ts           # LLM API 集成
│   ├── prompt.ts        # 系统提示词定义
│   ├── config.ts        # 配置文件
│   ├── memory.ts        # 记忆管理
│   ├── rule.ts          # 规则加载
│   ├── skill.ts         # 技能加载
│   ├── mcp.ts           # MCP 工具加载
│   ├── eventStream.ts   # 事件流管理（基于 rxjs）
│   ├── type.ts          # 类型定义
│   └── tools/           # 工具系统
│       ├── index.ts     # 工具导出
│       ├── toolCall.ts  # 工具调用执行
│       ├── schema.ts    # 工具 schema 定义
│       ├── toolName.enum.ts  # 工具名称枚举
│       └── functions/   # 工具实现（bash、read、write 等）
├── .agent/              # 运行时数据
│   ├── memory.md        # 会话记忆
│   ├── rules/           # 规则目录（*.md 文件）
│   └── skills/          # 技能目录（*.md 文件）
├── dist/                 # 编译输出目录
├── package.json
└── tsconfig.json
```

## 工作原理

1. **初始化**：创建 AnyAgent 实例，初始化响应式事件流和任务处理器
2. **任务提交**：通过 submit() 方法提交任务到任务流
3. **系统提示构建**：加载记忆、规则和技能，构建完整的系统提示
4. **推理循环**：agentLoop() 处理 LLM 交互和工具调用（最多 30 次迭代）
5. **工具执行**：通过 toolCall.ts 执行工具（支持 bash、read、write、explore 等）
6. **事件流**：所有事件通过 rxjs 响应式流发布
7. **记忆保存**：自动保存会话记忆到 .agent/memory.md

## 许可证

MIT License

## 作者

AnyJohn
