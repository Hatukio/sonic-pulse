import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOpenMeteoForecastUrl,
  formatWeatherSummary,
  weatherCodeText,
} from '../public/src/assistant/weather-context.mjs';

test('weather helper builds an Open-Meteo current-weather URL from authorized coordinates', () => {
  const url = buildOpenMeteoForecastUrl({ latitude: 30.2741, longitude: 120.1551 });
  const parsed = new URL(url);

  assert.equal(parsed.origin, 'https://api.open-meteo.com');
  assert.equal(parsed.pathname, '/v1/forecast');
  assert.equal(parsed.searchParams.get('latitude'), '30.2741');
  assert.equal(parsed.searchParams.get('longitude'), '120.1551');
  assert.equal(parsed.searchParams.get('timezone'), 'auto');
  assert.match(parsed.searchParams.get('current') || '', /temperature_2m/);
  assert.match(parsed.searchParams.get('current') || '', /weather_code/);
});

test('weather helper formats current weather without persisting raw coordinates', () => {
  assert.equal(weatherCodeText(61), '小雨');
  assert.equal(formatWeatherSummary({
    current: {
      temperature_2m: 18.4,
      weather_code: 61,
      wind_speed_10m: 6.2,
    },
  }), '小雨 18℃，风速 6km/h');
});
