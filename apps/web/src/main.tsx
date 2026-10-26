import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { applyUiPreferences, useUiStore } from './auth-store';
import './styles.css';
import './styles/legacy.css';
import './styles/v6.css';
import './styles/hana.css';
import './styles/stat-metrics.css';
import './styles/content-contrast.css';
import './styles/workspace-panel.css';

applyUiPreferences(useUiStore.getState());

/* 平台标记：不使用。

   hana 在 Electron 里用 window.platform.getPlatform() 拿平台，
   写入 html[data-platform]，然后用 CSS 分流：
     :where(html:not([data-platform="win32"])) *::-webkit-scrollbar { 4px 细线 }
     Windows 上完全不定制，走系统原生 overlay 滚动条。

   **但那是 Electron 环境**，Electron 默认启用 OverlayScrollbar，
   所以「不定制」等于「得到系统 overlay 滚动条」（细、自动隐藏）。

   moheng 跑在普通浏览器里，Chrome 默认是经典滚动条（15-17px、常显）。
   如果在这里也「不定制」，得到的是粗且常显的滚动条，与 hana 观感相反。

   所以 moheng **不写 data-platform**，而是用 CSS 主动模拟 overlay 观感：
   4px 宽、默认透明、悬停或滚动时显现（见 hana.css 滚动条章节）。
   这是平台差异的补偿，不是偏离 hana 的设计意图。 */

const queryClient = new QueryClient({ defaultOptions: {
  queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  mutations: { retry: 0 },
} });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></React.StrictMode>,
);
