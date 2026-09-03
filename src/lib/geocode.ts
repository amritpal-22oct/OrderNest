// Server-only — reads MAPBOX_TOKEN, must never be imported from client code.
export type GeocodeResult = { lat: number; lng: number; formattedAddress: string };

export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=1&access_token=${process.env.MAPBOX_TOKEN!}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox geocoding failed: ${res.status}`);
  }
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { lat, lng, formattedAddress: feature.place_name };
}

// Autocomplete-style suggestions for a partial, in-progress address — each
// result already carries lat/lng, so picking one needs no follow-up lookup.
export async function suggestAddresses(query: string): Promise<GeocodeResult[]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?autocomplete=true&limit=5&access_token=${process.env.MAPBOX_TOKEN!}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox geocoding failed: ${res.status}`);
  }
  const data = await res.json();
  const features = data.features ?? [];
  return features.map((feature: { center: [number, number]; place_name: string }) => {
    const [lng, lat] = feature.center;
    return { lat, lng, formattedAddress: feature.place_name };
  });
}
