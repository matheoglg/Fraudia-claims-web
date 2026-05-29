import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => {
  // Reemplaza esto con la URL real que te dio Render para tu backend
  const RENDER_BACKEND_URL = 'https://fraudia-math.onrender.com'; 

  return {
    plugins: [react()],
    server: {
      // En local usa el puerto 5000, en producción redirige con una regla limpia
      proxy: {
        '/api': {
          target: command === 'serve' ? 'http://127.0.0.1:5000' : RENDER_BACKEND_URL,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})