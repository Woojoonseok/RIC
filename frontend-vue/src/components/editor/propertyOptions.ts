export const COLOR_SWATCHES = [
  "#ffffff",
  "#fef3c7",
  "#dbeafe",
  "#dcfce7",
  "#ffe4e6",
  "#e5e7eb",
  "#111827",
  "#2563eb",
  "#dc2626",
] as const;

export function readableLayerColor(color: string | null | undefined): string {
  const value = /^#[0-9a-f]{6}$/i.test(color || "") ? color! : "#101828";
  const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return (red * 299 + green * 587 + blue * 114) / 1000 > 205 ? "#344054" : value;
}
