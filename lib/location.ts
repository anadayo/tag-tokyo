export type SafeLocation = { latitude: number; longitude: number; deleteAt: string };

export function requestPrivateLocation(): Promise<SafeLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("この端末では位置情報を利用できません"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        deleteAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }),
      () => reject(new Error("位置情報を許可するとTAG ONできます")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
}

export function isInsideTokyo({ latitude, longitude }: SafeLocation) {
  return latitude >= 35.49 && latitude <= 35.90 && longitude >= 138.94 && longitude <= 139.93;
}
