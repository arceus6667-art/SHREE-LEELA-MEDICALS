import React, { useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider, AdvancedMarker, Map, Pin, useMap } from '@vis.gl/react-google-maps';
import { AlertTriangle, Clock, ExternalLink, MapPin, Navigation } from 'lucide-react';
import { formatIndianDateTime } from '../shared/types.ts';

export interface ExtraDriverPin {
  id: string;
  label: string;
  lat: number;
  lng: number;
  connectivity: string;
  isSuspicious?: boolean;
}

interface LiveRouteMapProps {
  storeLat: number;
  storeLng: number;
  storeName: string;
  driverLat?: number | null;
  driverLng?: number | null;
  driverLabel?: string;
  destLat?: number | null;
  destLng?: number | null;
  destLabel?: string;
  distanceKm?: number | null;
  etaMinutes?: number | null;
  etaUnavailableReason?: string | null;
  encodedPolyline?: string | null;
  lastLocationAt?: string | null;
  isLocationStale?: boolean;
  locationRevoked?: boolean;
  directionsUrl?: string | null;
  googleMapsUrl?: string;
  extraDrivers?: ExtraDriverPin[];
}

function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const path: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    path.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return path;
}

interface GoogleMapsWindow {
  google?: {
    maps?: {
      Polyline: new (opts: {
        path: Array<{ lat: number; lng: number }>;
        geodesic: boolean;
        strokeColor: string;
        strokeOpacity: number;
        strokeWeight: number;
        map: unknown;
      }) => { setMap: (map: unknown) => void };
    };
  };
}

function GoogleRoutePolylineOverlay({ path }: { path: Array<{ lat: number; lng: number }> }) {
  const map = useMap();
  useEffect(() => {
    const gMaps = typeof window !== 'undefined' ? (window as unknown as GoogleMapsWindow).google?.maps : undefined;
    if (!map || path.length < 2 || !gMaps) {
      return;
    }
    const poly = new gMaps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#16835D',
      strokeOpacity: 0.9,
      strokeWeight: 4,
      map,
    });
    return () => {
      poly.setMap(null);
    };
  }, [map, path]);
  return null;
}

