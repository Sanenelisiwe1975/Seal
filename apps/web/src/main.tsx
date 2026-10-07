import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { SealApiProvider } from './data/SealApiProvider';
import { ThemeProvider } from './lib/theme';
import { AuditorSessionProvider } from './wallet/AuditorSessionProvider';
import './global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SealApiProvider>
          <AuditorSessionProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AuditorSessionProvider>
        </SealApiProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
