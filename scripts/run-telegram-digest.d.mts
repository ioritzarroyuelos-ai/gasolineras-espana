export function runTelegramDigest(env: {CRON_TOKEN?: string; DRY_RUN?: string}, fetcher?: typeof fetch): Promise<Record<string, unknown>>
