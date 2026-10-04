export type SafeLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  capturedAt: string;
  deleteAt: string;
};

function toSafeLocation(position: GeolocationPosition): SafeLocation {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    speed: position.coords.speed,
    capturedAt: new Date(position.timestamp).toISOString(),
    deleteAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function requestPrivateLocation(): Promise<SafeLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("この端末では位置情報を利用できません"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toSafeLocation(position)),
      () => reject(new Error("位置情報を許可するとTAG ONできます")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
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
