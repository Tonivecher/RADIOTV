import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/themes.css';

document.documentElement.classList.add('js');

class StartupBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div
        role="alert"
        style={{
          minHeight: '100svh',
          display: 'grid',
          placeContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          color: '#fff8ec',
          background: '#29251f',
        }}
      >
        <p>Не удалось открыть радио. Попробуйте загрузить страницу ещё раз.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Повторить загрузку
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StartupBoundary>
      <App />
    </StartupBoundary>
  </React.StrictMode>
);
