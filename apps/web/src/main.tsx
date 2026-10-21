import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { applyUiPreferences, useUiStore } from './auth-store';
import './styles.css';
// LAYER TEST: import './styles/legacy.css';
// LAYER TEST: import './styles/v6.css';
import './styles/hana.css';
import './styles/content-contrast.css';

applyUiPreferences(useUiStore.getState());

const queryClient = new QueryClient({ defaultOptions: {
  queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  mutations: { retry: 0 },
} });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></React.StrictMode>,
);
