import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { workstar } from 'workstar-compiler/vite';

const project = await mkdtemp(join(tmpdir(), 'workstar-compat-hmr-'));
const source = join(project, 'src');
const core = fileURLToPath(new URL('../src/index.ts', import.meta.url));
let server;
let browser;

try {
  await mkdir(source);
  await Promise.all([
    writeFile(
      join(project, 'index.html'),
      '<div id="app"></div><script type="module" src="/src/main.ts"></script>',
    ),
    writeFile(
      join(source, 'main.ts'),
      "import { mount } from 'workstar'; import { render } from './app.workstar'; mount(document.querySelector('#app')!, render({}));",
    ),
    writeFile(
      join(source, 'app.workstar'),
      '<script lang="ts">import ReactBadge from "./Badge.tsx?workstar"; import VueButton from "./Button.vue?workstar"; import VueCounter from "./Counter.vue?workstar"; import VueStore from "./Store.vue?workstar"; function click() { document.body.dataset.clicked = "yes"; }</script><main><Use component={ReactBadge} label="Ready" /><Use component={VueButton} label="Open" onClick={click} /><Use component={VueCounter} /><Use component={VueStore} /></main>',
    ),
    writeFile(
      join(source, 'Badge.tsx'),
      'export default function Badge({ label }: { label: string }) { return <p id="react">TSX {label}</p>; }',
    ),
    writeFile(
      join(source, 'Button.vue'),
      '<script setup lang="ts">const props = defineProps<{ label: string; onClick: () => void }>()</script><template><button id="vue" :title="props.label" @click="props.onClick">Vue {{ props.label }}</button></template><style scoped>#vue { color: red; }</style>',
    ),
    writeFile(
      join(source, 'Counter.vue'),
      '<script setup lang="ts">import { ref } from "vue"; const count = ref(0); function increment() { count.value++; }</script><template><button id="counter" @click="increment">Count {{ count }}</button></template>',
    ),
    writeFile(
      join(source, 'Store.vue'),
      '<script setup lang="ts">import { reactive } from "vue"; const state = reactive({ count: 0 }); function increment() { state.count++; }</script><template><button id="store" @click="increment">Store {{ state.count }}</button></template>',
    ),
  ]);

  server = await createServer({
    root: project,
    configFile: false,
    plugins: [workstar()],
    resolve: { alias: { workstar: core } },
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'silent',
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string')
    throw new Error('Vite did not expose a local port.');

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator('#react', { hasText: 'TSX Ready' }).waitFor();
  await page.locator('#vue[title="Open"]').waitFor();
  await page.locator('#vue').click();
  if ((await page.locator('body').getAttribute('data-clicked')) !== 'yes')
    throw new Error('Vue native event did not fire.');
  await page.locator('#counter').click();
  await page.locator('#counter', { hasText: 'Count 1' }).waitFor();
  await page.locator('#store').click();
  await page.locator('#store', { hasText: 'Store 1' }).waitFor();

  await writeFile(
    join(source, 'Badge.tsx'),
    'export default function Badge({ label }: { label: string }) { return <p id="react">TSX updated {label}</p>; }',
  );
  await page.locator('#react', { hasText: 'TSX updated Ready' }).waitFor();

  await writeFile(
    join(source, 'Button.vue'),
    '<script setup lang="ts">const props = defineProps<{ label: string; onClick: () => void }>()</script><template><button id="vue" :title="props.label" @click="props.onClick">Vue updated {{ props.label }}</button></template><style scoped>#vue { color: blue; }</style>',
  );
  await page.locator('#vue', { hasText: 'Vue updated Open' }).waitFor();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#vue')).color ===
      'rgb(0, 0, 255)',
  );
  process.stdout.write(
    'TSX and Vue imports, native events, and Vite live updates passed.\n',
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(project, { recursive: true, force: true });
}
