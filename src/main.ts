import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import pinia from './stores'
import i18n, { initLocale } from './i18n'

const app = createApp(App)

app.use(pinia)
app.use(i18n)
app.use(router)

// Initialize locale (load stored language) before mounting
initLocale().then(() => {
  app.mount('#app')
})
