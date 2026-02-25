import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FlappyPage from './FlappyBird';
import './index.css';

const path = window.location.pathname;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {path === '/flappy' ? <FlappyPage /> : <App />}
  </React.StrictMode>
);
