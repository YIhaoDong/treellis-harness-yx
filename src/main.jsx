/* main.jsx */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { STATIC_DEMO } from './staticDemo/mode.mjs';
import StaticDemo, { installStaticEnvironment } from './staticDemo/StaticDemo.jsx';

if (STATIC_DEMO) installStaticEnvironment();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {STATIC_DEMO ? <StaticDemo /> : <App />}
  </React.StrictMode>
);
