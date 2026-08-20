// Lazy, fail-loud env validation. Env vars are only read when a getter is
// accessed at request time — never at module load / build time — so the
// production build does not require secrets to be present.

const REQUIRED_VARS = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY_B64",
  "SHEET_ID",
  "FORM_PASSCODE",
  "SESSION_SECRET",
] as const;

type RequiredVar = (typeof REQUIRED_VARS)[number];

function read(name: RequiredVar): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get GOOGLE_SERVICE_ACCOUNT_EMAIL() {
    return read("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  },
  get GOOGLE_PRIVATE_KEY_B64() {
    return read("GOOGLE_PRIVATE_KEY_B64");
  },
  get SHEET_ID() {
    return read("SHEET_ID");
  },
  get FORM_PASSCODE() {
    return read("FORM_PASSCODE");
  },
  get SESSION_SECRET() {
    return read("SESSION_SECRET");
  },
};
