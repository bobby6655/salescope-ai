import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createAssistantPlugin } from './server/assistant-plugin.js'

export default defineConfig({
  plugins: [react(), createAssistantPlugin()],
  server: {
    fs: { allow: ['.', './server'] },
  },
})
