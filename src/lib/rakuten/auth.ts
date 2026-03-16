/**
 * 楽天 RMS API — ESA 認証
 */

export function getEsaAuthHeader(creds: {
  serviceSecret: string;
  licenseKey: string;
}): string {
  const encoded = Buffer.from(
    `${creds.serviceSecret}:${creds.licenseKey}`
  ).toString("base64");
  return `ESA ${encoded}`;
}

export const RMS_API_BASE = "https://api.rms.rakuten.co.jp";
