import { attr, html, mount, on, signal } from 'workstar';
import './style.css';

const count = signal(0);
const host = document.querySelector('#app');

if (!host) throw new Error('Missing app mount point.');

mount(
  host,
  html`<section class="card">
    <p class="eyebrow">Workstar 0.1 alpha</p>
    <h1>Build with less ceremony.</h1>
    <p>Small reactive state. Native HTML. No virtual DOM.</p>
    <button
      type="button"
      ${on('click', () => count.update((current) => current + 1))}
      ${attr('aria-label', () => `Count is ${count.value}`)}
    >
      Clicked ${count} times
    </button>
  </section>`,
);
