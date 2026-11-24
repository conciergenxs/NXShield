import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource/hanken-grotesk/700.css';
import './styles.css';
import { AuthProvider } from './auth';
import { StoreProvider } from './store';
import { App } from './App';
import { applyTheme, readThemePref } from './lib/theme';

// Set the theme before the first paint so there is no flash of the wrong one.
applyTheme(readThemePref());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
