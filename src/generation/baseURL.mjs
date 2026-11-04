export function generationBaseURL() {
  // A deployed frontend is built with VITE_API_BASE (e.g. https://api.treellis.art).
  const configured = import.meta.env?.VITE_API_BASE;
  if (configured) return configured.replace(/\/+$/, '');
  const hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
  return `http://${hostname === '::1' ? '[::1]' : hostname}:3001`;
}
