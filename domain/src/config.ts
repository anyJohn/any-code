export class Config {
	apiKey: string = process.env.OPENAI_API_KEY || "";
	baseURL: string = process.env.OPENAI_BASE_URL || "";
	model: string = process.env.OPENAI_MODEL || "";
	constructor() {}
}
