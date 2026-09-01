import axios from 'axios';

export const API_BASE_URL = window.location.origin;

export const api = axios.create({
  baseURL: '/api',
});

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
  const token = localStorage.getItem('aegis_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('aegis_token');
      localStorage.removeItem('aegis_user');
      window.dispatchEvent(new Event('aegis_auth_change'));
    }
    return Promise.reject(error);
  }
);
