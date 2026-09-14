/** Stable PCB copper colors, shared by fixed fanouts and new interconnects. */
export const layerColors: Record<string, string> = {
  top: "#dc2626",
  inner1: "#ca8a04",
  inner2: "#16a34a",
  inner3: "#0891b2",
  inner4: "#9333ea",
  inner5: "#ea580c",
  inner6: "#db2777",
  bottom: "#2563eb",
}
export const layerColor = (layer: string) => layerColors[layer] ?? "#64748b"
