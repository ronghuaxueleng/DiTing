import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(() => {
    return {
        plugins: [react(), tailwindcss()],
        base: './',
        server: {
            port: 5173,
            proxy: {
                '/api': {
                    target: 'http://localhost:5023',
                    changeOrigin: true,
                },
                '/covers': {
                    target: 'http://localhost:5023',
                    changeOrigin: true,
                },
            },
        },
        build: {
            outDir: 'dist',
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                    wizard: resolve(__dirname, 'wizard.html'),
                    workerManager: resolve(__dirname, 'worker-manager.html'),
                },
            },
        },
    }
})
