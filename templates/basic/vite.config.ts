import { defineConfig } from 'vite';
import { workstar } from 'workstar-compiler/vite';

export default defineConfig({
  plugins: [workstar()],
});
