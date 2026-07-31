import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/app.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Renderer root element was not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

