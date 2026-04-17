import React from "react";
import { render } from "ink";
import meow from "meow";
import App from "./components/App";

const cli = meow(
	`
  Usage
    $ tui

  Options
    --api-key     OpenAI API key
    --base-url    API base URL
    --model       Model name

  Examples
    $ tui
    $ tui --model=gpt-4
    $ tui --api-key=sk-xxx --base-url=https://api.openai.com/v1
`,
	{
		importMeta: import.meta,
		flags: {
			apiKey: {
				type: "string",
			},
			baseUrl: {
				type: "string",
			},
			model: {
				type: "string",
			},
		},
	}
);

render(
	<App
		apiKey={cli.flags.apiKey}
		baseUrl={cli.flags.baseUrl}
		model={cli.flags.model}
	/>
);
