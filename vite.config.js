import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
    publicDir: false,
    build: {
        outDir: 'build',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                login: path.resolve('code/login.html'),
                dashboard: path.resolve('code/dashboard.html'),
            },
        },
    },
});
