export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : `请求失败 (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrfToken && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(path, { ...init, credentials: "same-origin", headers });
  return parseResponse<T>(response);
}

export type UploadResult = {
  asset: unknown;
  backups?: {
    synced: number;
    skipped: number;
    failures: Array<{ label: string; error: string }>;
  };
};

export async function uploadAsset(form: FormData, onProgress?: (value: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/assets");
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as UploadResult);
      else {
        const message = data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `上传失败 (${xhr.status})`;
        reject(new ApiError(message, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("网络连接失败，请稍后重试", 0));
    xhr.send(form);
  });
}
