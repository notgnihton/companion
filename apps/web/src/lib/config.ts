/**
 * API Configuration
 * 
 * Determines the backend API URL based on the environment:
 * - Development: Uses Vite proxy to http://localhost:8787
 * - Production (GitHub Pages): Uses the deployed Railway server URL
 */

/**
 * Get the API base URL based on the current environment
 * 
 * In development (localhost:5173), returns empty string to use Vite proxy
 * In production (GitHub Pages), returns the Railway deployment URL
 */
export function getApiBaseUrl(): string {
  // Development: use Vite proxy (/api -> http://localhost:8787)
  if (import.meta.env.DEV) {
    return "";
  }

  // Production: use deployed Railway server
  // This should be set via environment variable in Vite build
  const apiUrl = import.meta.env.VITE_API_BASE_URL;
  
  if (apiUrl) {
    return apiUrl;
  }

  // Fallback: if no environment variable is set, return empty string
  // This will make API calls go to relative paths (which will 404 on GitHub Pages)
  // The app has offline-first fallback via localStorage, so it will still work
  return "";
}

/**
 * Build a full API endpoint URL
 * @param path - API path (e.g., "/api/dashboard")
 * @returns Full URL or relative path based on environment
 */
export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  
  // If no base URL, return path as-is (use proxy or relative)
  if (!base) {
    return normalizedPath;
  }
  
  // Remove trailing slash from base and combine
  return `${base.replace(/\/$/, "")}${normalizedPath}`;
}
