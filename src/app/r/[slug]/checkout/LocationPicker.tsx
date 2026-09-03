"use client";

import { useState } from "react";
import { haversineDistanceKm } from "@/lib/geo";
import type { RestaurantLocation } from "@/lib/types";

export type ResolvedLocation = {
  locationId: string;
  lat: number;
  lng: number;
  distanceKm: number;
};

function storageKey(slug: string) {
  return `ordernest_location_${slug}`;
}

export function loadStoredLocation(slug: string, locations: RestaurantLocation[]): ResolvedLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResolvedLocation;
    if (!locations.some((l) => l.id === parsed.locationId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredLocation(slug: string) {
  try {
    window.localStorage.removeItem(storageKey(slug));
  } catch {
    // ignore
  }
}

function nearestLocation(locations: RestaurantLocation[], point: { lat: number; lng: number }) {
  let best: { location: RestaurantLocation; distanceKm: number } | null = null;
  for (const location of locations) {
    const distanceKm = haversineDistanceKm(point, location);
    if (!best || distanceKm < best.distanceKm) best = { location, distanceKm };
  }
  return best;
}

export function LocationPicker({
  slug,
  locations,
  onResolved,
}: {
  slug: string;
  locations: RestaurantLocation[];
  onResolved: (result: ResolvedLocation) => void;
}) {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState<"geo" | "address" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resolve(point: { lat: number; lng: number }) {
    const best = nearestLocation(locations, point);
    if (!best) return;
    const result: ResolvedLocation = { locationId: best.location.id, lat: point.lat, lng: point.lng, distanceKm: best.distanceKm };
    try {
      window.localStorage.setItem(storageKey(slug), JSON.stringify(result));
    } catch {
      // ignore
    }
    onResolved(result);
  }

  function useMyLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Your browser doesn't support location sharing — please enter your address instead.");
      return;
    }
    setLoading("geo");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(null);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLoading(null);
        setError("Couldn't access your location — please enter your address instead.");
      },
      { timeout: 8000 },
    );
  }

  async function useTypedAddress() {
    if (address.trim().length < 4) {
      setError("Please enter a more complete address.");
      return;
    }
    setError(null);
    setLoading("address");
    try {
      const res = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to look up that address");
      resolve({ lat: data.lat, lng: data.lng });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to look up that address");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="font-medium text-neutral-900">Find your nearest location</h2>
      <p className="mt-1 text-sm text-neutral-500">We&apos;ll use this to check delivery availability.</p>

      <button
        type="button"
        onClick={useMyLocation}
        disabled={loading !== null}
        className="mt-4 w-full rounded-full bg-neutral-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading === "geo" ? "Finding you…" : "Use my current location"}
      </button>

      <div className="mt-4 flex gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Or enter your address"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={useTypedAddress}
          disabled={loading !== null}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
        >
          {loading === "address" ? "Looking up…" : "Use this address"}
        </button>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
