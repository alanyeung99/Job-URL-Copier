import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: '#151b26',
          color: '#e8edf4',
          border: '1px solid #2a3548'
        },
        success: {
          iconTheme: { primary: '#10b981', secondary: '#151b26' }
        },
        error: {
          iconTheme: { primary: '#ef4444', secondary: '#151b26' }
        }
      }}
    />
  </React.StrictMode>
);
