// Fonte única de verdade para o endereço do backend SpindleOps.
// Nenhum outro arquivo deve conter "localhost" ou "3002".
//
// REACT_APP_API_URL vazio ("") = caminho relativo, mesma origem da página.
// REACT_APP_API_URL indefinido = fallback de dev na porta 3002.

const ENV_API = process.env.REACT_APP_API_URL;

const RAW_API =
  ENV_API === undefined
    ? `${window.location.protocol}//${window.location.hostname}:3002`
    : ENV_API;

export const API_BASE = RAW_API.replace(/\/+$/, '');

export const WS_BASE =
  process.env.REACT_APP_WS_URL ||
  (API_BASE === ''
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    : API_BASE.replace(/^http/, 'ws'));

export function apiUrl(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${clean}`;
}

export function wsUrl(path = '/') {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${WS_BASE}${clean}`;
}
