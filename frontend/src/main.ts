import { mount } from 'svelte';
import 'bootstrap/dist/css/bootstrap.min.css';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Application mount point was not found');

const app = mount(App, { target });

export default app;
