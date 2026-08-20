import { google } from "googleapis";
import { env } from "@/lib/env";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getSheetsClient() {
  const privateKey = Buffer.from(
    env.GOOGLE_PRIVATE_KEY_B64,
    "base64"
  ).toString("utf-8");

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: SCOPES,
  });

  return google.sheets({ version: "v4", auth });
}

// In-memory TTL cache: Route Handler `revalidate` does not engage for this
// dynamic route, so the 60s freshness/quota bound is enforced here instead.
// Per-instance on serverless (resets on cold start) — worst case is a fresh read.
const COMPANIES_TTL_MS = 60_000;
let companiesCache: { values: string[]; fetchedAt: number } | null = null;

export async function getCompanies(): Promise<string[]> {
  if (companiesCache && Date.now() - companiesCache.fetchedAt < COMPANIES_TTL_MS) {
    return companiesCache.values;
  }
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.SHEET_ID,
    range: "Companies!A2:A",
  });

  const rows = res.data.values ?? [];
  const values = rows
    .map((row) => (row[0] ?? "").toString().trim())
    .filter((name) => name.length > 0);
  companiesCache = { values, fetchedAt: Date.now() };
  return values;
}

function formatJstTimestamp(): string {
  // Readable JST timestamp, e.g. "2026-07-24 16:05:12".
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());
}

// googleapis surfaces HTTP failures with a numeric `code` and/or
// `response.status`. Retry once only for request-send failures or 5xx.
function shouldRetry(error: unknown): boolean {
  const err = error as { code?: unknown; response?: { status?: unknown } };
  const status =
    typeof err?.response?.status === "number"
      ? err.response.status
      : typeof err?.code === "number"
      ? (err.code as number)
      : undefined;

  if (typeof status === "number") {
    return status >= 500;
  }

  // Non-HTTP errors (e.g. ECONNRESET, ETIMEDOUT before a response) indicate a
  // request-send failure — safe-ish to retry once.
  const codeStr = typeof err?.code === "string" ? err.code : "";
  return (
    codeStr === "ECONNRESET" ||
    codeStr === "ETIMEDOUT" ||
    codeStr === "ECONNREFUSED" ||
    codeStr === "EPIPE" ||
    codeStr === "ENOTFOUND"
  );
}

export async function appendSubmission(row: {
  tourDate: string;
  guideName: string;
  phone: string;
  vehicleNumber: string;
  carCompany: string;
}): Promise<void> {
  const sheets = getSheetsClient();
  const submittedAt = formatJstTimestamp();
  const values = [
    [
      submittedAt,
      row.tourDate,
      row.guideName,
      row.phone,
      row.vehicleNumber,
      row.carCompany,
    ],
  ];

  const doAppend = () =>
    sheets.spreadsheets.values.append({
      spreadsheetId: env.SHEET_ID,
      range: "Submissions!A:F",
      valueInputOption: "RAW",
      requestBody: { values },
    });

  try {
    await doAppend();
  } catch (error) {
    if (shouldRetry(error)) {
      await doAppend();
      return;
    }
    throw error;
  }
}
