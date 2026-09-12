import { hydrate } from 'workstar';
import { createView } from './hydration-view.js';

const host = document.querySelector('#app');
if (!host) throw new Error('Missing SSR host.');
hydrate(host, createView());
host.setAttribute('data-hydrated', 'true');
