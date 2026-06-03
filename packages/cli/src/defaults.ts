export const productionServerUrl = "https://tokenburn.nayanbhut.dev";

export function defaultServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.TOKEN_BURN_SERVER_URL ?? productionServerUrl;
}
