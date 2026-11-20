import type {
  GeocodeResult,
  IMapsAdapter,
  PlaceSuggestion,
  RouteComputeResult,
} from '../interfaces/services.ts';

function getServerMapsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
}

export class GoogleMapsIntegrationAdapter implements IMapsAdapter {
  isConfigured(): boolean {
    return getServerMapsApiKey().length > 10;
  }

  computeDistanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
  }

  estimateEtaMinutes(distanceKm: number): number | null {
    // Only return calculated route ETA if route provider is configured.
    // Callers seeking real traffic ETA should invoke computeRoute().
    if (!this.isConfigured()) {
      return null;
    }
    const minutes = Math.ceil((distanceKm / 22) * 60 + 4);
    return Math.max(5, minutes);
  }

  async computeRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): Promise<RouteComputeResult> {
    const distanceKm = this.computeDistanceKm(from, to);
    const apiKey = getServerMapsApiKey();
    if (!apiKey) {
      return {
        available: false,
        distanceKm,
        etaMinutes: null,
        encodedPolyline: null,
        reason: 'Route provider not configured',
      };
    }

    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: {
            location: { latLng: { latitude: from.lat, longitude: from.lng } },
          },
          destination: {
            location: { latLng: { latitude: to.lat, longitude: to.lng } },
          },
          travelMode: 'TWO_WHEELER',
          routingPreference: 'TRAFFIC_AWARE',
        }),
      });

      if (!response.ok) {
        return {
          available: false,
          distanceKm,
          etaMinutes: null,
          encodedPolyline: null,
          reason: `Routes API returned HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        routes?: Array<{
          distanceMeters?: number;
          duration?: string;
          polyline?: { encodedPolyline?: string };
        }>;
      };
      const route = data.routes?.[0];
      if (!route) {
        return {
          available: false,
          distanceKm,
          etaMinutes: null,
          encodedPolyline: null,
          reason: 'No route returned by provider',
        };
      }

      const durationSec = route.duration ? Number.parseInt(route.duration.replace('s', ''), 10) : 0;
      return {
        available: true,
        distanceKm: route.distanceMeters ? Math.round((route.distanceMeters / 1000) * 100) / 100 : distanceKm,
        etaMinutes: durationSec > 0 ? Math.max(2, Math.ceil(durationSec / 60)) : null,
        encodedPolyline: route.polyline?.encodedPolyline || null,
      };
    } catch {
      return {
        available: false,
        distanceKm,
        etaMinutes: null,
        encodedPolyline: null,
        reason: 'Unable to reach Routes API',
      };
    }
  }

  async geocodeAddress(address: string): Promise<GeocodeResult> {
    const apiKey = getServerMapsApiKey();
    if (!apiKey) {
      return { available: false, reason: 'Google Maps Geocoding API not configured' };
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        address
      )}&region=in&key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) {
        return { available: false, reason: `Geocoding API returned HTTP ${res.status}` };
      }
      const data = (await res.json()) as {
        status?: string;
        results?: Array<{
          formatted_address?: string;
          geometry?: { location?: { lat: number; lng: number } };
          address_components?: Array<{ long_name: string; types: string[] }>;
        }>;
      };
      const first = data.results?.[0];
      if (!first?.geometry?.location) {
        return { available: false, reason: data.status || 'No geocode match' };
      }
      const postal = first.address_components?.find((c) => c.types.includes('postal_code'))?.long_name;
      return {
        available: true,
        latitude: first.geometry.location.lat,
        longitude: first.geometry.location.lng,
        formattedAddress: first.formatted_address,
        postalCode: postal,
      };
    } catch {
      return { available: false, reason: 'Geocoding request failed' };
    }
  }

  async autocompletePlaces(
    input: string,
    sessionToken?: string
  ): Promise<{ available: boolean; suggestions: PlaceSuggestion[]; reason?: string }> {
    const apiKey = getServerMapsApiKey();
    if (!apiKey) {
      return { available: false, suggestions: [], reason: 'Places API not configured' };
    }
    if (!input || input.trim().length < 2) {
      return { available: true, suggestions: [] };
    }

    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify({
          input: input.trim(),
          sessionToken: sessionToken || undefined,
          includedRegionCodes: ['in'],
          locationBias: {
            circle: {
              center: { latitude: 19.2813, longitude: 72.8743 },
              radius: 15000,
            },
          },
        }),
      });
      if (!res.ok) {
        return { available: false, suggestions: [], reason: `Places API HTTP ${res.status}` };
      }
      const data = (await res.json()) as {
        suggestions?: Array<{
          placePrediction?: {
            placeId: string;
            text?: { text: string };
            structuredFormat?: {
              mainText?: { text: string };
              secondaryText?: { text: string };
            };
          };
        }>;
      };
      const suggestions: PlaceSuggestion[] = (data.suggestions || [])
        .filter((s) => Boolean(s.placePrediction))
        .map((s) => {
          const p = s.placePrediction!;
          return {
            placeId: p.placeId,
            description: p.text?.text || '',
            primaryText: p.structuredFormat?.mainText?.text || p.text?.text || '',
            secondaryText: p.structuredFormat?.secondaryText?.text,
          };
        });
      return { available: true, suggestions };
    } catch {
      return { available: false, suggestions: [], reason: 'Places autocomplete request failed' };
    }
  }

  async getPlaceDetails(placeId: string, sessionToken?: string): Promise<GeocodeResult> {
    const apiKey = getServerMapsApiKey();
    if (!apiKey) {
      return { available: false, reason: 'Places API not configured' };
    }
    try {
      const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${qs}`,
        {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
          },
        }
      );
      if (!res.ok) {
        return { available: false, reason: `Place details HTTP ${res.status}` };
      }
      const data = (await res.json()) as {
        formattedAddress?: string;
        location?: { latitude: number; longitude: number };
        addressComponents?: Array<{ longText: string; types: string[] }>;
      };
      const postal = data.addressComponents?.find((c) => c.types.includes('postal_code'))?.longText;
      return {
        available: Boolean(data.location),
        latitude: data.location?.latitude,
        longitude: data.location?.longitude,
        formattedAddress: data.formattedAddress,
        postalCode: postal,
      };
    } catch {
      return { available: false, reason: 'Place details request failed' };
    }
  }

  getGoogleMapsPlaceUrl(storeName: string, lat: number, lng: number, configuredUrl?: string | null): string {
    if (configuredUrl && configuredUrl.startsWith('http')) {
      return configuredUrl;
    }
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${encodeURIComponent(storeName)}`;
  }

  getDirectionsUrl(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
    return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=driving`;
  }
}

export const mapsAdapter = new GoogleMapsIntegrationAdapter();
