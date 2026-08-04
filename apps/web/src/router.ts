import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue') },
    { path: '/installed', name: 'installed', component: () => import('./pages/InstallCompletePage.vue') },
    { path: '/', name: 'overview', component: () => import('./pages/OverviewPage.vue') },
    { path: '/agents/:id', name: 'agent', component: () => import('./pages/AgentPage.vue') },
    { path: '/agents/:id/scorecard', name: 'scorecard', component: () => import('./pages/ScorecardPage.vue') },
    { path: '/calls', name: 'calls', component: () => import('./pages/CallsPage.vue') },
    { path: '/calls/:id', name: 'call', component: () => import('./pages/CallPage.vue') },
  ],
})
