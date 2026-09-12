import { mount } from 'workstar';
import { render } from './views/app.workstar';
import './style.css';

const host = document.querySelector('#app');
if (!host) throw new Error('Missing app mount point.');

mount(host, render({}));
