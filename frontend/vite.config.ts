import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  return {
    plugins: [react()],
    server: {
      // El proxy SOLO se activará en tu máquina local ('pnpm run dev')
      // En Render (producción) se quedará vacío {} para no interferir con las rutas relativas
      proxy: command === 'serve' ? {
        '/api': {
          target: 'http://127.0.0.1:5000',
          changeOrigin: true,
          secure: false,
        },
      } : {},
    },
  }
})


// Trigger restart

// Hard restart
