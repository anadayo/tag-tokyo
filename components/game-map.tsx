"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, Layers3, LocateFixed, Moon, Sun, Zap } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { AreaChampion, TagSpot, TokyoArea } from "@/lib/types";
import type { SafeLocation } from "@/lib/location";

type GameMapProps = {
  areas: TokyoArea[];
  spots: TagSpot[];
  champions: AreaChampion[];
  selectedAreaId: string;
  selectedSpotId: string | null;
  location: SafeLocation | null;
  tagActive: boolean;
  boostActiveUntil: string | null;
  level: number;
  availableExp: number;
  playerAvatarUrl: string;
  playerDisplayName: string;
  claimedSpotIds: string[];
  locating: boolean;
  onSelectArea: (areaId: string) => void;
  onSelectSpot: (spotId: string, areaId: string) => void;
  onLocate: () => void;
};

type MapMode = "full" | "lite";

const TOKYO_CENTER: [number, number] = [139.805, 35.7497];
const EMPTY_COLLECTION = { type: "FeatureCollection" as const, features: [] };
const ASSET_PREFIX = process.env.NODE_ENV === "production" ? "/tag-tokyo" : "";

function circleFeature(longitude: number, latitude: number, radiusMeters: number, kind: string) {
  const coordinates: [number, number][] = [];
  const latitudeRadius = radiusMeters / 111_320;
  const longitudeRadius = radiusMeters / (111_320 * Math.cos(latitude * Math.PI / 180));
  for (let index = 0; index <= 64; index += 1) {
    const angle = index / 64 * Math.PI * 2;
    coordinates.push([
      longitude + Math.cos(angle) * longitudeRadius,
      latitude + Math.sin(angle) * latitudeRadius,
    ]);
  }
  return {
    type: "Feature" as const,
    properties: { kind },
    geometry: { type: "Polygon" as const, coordinates: [coordinates] },
  };
}

function isNightInTokyo() {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }).format(new Date()));
  return hour < 6 || hour >= 18;
}

function makeAreaMarker(area: TokyoArea, champion: AreaChampion | undefined, selected: boolean) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `game-area-marker${selected ? " is-selected" : ""}`;
  button.setAttribute("aria-label", `${area.name}エリアを選択`);
  const crown = document.createElement("span");
  crown.className = "game-area-crown";
  crown.textContent = "1";
  const copy = document.createElement("span");
  copy.className = "game-area-copy";
  const name = document.createElement("b");
  name.textContent = area.name;
  const leader = document.createElement("small");
  leader.textContent = champion?.displayName ? `${champion.displayName} · ${champion.points.toLocaleString()}pt` : "CHAMPION募集中";
  copy.append(name, leader);
  button.append(crown, copy);
  return button;
}

function makeSpotMarker(spot: TagSpot, state: "ready" | "claimed" | "far", selected: boolean) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `game-spot-marker is-${state}${selected ? " is-selected" : ""}`;
  button.setAttribute("aria-label", `${spot.name}を選択`);
  const core = document.createElement("span");
  core.className = "game-spot-core";
  const beam = document.createElement("i");
  beam.className = "game-spot-beam";
  const label = document.createElement("b");
  label.textContent = spot.name.split(" ")[0];
  button.append(beam, core, label);
  return button;
}

function updatePlayerAvatar(marker: HTMLElement, avatarUrl: string, displayName: string) {
  const avatar = marker.querySelector<HTMLElement>(".game-player-avatar");
  if (!avatar) return;
  avatar.replaceChildren();
  avatar.classList.toggle("has-photo", Boolean(avatarUrl));
  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    avatar.append(image);
    return;
  }
  avatar.textContent = displayName.trim().slice(0, 1).toUpperCase() || "・";
}

