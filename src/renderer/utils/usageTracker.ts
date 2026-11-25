export interface UsageEntry {
  timestamp: number;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageSummary {
  hourlyRequests: number;
  hourlyTokens: number;
  fiveHourRequests: number;
  fiveHourTokens: number;
  dailyRequests: number;
  dailyTokens: number;
  weeklyRequests: number;
  weeklyTokens: number;
  totalRequests: number;
  totalTokens: number;
}

export interface UsageLimits {
  hourlyRequestLimit: number;
  hourlyTokenLimit: number;
  fiveHourRequestLimit: number;
  fiveHourTokenLimit: number;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  weeklyRequestLimit: number;
  weeklyTokenLimit: number;
  pauseOnLimit: boolean;
}

const DEFAULT_LIMITS: UsageLimits = {
  hourlyRequestLimit: 60,
  hourlyTokenLimit: 250000,
  fiveHourRequestLimit: 250,
  fiveHourTokenLimit: 1000000,
  dailyRequestLimit: 1500,
  dailyTokenLimit: 2500000,
  weeklyRequestLimit: 7500,
  weeklyTokenLimit: 5000000,
  pauseOnLimit: false,
};

const STORAGE_KEY = "oro_usage_history";
const LIMITS_KEY = "oro_usage_limits";
const CALIBRATION_KEY = "oro_quota_calibration";

export interface QuotaCalibration {
  geminiWeeklyRemainingPct: number;
  geminiFiveHourRemainingPct: number;
  geminiWeeklyRefreshMs: number;
  geminiFiveHourRefreshMs: number;
  claudeWeeklyRemainingPct: number;
  claudeFiveHourRemainingPct: number;
  lastCalibratedAt: number;
}

const DEFAULT_CALIBRATION: QuotaCalibration = {
  geminiWeeklyRemainingPct: 47,
  geminiFiveHourRemainingPct: 93,
  geminiWeeklyRefreshMs: (5 * 24 + 4) * 60 * 60 * 1000, // 5 days, 4 hours
  geminiFiveHourRefreshMs: (4 * 60 + 23) * 60 * 1000,    // 4 hours, 23 mins
  claudeWeeklyRemainingPct: 100,
  claudeFiveHourRemainingPct: 100,
  lastCalibratedAt: Date.now(),
};

export function getQuotaCalibration(): QuotaCalibration {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    if (!raw) return DEFAULT_CALIBRATION;
    return { ...DEFAULT_CALIBRATION, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CALIBRATION;
  }
}

export function saveQuotaCalibration(patch: Partial<QuotaCalibration>): QuotaCalibration {
  try {
    const current = getQuotaCalibration();
    const next = { ...current, ...patch, lastCalibratedAt: Date.now() };
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(next));
    return next;
  } catch {
    return DEFAULT_CALIBRATION;
  }
}

export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "ready to refresh";
  const totalMinutes = Math.floor(ms / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days} day${days > 1 ? "s" : ""}, ${hours} hour${hours > 1 ? "s" : ""}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? "s" : ""}, ${minutes} minute${minutes > 1 ? "s" : ""}`;
  }
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

export function getStoredUsageEntries(): UsageEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordUsage(
  provider: string,
  model: string,
  promptText: string,
  completionText: string
): void {
  try {
    const promptTokens = Math.max(1, Math.round(promptText.length / 3.8));
    const completionTokens = Math.max(1, Math.round(completionText.length / 3.8));
    const entry: UsageEntry = {
      timestamp: Date.now(),
      provider,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    const existing = getStoredUsageEntries();
    // Keep entries from the last 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const updated = [...existing.filter((e) => e.timestamp > cutoff), entry];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to record usage:", err);
  }
}

export function getUsageSummary(): UsageSummary {
  const entries = getStoredUsageEntries();
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let hourlyRequests = 0;
  let hourlyTokens = 0;
  let fiveHourRequests = 0;
  let fiveHourTokens = 0;
  let dailyRequests = 0;
  let dailyTokens = 0;
  let weeklyRequests = 0;
  let weeklyTokens = 0;
  let totalRequests = 0;
  let totalTokens = 0;

  for (const e of entries) {
    totalRequests += 1;
    totalTokens += e.totalTokens || 0;

    if (e.timestamp >= oneHourAgo) {
      hourlyRequests += 1;
      hourlyTokens += e.totalTokens || 0;
    }
    if (e.timestamp >= fiveHoursAgo) {
      fiveHourRequests += 1;
      fiveHourTokens += e.totalTokens || 0;
    }
    if (e.timestamp >= todayStart) {
      dailyRequests += 1;
      dailyTokens += e.totalTokens || 0;
    }
    if (e.timestamp >= sevenDaysAgo) {
      weeklyRequests += 1;
      weeklyTokens += e.totalTokens || 0;
    }
  }

  return {
    hourlyRequests,
    hourlyTokens,
    fiveHourRequests,
    fiveHourTokens,
    dailyRequests,
    dailyTokens,
    weeklyRequests,
    weeklyTokens,
    totalRequests,
    totalTokens,
  };
}

export function getUsageLimits(): UsageLimits {
  try {
    const raw = localStorage.getItem(LIMITS_KEY);
    if (!raw) return DEFAULT_LIMITS;
    return { ...DEFAULT_LIMITS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_LIMITS;
  }
}

export function saveUsageLimits(patch: Partial<UsageLimits>): UsageLimits {
  try {
    const current = getUsageLimits();
    const next = { ...current, ...patch };
    localStorage.setItem(LIMITS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return DEFAULT_LIMITS;
  }
}

export function resetUsageStats(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function formatTokenNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return num.toLocaleString();
}
