/**
 * k6 Load Test for Artifex API
 *
 * Run: docker run --rm -v "${PWD}:/scripts" grafana/k6 run /scripts/security/load-test.js
 * Or:  k6 run security/load-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.API_URL || 'http://host.docker.internal:3002';

// Custom metrics
const errorRate = new Rate('errors');
const apiDuration = new Trend('api_duration', true);

// Test scenarios
export const options = {
  scenarios: {
    // Smoke test: verify endpoints work
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '10s',
      startTime: '0s',
      tags: { test: 'smoke' },
    },
    // Load test: normal traffic
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 30 },  // ramp up
        { duration: '60s', target: 30 },  // hold
        { duration: '10s', target: 0 },   // ramp down
      ],
      startTime: '15s',
      tags: { test: 'load' },
    },
    // Stress test: find breaking point
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '15s', target: 0 },
      ],
      startTime: '110s',
      tags: { test: 'stress' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% of requests under 2s
    errors: ['rate<0.1'],                // error rate under 10%
  },
};

// Get auth token
let authToken = null;

export function setup() {
  // Try to register, or login
  let res = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({
    username: 'k6test',
    password: 'K6Test123!',
    display_name: 'k6 Load Test',
  }), { headers: { 'Content-Type': 'application/json' } });

  if (res.status === 201) {
    return { token: res.json().token };
  }

  // Already exists, login
  res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    username: 'k6test',
    password: 'K6Test123!',
  }), { headers: { 'Content-Type': 'application/json' } });

  if (res.status === 200) {
    return { token: res.json().token };
  }

  return { token: null };
}

export default function (data) {
  const headers = data.token
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` }
    : { 'Content-Type': 'application/json' };

  // 1. Health check (unauthenticated)
  let res = http.get(`${BASE_URL}/api/health`);
  check(res, { 'health ok': (r) => r.status === 200 });
  apiDuration.add(res.timings.duration);
  errorRate.add(res.status !== 200);

  // 2. Public images (unauthenticated)
  res = http.get(`${BASE_URL}/api/images/public?limit=20`);
  check(res, { 'public images ok': (r) => r.status === 200 });
  apiDuration.add(res.timings.duration);
  errorRate.add(res.status >= 500);

  // 3. Search
  res = http.get(`${BASE_URL}/api/images/search?q=car`, { headers });
  check(res, { 'search ok': (r) => [200, 400, 429].includes(r.status) });
  apiDuration.add(res.timings.duration);
  errorRate.add(res.status >= 500);

  // 4. Tags list
  res = http.get(`${BASE_URL}/api/tags`);
  check(res, { 'tags ok': (r) => r.status === 200 });
  apiDuration.add(res.timings.duration);
  errorRate.add(res.status >= 500);

  // 5. Authenticated: own images
  if (data.token) {
    res = http.get(`${BASE_URL}/api/images/mine?limit=20`, { headers });
    check(res, { 'mine ok': (r) => [200, 429].includes(r.status) });
    apiDuration.add(res.timings.duration);
    errorRate.add(res.status >= 500);

    // 6. Favorites
    res = http.get(`${BASE_URL}/api/images/favorites?limit=20`, { headers });
    check(res, { 'favorites ok': (r) => [200, 429].includes(r.status) });
    apiDuration.add(res.timings.duration);
    errorRate.add(res.status >= 500);
  }

  sleep(0.5 + Math.random());
}

export function handleSummary(data) {
  const summary = {
    'Total requests': data.metrics.http_reqs.values.count,
    'Avg duration (ms)': Math.round(data.metrics.http_req_duration.values.avg),
    'p95 duration (ms)': Math.round(data.metrics.http_req_duration.values['p(95)']),
    'Max duration (ms)': Math.round(data.metrics.http_req_duration.values.max),
    'Error rate (%)': (data.metrics.errors.values.rate * 100).toFixed(2),
    'Requests/sec': Math.round(data.metrics.http_reqs.values.rate),
  };

  console.log('\n=== LOAD TEST SUMMARY ===');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${v}`);
  }

  return {};
}
