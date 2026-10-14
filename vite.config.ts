import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages のプロジェクトサイト（https://usa0w0.github.io/cornix-keymapper/）で配信する
  base: '/cornix-keymapper/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
