import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '@/lib/telemetry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ClientErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void reportClientError(error, {
      kind: 'react',
      componentStack: info.componentStack || undefined,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 dark">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Application error</p>
          <h1 className="mt-2 text-2xl font-semibold">Repo Finisher hit an unexpected problem.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The failure was reported securely. Reload the app to recover; your stored analysis data is not changed by this screen.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Reload application
          </button>
        </section>
      </main>
    );
  }
}
