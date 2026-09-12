import { attr, html, on, signal } from 'workstar';

export function createView() {
  const count = signal(0);
  return html`<main>
    <h1>Server-rendered Workstar</h1>
    <noscript>Use the email link when scripts are disabled.</noscript>
    <button
      type="button"
      ${on('click', () => count.update((value) => value + 1))}
      ${attr('aria-label', () => `Count is ${count.value}`)}
    >
      Clicked ${count} times
    </button>
  </main>`;
}
