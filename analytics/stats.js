'use strict';
// Estatística básica, sem dependências. Tudo puro e determinístico.

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const quantile = (arr, q) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const median = (a) => quantile(a, 0.5);
const mad = (a) => {
  if (!a.length) return NaN;
  const m = median(a);
  return median(a.map((x) => Math.abs(x - m)));
};
// 1.4826·MAD ≈ desvio padrão se os dados forem ~normais, mas imune a outliers
const robustSd = (a) => 1.4826 * mad(a);
const stdev = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};

const logit = (p) => { const q = clamp(p, 1e-6, 1 - 1e-6); return Math.log(q / (1 - q)); };
const expit = (x) => 1 / (1 + Math.exp(-x));

// erf — Abramowitz & Stegun 7.1.26 (erro absoluto < 1.5e-7)
const erf = (x) => {
  const s = x < 0 ? -1 : 1; const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
};
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

// Inversa da normal — algoritmo de Acklam (erro relativo < 1.2e-9)
const normInv = (p) => {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
};

// pesos com meia-vida: o ÚLTIMO elemento pesa 1, o anterior 0.5^(1/hl)...
const pesosMeiaVida = (n, meiaVida) =>
  Array.from({ length: n }, (_, i) => Math.pow(0.5, (n - 1 - i) / meiaVida));

const mediaPonderada = (v, w) => {
  const sw = sum(w);
  return sw > 0 ? sum(v.map((x, i) => x * w[i])) / sw : NaN;
};
const medianaPonderada = (v, w) => {
  if (!v.length) return NaN;
  const idx = v.map((_, i) => i).sort((i, j) => v[i] - v[j]);
  const tot = sum(w); let acc = 0;
  for (const i of idx) { acc += w[i]; if (acc >= tot / 2) return v[i]; }
  return v[idx[idx.length - 1]];
};

const arred = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

module.exports = {
  sum, mean, clamp, quantile, median, mad, robustSd, stdev, logit, expit,
  erf, normCdf, normInv, pesosMeiaVida, mediaPonderada, medianaPonderada, arred,
};
