export type SafeLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  capturedAt: string;
  deleteAt: string;
};

function toSafeLocation(position: GeolocationPosition): SafeLocation {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    speed: position.coords.speed,
    heading: position.coords.heading,
    capturedAt: new Date(position.timestamp).toISOString(),
    deleteAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function requestPrivateLocation(options: { fresh?: boolean } = {}): Promise<SafeLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("この端末では位置情報を利用できません"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toSafeLocation(position)),
      () => reject(new Error("位置情報を取得できません。端末とブラウザの位置情報を許可して再試行してください")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: options.fresh ? 0 : 15000 },
    );
  });
}

export function watchPrivateLocation(
  onLocation: (location: SafeLocation) => void,
  onError: (message: string) => void,
) {
  if (!navigator.geolocation) {
    onError("この端末では位置情報を利用できません");
    return () => undefined;
  }
  const watchId = navigator.geolocation.watchPosition(
    (position) => onLocation(toSafeLocation(position)),
    () => onError("位置情報を取得できません。端末の位置情報設定を確認してください"),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 },
  );
  return () => navigator.geolocation.clearWatch(watchId);
}

export function isInsideTokyo({ latitude, longitude }: SafeLocation) {
  return latitude >= 35.49 && latitude <= 35.90 && longitude >= 138.94 && longitude <= 139.93;
}

export function distanceMeters(a: Pick<SafeLocation, "latitude" | "longitude">, b: { latitude: number; longitude: number }) {
  const earthRadius = 6371000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const latDelta = toRadians(b.latitude - a.latitude);
  const lonDelta = toRadians(b.longitude - a.longitude);
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return earthRadius * 2 * Math.asin(Math.sqrt(value));
}
