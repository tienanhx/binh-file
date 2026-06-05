import React from 'react';
import ReactDOM from 'react-dom/client';
import PdfEditor from './components/PdfEditor';

function App() {
  return <PdfEditor />;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  let root = window._reactRoot;
  if (!root) {
    root = ReactDOM.createRoot(rootElement);
    window._reactRoot = root;
  }
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
