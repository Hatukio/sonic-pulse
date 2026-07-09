const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

const WEATHER_CODES = Object.freeze({
  0: '晴朗',
  1: '大部晴朗',
  2: '局部多云',
  3: '阴天',
  45: '有雾',
  48: '霜雾',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '强阵雪',
  95: '雷暴',
  96: '雷暴伴冰雹',
  99: '强雷暴伴冰雹',
});

export function weatherCodeText(code) {
  return WEATHER_CODES[Number(code)] || '未知天气';
}

export function buildOpenMeteoForecastUrl({ latitude, longitude } = {}) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('定位坐标无效');
  }
  const url = new URL(OPEN_METEO_ENDPOINT);
  url.searchParams.set('latitude', String(Number(lat.toFixed(4))));
  url.searchParams.set('longitude', String(Number(lon.toFixed(4))));
  url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m');
  url.searchParams.set('timezone', 'auto');
  return url.toString();
}

export function formatWeatherSummary(payload = {}) {
  const current = payload.current || {};
  const temperature = Number(current.temperature_2m);
  const wind = Number(current.wind_speed_10m);
  const text = weatherCodeText(current.weather_code);
  const parts = [text];
  if (Number.isFinite(temperature)) parts.push(`${Math.round(temperature)}℃`);
  if (Number.isFinite(wind)) parts.push(`风速 ${Math.round(wind)}km/h`);
  return parts.length > 1 ? `${parts[0]} ${parts.slice(1).join('，')}` : parts[0];
}

export function requestCurrentPosition(navigatorRef, options = {}) {
  const geolocation = navigatorRef?.geolocation;
  if (!geolocation?.getCurrentPosition) {
    return Promise.reject(new Error('当前环境不支持定位，请手动填写天气/环境'));
  }
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 15 * 60 * 1000,
      ...options,
    });
  });
}
