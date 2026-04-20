# AnyCode

一个轻量级的 Typescript 语言 AI Agent 代码助手。

Keep It Sample, 希望简单的设计，实现高效的 Code Agent

## 功能特性

-   🤖 AI 驱动：使用 OpenAI 兼容的 API
-   💻 系统交互：支持执行 bash 命令
-   🔄 循环推理：可以多次调用工具解决问题
-   📦 轻量级设计：简洁的代码结构，易于理解和扩展

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

-   `OPENAI_API_KEY`: API 密钥
-   `OPENAI_BASE_URL`: API 基础 URL
-   `OPENAI_MODEL`: 使用的模型名称

## 使用示例

### 列出当前目录文件

```bash
npm run dev
```

### 创建一个新文件

```bash
npm run dev "创建一个名为 hello.txt 的文件，内容为 Hello World"
```

### 查看系统信息

```bash
npm run dev "显示当前系统的基本信息"
```

## 项目结构

```bash
.
├── src/
│   └── main.ts          # 主程序文件
│   └── tools.ts         # 工具定义文件
│   └── config.ts        # 配置文件
├── dist/                 # 编译输出目录
├── package.json
└── tsconfig.json
```

## 工作原理

1. 用户通过自然语言描述任务
2. AI 模型分析任务并决定是否需要调用工具
3. 如果需要，执行 bash 命令并获取结果
4. 根据结果继续推理或给出最终回答
5. 循环执行直到任务完成

## 许可证

MIT License

## 作者

AnyJohn
