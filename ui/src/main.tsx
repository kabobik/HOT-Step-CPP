import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ToastContainer } from 'react-toastify'
import './index.css'
import './i18n'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { startHeapWatch } from './utils/heapWatch'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { queryClient } from './queries/client'

// Sampling the heap while we track down the idle out-of-memory crash. Costs one
// timer every 30 seconds and prints one line.
startHeapWatch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {/* One stable client (queries/client.ts), outside auth and every view. */}
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* Global error toasts from the axios interceptor (axiosClient.ts). */}
          <ToastContainer />
          <Suspense fallback={null}>
            <App />
          </Suspense>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Hosted inside Bobik: do not register a root-scoped service worker.
