/** Identité du poste (§5.5) : conservée localement, jeton transmis dans les en-têtes. */
export interface StoredDevice {
  id: string;
  token: string;
  name: string;
}

const KEY = 'pharmastock.device';

export function getDevice(): StoredDevice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDevice;
    return parsed.id && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDevice(device: StoredDevice): void {
  localStorage.setItem(KEY, JSON.stringify(device));
}

export function clearDevice(): void {
  localStorage.removeItem(KEY);
}

export function suggestDeviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Navigateur';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPad|iPhone/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return `${browser}${os ? ` — ${os}` : ''}`;
}
