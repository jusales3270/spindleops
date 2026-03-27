import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Live     from './pages/Live';
import History  from './pages/History';
import Settings from './pages/Settings';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                 element={<Live />} />
        <Route path="/history/:id"      element={<History />} />
        <Route path="/history"          element={<History />} />
        <Route path="/settings"         element={<Settings />} />
        <Route path="*"                 element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
