import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {viteSingleFile} from 'vite-plugin-singlefile';
import packageJson from './package.json';

export default defineConfig({
    plugins: [react(), viteSingleFile()],
    define: {
        __APP_VERSION__: JSON.stringify(packageJson.version),
        __APP_UPDATED_AT__: JSON.stringify(new Date().toISOString()),
    },
    build: {assetsInlineLimit: 100000000},
});