export function LiveRouteMap({
  storeLat,
  storeLng,
  storeName,
  driverLat,
  driverLng,
  driverLabel = 'Partner',
  destLat,
  destLng,
  destLabel = 'Customer Address',
  distanceKm,
  etaMinutes,
  etaUnavailableReason,
  encodedPolyline,
  lastLocationAt,
  isLocationStale,
  locationRevoked,
  directionsUrl,
  googleMapsUrl,
  extraDrivers,
}: LiveRouteMapProps) {
  const mapsApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  const hasGoogleMapsJs = mapsApiKey.length > 10;

  // Smooth interpolation ONLY between genuine received GPS coordinates (never extrapolates fake movement)
  const [smoothDriver, setSmoothDriver] = useState<{ lat: number; lng: number } | null>(
    driverLat != null && driverLng != null && !locationRevoked ? { lat: driverLat, lng: driverLng } : null
  );
  const prevTargetRef = useRef<{ lat: number; lng: number } | null>(smoothDriver);

  useEffect(() => {
    if (locationRevoked || driverLat == null || driverLng == null) {
      setSmoothDriver(null);
      prevTargetRef.current = null;
      return;
    }
    const from = prevTargetRef.current || { lat: driverLat, lng: driverLng };
    const to = { lat: driverLat, lng: driverLng };
    prevTargetRef.current = to;

    if (from.lat === to.lat && from.lng === to.lng) {
      setSmoothDriver(to);
      return;
    }

    const start = performance.now();
    const duration = 750;
    let rafId = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setSmoothDriver({
        lat: from.lat + (to.lat - from.lat) * eased,
        lng: from.lng + (to.lng - from.lng) * eased,
      });
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [driverLat, driverLng, locationRevoked]);

  const decodedPath = useMemo(
    () => (encodedPolyline ? decodePolyline(encodedPolyline) : []),
    [encodedPolyline]
  );

  const activeDriverCoord = !locationRevoked && !isLocationStale ? smoothDriver : smoothDriver;

  const points = [
    { lat: storeLat, lng: storeLng },
    ...(activeDriverCoord ? [activeDriverCoord] : []),
    ...(destLat != null && destLng != null ? [{ lat: destLat, lng: destLng }] : []),
    ...(extraDrivers?.map((d) => ({ lat: d.lat, lng: d.lng })) || []),
  ];

  const minLat = Math.min(...points.map((p) => p.lat)) - 0.004;
  const maxLat = Math.max(...points.map((p) => p.lat)) + 0.004;
  const minLng = Math.min(...points.map((p) => p.lng)) - 0.004;
  const maxLng = Math.max(...points.map((p) => p.lng)) + 0.004;

  const project = (lat: number, lng: number) => {
    const x = ((lng - minLng) / Math.max(0.0001, maxLng - minLng)) * 460 + 40;
    const y = (1 - (lat - minLat) / Math.max(0.0001, maxLat - minLat)) * 200 + 30;
    return { x, y };
  };

  const storePt = project(storeLat, storeLng);
  const driverPt = activeDriverCoord ? project(activeDriverCoord.lat, activeDriverCoord.lng) : null;
  const destPt = destLat != null && destLng != null ? project(destLat, destLng) : null;

  return (
    <div className="rounded-lg border border-[#E1E5EB] bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E1E5EB] px-4 py-3 bg-[#F5F7FA]">
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#202630]">
          <MapPin className="h-4 w-4 text-[#D71920]" />
          <span>Mira Road East Live Tracking</span>
          {distanceKm != null && (
            <>
              <span aria-hidden="true" className="text-[#CBD2D9]">·</span>
              <span className="tabular-nums text-[#526071]">{distanceKm} km distance</span>
            </>
          )}
          <span aria-hidden="true" className="text-[#CBD2D9]">·</span>
          {etaMinutes != null ? (
            <span className="tabular-nums font-semibold text-[#16835D] inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              ETA {etaMinutes} mins
            </span>
          ) : (
            <span className="text-[#526071] inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {etaUnavailableReason ? 'ETA unavailable' : 'ETA pending'}
            </span>
          )}
        </div>
        {(directionsUrl || googleMapsUrl) && !locationRevoked && (
          <a
            href={directionsUrl || googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D71920] hover:text-[#B5121B]"
          >
            <Navigation className="h-3.5 w-3.5" />
            Open in Google Maps
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {isLocationStale && !locationRevoked && (
        <div className="flex items-center justify-between gap-2 border-b border-[#FDE68A] bg-[#FFFBEB] px-4 py-2 text-xs text-[#92400E]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[#D97706]" />
            <span>
              {lastLocationAt
                ? `Location temporarily unavailable — showing last known position from ${formatIndianDateTime(lastLocationAt)}.`
                : 'Waiting for delivery partner GPS transmission.'}
            </span>
          </div>
        </div>
      )}

      {locationRevoked && (
        <div className="flex items-center gap-2 border-b border-[#E1E5EB] bg-[#F5F7FA] px-4 py-2 text-xs text-[#526071]">
          <span>Live driver GPS coordinates cleared upon order completion for partner privacy.</span>
        </div>
      )}

      <div className="relative bg-[#F8FAFC] p-4">
        {hasGoogleMapsJs ? (
          <div className="h-64 w-full rounded-md border border-[#E1E5EB] overflow-hidden">
            <APIProvider apiKey={mapsApiKey}>
              <Map
                defaultCenter={{ lat: storeLat, lng: storeLng }}
                defaultZoom={14}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                disableDefaultUI={false}
              >
                <AdvancedMarker position={{ lat: storeLat, lng: storeLng }} title={storeName}>
                  <Pin background="#D71920" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                </AdvancedMarker>

                {destLat != null && destLng != null && (
                  <AdvancedMarker position={{ lat: destLat, lng: destLng }} title={destLabel}>
                    <Pin background="#202630" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                  </AdvancedMarker>
                )}

                {activeDriverCoord && (
                  <AdvancedMarker position={activeDriverCoord} title={driverLabel}>
                    <Pin background="#16835D" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                  </AdvancedMarker>
                )}

                {extraDrivers?.map((ed) => (
                  <AdvancedMarker key={ed.id} position={{ lat: ed.lat, lng: ed.lng }} title={ed.label}>
                    <Pin
                      background={ed.isSuspicious ? '#D97706' : '#16835D'}
                      borderColor="#FFFFFF"
                      glyphColor="#FFFFFF"
                    />
                  </AdvancedMarker>
                ))}

                {decodedPath.length > 1 && <GoogleRoutePolylineOverlay path={decodedPath} />}
              </Map>
            </APIProvider>
          </div>
        ) : (
          <svg
            viewBox="0 0 540 260"
            className="w-full h-56 rounded-md border border-[#E1E5EB] bg-white"
            role="img"
            aria-label="Live store to customer delivery coordinate map"
          >
            <defs>
              <pattern id="mapGrid" width="36" height="36" patternUnits="userSpaceOnUse">
                <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#EEF1F5" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="540" height="260" fill="url(#mapGrid)" />
            <path d="M 20 210 Q 220 145 510 55" fill="none" stroke="#E2E8F0" strokeWidth="10" strokeLinecap="round" />
            <path d="M 90 25 L 180 245" fill="none" stroke="#E2E8F0" strokeWidth="6" />

            {destPt && (
              <line
                x1={storePt.x}
                y1={storePt.y}
                x2={destPt.x}
                y2={destPt.y}
                stroke="#CBD5E1"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            )}

            {driverPt && destPt && (
              <line
                x1={driverPt.x}
                y1={driverPt.y}
                x2={destPt.x}
                y2={destPt.y}
                stroke={isLocationStale ? '#D97706' : '#16835D'}
                strokeWidth="3"
              />
            )}

            <g transform={`translate(${storePt.x}, ${storePt.y})`}>
              <circle r="8" fill="#D71920" />
              <circle r="3" fill="#FFFFFF" />
              <text x="12" y="4" fontSize="11" fontWeight="600" fill="#202630">
                {storeName.slice(0, 26)}
              </text>
            </g>

            {destPt && (
              <g transform={`translate(${destPt.x}, ${destPt.y})`}>
                <rect x="-7" y="-7" width="14" height="14" rx="3" fill="#202630" />
                <circle r="3" fill="#FFFFFF" />
                <text x="12" y="4" fontSize="11" fontWeight="600" fill="#202630">
                  {destLabel}
                </text>
              </g>
            )}

            {extraDrivers?.map((ed) => {
              const ep = project(ed.lat, ed.lng);
              return (
                <g key={ed.id} transform={`translate(${ep.x}, ${ep.y})`}>
                  <circle r="9" fill={ed.isSuspicious ? '#D97706' : '#16835D'} fillOpacity="0.18" />
                  <circle r="5" fill={ed.isSuspicious ? '#D97706' : '#16835D'} stroke="#FFFFFF" strokeWidth="1.5" />
                  <text x="10" y="14" fontSize="10" fontWeight="600" fill="#202630">
                    {ed.label.split(' ')[0]}
                  </text>
                </g>
              );
            })}

            {driverPt && (
              <g transform={`translate(${driverPt.x}, ${driverPt.y})`}>
                <circle r="11" fill={isLocationStale ? '#D97706' : '#16835D'} fillOpacity="0.2" />
                <circle r="6" fill={isLocationStale ? '#D97706' : '#16835D'} stroke="#FFFFFF" strokeWidth="2" />
                <text x="12" y="-8" fontSize="11" fontWeight="700" fill={isLocationStale ? '#D97706' : '#16835D'}>
                  {driverLabel}
                </text>
              </g>
            )}
          </svg>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#526071] font-mono tabular-nums">
          <span>
            Store: {storeLat.toFixed(4)}, {storeLng.toFixed(4)}
          </span>
          {activeDriverCoord && !locationRevoked && (
            <span>
              {isLocationStale ? 'Last GPS' : 'Live GPS'}: {activeDriverCoord.lat.toFixed(4)},{' '}
              {activeDriverCoord.lng.toFixed(4)}
            </span>
          )}
          {lastLocationAt && !locationRevoked && (
            <span className="font-sans">Updated: {formatIndianDateTime(lastLocationAt)}</span>
          )}
          {destLat != null && destLng != null && (
            <span>
              Drop: {destLat.toFixed(4)}, {destLng.toFixed(4)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
