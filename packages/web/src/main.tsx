import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setTransport } from './api';
import './tokens.css';
import './app.css';

async function start() {
  // VITE_MOCK=1 swaps the network for the in-browser mock API built from examples/shop (tree-shaken otherwise).
  if (import.meta.env.VITE_MOCK === '1') setTransport((await import('./mock/index')).mockTransport());
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
