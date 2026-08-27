import { createRoot } from 'react-dom/client';

import App from './App';
import { ClientErrorBoundary } from '@/components/client-error-boundary';
import { installGlobalErrorHandlers } from '@/lib/telemetry';

import './index.css';
import './opaque-header.css';

installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <ClientErrorBoundary>
    <App />
  </ClientErrorBoundary>,
);
