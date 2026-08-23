import { createApp } from 'vue';
import App from './App.vue';
import './assets/app.css';
import { createAppI18n } from './i18n';

const i18n = createAppI18n('vi');

createApp(App).use(i18n).mount('#app');
