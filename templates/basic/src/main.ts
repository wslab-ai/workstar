import { mount, signal } from 'workstar';
import { createHotContext, preserveFormState } from 'workstar/dev';
import { render } from './views/app.workstar';
import './style.css';

const host = document.querySelector('#app');
if (!host) throw new Error('Missing app mount point.');

const context = createHotContext();
const view = signal(render({}, context));
mount(host, () => view.value);

import.meta.hot?.accept('./views/app.workstar', (updated) => {
  if (updated) {
    void preserveFormState(host, () => {
      view.value = updated.render({}, context);
    });
  }
});
