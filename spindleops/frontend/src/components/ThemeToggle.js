import React, { useState, useEffect } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <button 
      onClick={toggle}
      className="theme-toggle"
      aria-label="Toggle theme"
      style={{
        background: 'var(--bg3)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        width: '32px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: '16px',
        transition: 'all 0.2s ease',
        color: 'var(--text)'
      }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
