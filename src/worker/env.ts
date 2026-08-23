export type Env = {
  DB: any;
  VECTORIZE: any;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  CF_ACCOUNT_ID: string;
  CF_AI_GATEWAY_NAME: string;
  CF_AI_GATEWAY_AUTH_API_TOKEN: string;
  LLM_MODEL: string;
  EMBEDDING_MODEL: string;
  SESSION_SECRET: string;
};
