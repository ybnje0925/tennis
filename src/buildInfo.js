const startedAt = new Date().toISOString();

export function buildInfo(now = new Date()) {
  const buildCommit = firstNonEmpty(
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.RAILWAY_GIT_COMMIT,
    process.env.GIT_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.SOURCE_VERSION,
    "unknown"
  );
  return {
    buildCommit,
    buildBranch: firstNonEmpty(
      process.env.RAILWAY_GIT_BRANCH,
      process.env.GIT_BRANCH,
      process.env.VERCEL_GIT_COMMIT_REF,
      "unknown"
    ),
    startedAt,
    serverTime: now.toISOString(),
    serverTimeKst: formatKst(now)
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "unknown";
}

function formatKst(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date).replace(" ", "T") + "+09:00";
}
