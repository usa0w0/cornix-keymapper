// develop のビルドは /cornix-keymapper/dev/ で配信される（.github/workflows/deploy.yml）
export const isDevSite = import.meta.env.BASE_URL.endsWith('/dev/')
