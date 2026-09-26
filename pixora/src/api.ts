let token = localStorage.getItem('pixora_token') || '';
let refresh = localStorage.getItem('pixora_refresh') || '';
export const getToken = () => token;
export const setTokens = (t: string, r: string) => {
  token = t; refresh = r;
  if (t) { localStorage.setItem('pixora_token', t); if (r) localStorage.setItem('pixora_refresh', r); }
  else { localStorage.removeItem('pixora_token'); localStorage.removeItem('pixora_refresh'); }
};

export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

let refreshPromise: Promise<boolean> | null = null;
async function doRefresh(): Promise<boolean> {
  // single-flight: parallel 401s share ONE refresh; rotation stays consistent
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });
      if (!r.ok) return false;
      const d = await r.json();
      setTokens(d.token, d.refresh);
      // keep the live socket authenticated with the fresh token
      try { const sock = (window as any).__pixoraSocket; if (sock) { sock.auth = { token: d.token }; sock.disconnect().connect(); } } catch {}
      return true;
    } catch { return false; }
    finally { setTimeout(() => { refreshPromise = null; }, 100); }
  })();
  return refreshPromise;
}

// Backend origin — change THIS one line when moving hosting (Render/Vercel/your domain)
export const API_BASE = '';

async function req(method: string, path: string, body?: any, isForm = false): Promise<any> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: any;
  if (body && !isForm) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, { method, headers, body: isForm ? body : payload });
  if (res.status === 401 && refresh) {
    const ok = await doRefresh();
    if (ok) return req(method, path, body, isForm);
    if (res.status === 401) setTokens('', ''); // definitive rejection only
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'error', res.status);
  return data;
}

export const api = {
  get: (p: string) => req('GET', p),
  post: (p: string, b?: any) => req('POST', p, b),
  patch: (p: string, b?: any) => req('PATCH', p, b),
  del: (p: string, b?: any) => req('DELETE', p, b),
  upload: (p: string, form: FormData) => req('POST', p, form, true),
};
