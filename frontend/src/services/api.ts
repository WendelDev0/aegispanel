import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export const API_BASE_URL = window.location.origin;

export const api = axios.create({
  baseURL: '/api',
});

export function persistSession(token: string, user?: unknown): void {
  localStorage.setItem('aegis_token', token);
  if (user) localStorage.setItem('aegis_user', JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem('aegis_token');
  localStorage.removeItem('aegis_user');
}

/** Downloads an authenticated resource without dropping the bearer header. */
export async function downloadAuthenticated(url: string, filename: string): Promise<void> {
  const response = await api.get(url, { responseType: 'blob' });
  const objectUrl = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

api.interceptors.request.use((config) => {
  if (!config.headers.Authorization) {
    const token = localStorage.getItem('aegis_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

const AUTH_SKIP_401 = /\/auth\/(login|setup|2fa\/verify|2fa\/confirm|2fa\/disable|refresh)(?:\?|$)/;

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const token = localStorage.getItem('aegis_token');
  if (!token) return null;
  try {
    // Raw axios: the instance interceptor would recurse on a failed refresh.
    const res = await axios.post(
      '/api/auth/refresh',
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
    persistSession(res.data.token, res.data.user);
    return res.data.token as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const url = String(error.config?.url || '');
    const cfg = error.config as RetryConfig | undefined;
    if (status === 401 && cfg && !cfg._retry && !AUTH_SKIP_401.test(url)) {
      cfg._retry = true;
      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
      }
      const next = await refreshInFlight;
      if (next) {
        cfg.headers = cfg.headers || {};
        (cfg.headers as Record<string, string>).Authorization = `Bearer ${next}`;
        return api.request(cfg);
      }
      clearSession();
      window.dispatchEvent(new Event('aegis_auth_change'));
    }
    return Promise.reject(error);
  }
);
