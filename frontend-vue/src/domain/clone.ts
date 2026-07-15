/** Clone API DTOs and editable grid rows without retaining Vue reactive proxies. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