function makePlayerMarker(location: SafeLocation, avatarUrl: string, displayName: string) {
  const marker = document.createElement("div");
  marker.className = "game-player-marker";
  marker.setAttribute("aria-label", `${displayName}さんの現在地 精度プラスマイナス${Math.round(location.accuracy)}メートル`);
  const halo = document.createElement("span");
  halo.className = "game-player-halo";
  const avatar = document.createElement("b");
  avatar.className = "game-player-avatar";
  const heading = document.createElement("i");
  heading.className = "game-player-heading";
  heading.style.transform = `translateX(-50%) rotate(${location.heading ?? 0}deg)`;
  marker.append(halo, heading, avatar);
  updatePlayerAvatar(marker, avatarUrl, displayName);
  return marker;
}

export function GameMap({
  areas, spots, champions, selectedAreaId, selectedSpotId, location, tagActive, boostActiveUntil,
  claimedSpotIds, locating, onSelectArea, onSelectSpot, onLocate, level, availableExp, playerAvatarUrl, playerDisplayName,
}: GameMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const playerMarkerRef = useRef<MapLibreMarker | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const followRef = useRef(true);
  const [mapMode, setMapMode] = useState<MapMode>("full");
  const [isFollowing, setIsFollowing] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const night = useMemo(() => isNightInTokyo(), []);
  const target = selectedSpotId ? spots.find((item) => item.id === selectedSpotId) : areas.find((item) => item.id === selectedAreaId);
  const boostEnd = boostActiveUntil ? new Date(boostActiveUntil).getTime() : 0;
  const boostActive = boostEnd > clock;
  const boostMinutes = boostActive ? Math.max(1, Math.ceil((boostEnd - clock) / 60_000)) : 0;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem("tag-tokyo-map-mode");
      const constrained = window.matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
      setMapMode(saved === "lite" || (saved === null && constrained) ? "lite" : "full");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!boostActiveUntil) return;
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [boostActiveUntil]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled || !containerRef.current) return;
      maplibre.setWorkerUrl(`${ASSET_PREFIX}/maplibre-gl-worker.mjs`);
      const map = new maplibre.Map({
        container: containerRef.current,
        // Keep roads and station labels legible outdoors and on dim mobile displays.
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: TOKYO_CENTER,
        zoom: 15.2,
        pitch: 55,
        bearing: -20,
        minZoom: 11,
        maxZoom: 19,
        attributionControl: { compact: true },
        cooperativeGestures: false,
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      const stopFollowing = () => {
        followRef.current = false;
        setIsFollowing(false);
      };
      map.on("dragstart", stopFollowing);
      map.on("rotatestart", stopFollowing);
      map.on("pitchstart", stopFollowing);
      map.on("load", () => {
        if (!map.getSource("game-ranges")) {
          map.addSource("game-ranges", { type: "geojson", data: EMPTY_COLLECTION });
          map.addLayer({
            id: "game-range-fill",
            type: "fill",
            source: "game-ranges",
            paint: {
              "fill-color": ["match", ["get", "kind"], "accuracy", "#1b9cff", "boost", "#9f5cff", "#19e6da"],
              "fill-opacity": ["match", ["get", "kind"], "accuracy", 0.1, "boost", 0.08, 0.12],
            },
          });
          map.addLayer({
            id: "game-range-line",
            type: "line",
            source: "game-ranges",
            paint: {
              "line-color": ["match", ["get", "kind"], "accuracy", "#41b6ff", "boost", "#b97aff", "#24f1df"],
              "line-width": ["match", ["get", "kind"], "target", 2.5, 1.5],
              "line-opacity": 0.72,
              "line-dasharray": [2, 2],
            },
          });
        }
        setMapReady(true);
      });
      map.on("error", (event) => {
        if (String(event.error?.message ?? "").includes("WebGL")) setMapError("マップ描画に失敗しました。軽量モードをお試しください。");
      });
    }).catch(() => setMapError("マップデータを読み込めませんでした。通信状態を確認してください。"));
    return () => {
      cancelled = true;
      playerMarkerRef.current?.remove();
      markerRefs.current.forEach((marker) => marker.remove());
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [night]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const existing = map.getLayer("game-3d-buildings");
    const baseExtrusions = map.getStyle().layers.filter((layer) => layer.type === "fill-extrusion" && layer.id !== "game-3d-buildings");
    if (mapMode === "lite") {
      if (existing) map.removeLayer("game-3d-buildings");
      if (map.getSource("game-3d-source")) map.removeSource("game-3d-source");
      baseExtrusions.forEach((layer) => map.setLayoutProperty(layer.id, "visibility", "none"));
      map.easeTo({ pitch: 35, duration: 350 });
      return;
    }
    baseExtrusions.forEach((layer) => map.setLayoutProperty(layer.id, "visibility", "visible"));
    if (!map.getSource("game-3d-source")) map.addSource("game-3d-source", { type: "vector", url: "https://tiles.openfreemap.org/planet" });
    if (!map.getLayer("game-3d-buildings")) {
      const labelLayer = map.getStyle().layers.find((layer) => layer.type === "symbol" && Boolean(layer.layout?.["text-field"]))?.id;
      map.addLayer({
        id: "game-3d-buildings",
        source: "game-3d-source",
        "source-layer": "building",
        type: "fill-extrusion",
        minzoom: 15,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": night ? "#aeb9cb" : "#dce6ef",
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 15, 0, 16, ["coalesce", ["get", "render_height"], 8]],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": night ? 0.68 : 0.82,
        },
      }, labelLayer);
    }
    map.easeTo({ pitch: 55, duration: 350 });
  }, [mapMode, mapReady, night]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let disposed = false;
    void import("maplibre-gl").then(({ Marker }) => {
      if (disposed) return;
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      areas.forEach((area) => {
        const element = makeAreaMarker(area, champions.find((item) => item.areaId === area.id), selectedAreaId === area.id && selectedSpotId === null);
        element.addEventListener("click", () => onSelectArea(area.id));
        markerRefs.current.push(new Marker({ element, anchor: "bottom", offset: [0, 46] }).setLngLat([area.longitude, area.latitude]).addTo(map));
      });
      spots.forEach((spot) => {
        const near = location ? (() => {
          const lat = (spot.latitude - location.latitude) * 111_320;
          const lng = (spot.longitude - location.longitude) * 111_320 * Math.cos(location.latitude * Math.PI / 180);
          return Math.hypot(lat, lng) <= spot.radiusMeters;
        })() : false;
        const state = claimedSpotIds.includes(spot.id) ? "claimed" : near ? "ready" : "far";
        const element = makeSpotMarker(spot, state, selectedSpotId === spot.id);
        element.addEventListener("click", () => onSelectSpot(spot.id, spot.areaId));
        markerRefs.current.push(new Marker({ element, anchor: "bottom" }).setLngLat([spot.longitude, spot.latitude]).addTo(map));
      });
    });
    return () => { disposed = true; };
  }, [areas, champions, claimedSpotIds, location, mapReady, onSelectArea, onSelectSpot, selectedAreaId, selectedSpotId, spots]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("game-ranges") as GeoJSONSource | undefined;
    if (source) {
      const features = [];
      if (target) features.push(circleFeature(target.longitude, target.latitude, target.radiusMeters, "target"));
      if (location) {
        features.push(circleFeature(location.longitude, location.latitude, Math.max(5, location.accuracy), "accuracy"));
        if (tagActive) features.push(circleFeature(location.longitude, location.latitude, boostActive ? 1500 : 1000, "boost"));
      }
      void source.setData({ type: "FeatureCollection", features });
    }
  }, [boostActive, location, mapReady, tagActive, target]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !target) return;
    map.easeTo({
      center: [target.longitude, target.latitude],
      zoom: selectedSpotId ? 16.4 : Math.max(15.2, map.getZoom()),
      duration: mapMode === "lite" ? 0 : 650,
    });
  }, [mapMode, mapReady, selectedSpotId, target]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !location) return;
    let disposed = false;
    void import("maplibre-gl").then(({ Marker }) => {
      if (disposed) return;
      if (!playerMarkerRef.current) {
        playerMarkerRef.current = new Marker({ element: makePlayerMarker(location, playerAvatarUrl, playerDisplayName), anchor: "center" })
          .setLngLat([location.longitude, location.latitude])
          .addTo(map);
      } else {
        playerMarkerRef.current.setLngLat([location.longitude, location.latitude]);
        updatePlayerAvatar(playerMarkerRef.current.getElement(), playerAvatarUrl, playerDisplayName);
        const heading = playerMarkerRef.current.getElement().querySelector<HTMLElement>(".game-player-heading");
        if (heading) heading.style.transform = `translateX(-50%) rotate(${location.heading ?? 0}deg)`;
        playerMarkerRef.current.getElement().setAttribute("aria-label", `${playerDisplayName}さんの現在地 精度プラスマイナス${Math.round(location.accuracy)}メートル`);
      }
      if (followRef.current) map.easeTo({ center: [location.longitude, location.latitude], duration: mapMode === "lite" ? 0 : 700 });
    });
    return () => { disposed = true; };
  }, [location, mapMode, mapReady, playerAvatarUrl, playerDisplayName]);

  function recenter() {
    followRef.current = true;
    setIsFollowing(true);
    if (location && mapRef.current) {
      mapRef.current.easeTo({ center: [location.longitude, location.latitude], zoom: Math.max(15.5, mapRef.current.getZoom()), duration: mapMode === "lite" ? 0 : 600 });
    }
    onLocate();
  }

  function togglePerspective() {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: map.getPitch() > 20 ? 0 : mapMode === "lite" ? 35 : 55, duration: 400 });
  }

  function resetCompass() {
    mapRef.current?.easeTo({ bearing: 0, duration: 350 });
  }

  function toggleMode() {
    const next = mapMode === "full" ? "lite" : "full";
    setMapMode(next);
    window.localStorage.setItem("tag-tokyo-map-mode", next);
  }

  return <div className={`game-map-shell is-${mapMode} ${night ? "is-night" : "is-day"}`}>
    <div ref={containerRef} className="game-map-canvas" aria-label="現在地連動3D東京マップ" />
    {mapError && <div className="game-map-error" role="alert">{mapError}</div>}
    <div className="game-map-player-hud"><span><small>PROFILE</small><b>Lv.{level}</b></span><span><small>EXP</small><b>{availableExp.toLocaleString()}</b></span></div>
    <div className="game-map-status" aria-label="マップ状態">
      <span>{night ? <Moon /> : <Sun />}{night ? "NIGHT" : "DAY"}</span>
      <span className={tagActive ? "is-on" : ""}>{tagActive ? "TAG ON" : "TAG OFF"}</span>
      {boostActive && <span className="is-boost"><Zap />BOOST {boostMinutes}分 · 1.5km</span>}
    </div>
    <div className="game-map-tools">
      <button type="button" className={isFollowing ? "is-active" : ""} disabled={locating} onClick={recenter} aria-label="現在地へ戻る" title="現在地へ戻る"><LocateFixed /></button>
      <button type="button" onClick={togglePerspective} aria-label="視点を切り替える" title="視点切替"><Layers3 /></button>
      <button type="button" onClick={resetCompass} aria-label="コンパスを北へ戻す" title="コンパス"><Compass /></button>
      <button type="button" className={mapMode === "lite" ? "is-active" : ""} onClick={toggleMode} aria-label="軽量モードを切り替える" title="軽量モード">LITE</button>
    </div>
    {!isFollowing && <button type="button" className="game-map-follow" onClick={recenter}><LocateFixed />現在地へ戻る</button>}
    <div className="game-map-attribution-note">人の正確な位置は表示しません</div>
  </div>;
}
