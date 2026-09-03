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
