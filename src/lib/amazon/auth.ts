import { supabase } from "@/lib/supabase";
import { AMAZON_CONFIG } from "./config";
import type { ApiCredential } from "@/types/database";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Get stored credentials for a given API type
 */
export async function getCredentials(
  credentialType: "sp-api" | "ads-api"
): Promise<ApiCredential | null> {
  const { data, error } = await supabase
    .from("api_credentials")
    .select("*")
    .eq("credential_type", credentialType)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data as ApiCredential;
}

/**
 * Save or update credentials
 */
export async function saveCredentials(
  credentialType: "sp-api" | "ads-api",
  credentials: {
    client_id: string;
    client_secret: string;
    refresh_token: string;
    profile_id?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from("api_credentials").upsert(
    {
      credential_type: credentialType,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      profile_id: credentials.profile_id || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "credential_type" }
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Delete credentials
 */
export async function deleteCredentials(
  credentialType: "sp-api" | "ads-api"
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("api_credentials")
    .delete()
    .eq("credential_type", credentialType);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Refresh LWA access token using refresh_token
 */
export async function refreshAccessToken(
  credentialType: "sp-api" | "ads-api"
): Promise<string> {
  const creds = await getCredentials(credentialType);
  if (!creds) {
    throw new Error(`No credentials found for ${credentialType}`);
  }

  // Check if current token is still valid (with 5 min buffer)
  if (creds.access_token && creds.token_expires_at) {
    const expiresAt = new Date(creds.token_expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    if (expiresAt.getTime() - now.getTime() > bufferMs) {
      return creds.access_token;
    }
  }

  // Request new access token from LWA
  const tokenUrl = AMAZON_CONFIG.LWA_TOKEN_URL;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refresh_token,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errorText}`);
  }

  const tokenData: TokenResponse = await response.json();
  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000
  ).toISOString();

  // Store new access token
  await supabase
    .from("api_credentials")
    .update({
      access_token: tokenData.access_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("credential_type", credentialType);

  return tokenData.access_token;
}

/**
 * Test API connection by attempting token refresh and API call
 */
export async function testConnection(
  credentialType: "sp-api" | "ads-api"
): Promise<{ success: boolean; error?: string; details?: string }> {
  try {
    const accessToken = await refreshAccessToken(credentialType);

    if (credentialType === "ads-api") {
      // For Ads API, also test profile access
      const creds = await getCredentials("ads-api");
      if (!creds) {
        return { success: false, error: "認証情報が見つかりません" };
      }

      // Try to fetch profiles to verify token works with Ads API
      const profileRes = await fetch(`${AMAZON_CONFIG.ADS_API_ENDPOINT}/v2/profiles`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Amazon-Advertising-API-ClientId": creds.client_id,
        },
      });

      if (!profileRes.ok) {
        const errText = await profileRes.text();
        return {
          success: false,
          error: `トークンは有効ですが、Ads APIへのアクセスに失敗しました (${profileRes.status}): ${errText}`,
        };
      }

      const profiles = await profileRes.json();
      const profileCount = Array.isArray(profiles) ? profiles.length : 0;

      if (creds.profile_id) {
        // Verify the stored profile ID exists
        const hasProfile = Array.isArray(profiles) &&
          profiles.some((p: { profileId: number }) => String(p.profileId) === creds.profile_id);
        if (!hasProfile) {
          return {
            success: false,
            error: `Profile ID ${creds.profile_id} が見つかりません。利用可能なプロファイル数: ${profileCount}`,
          };
        }
        return {
          success: true,
          details: `プロファイル確認済 (${profileCount}件中)`,
        };
      }

      return {
        success: true,
        details: `${profileCount}件のプロファイルにアクセス可能。Profile IDを設定してください。`,
      };
    }

    // For SP-API, just token refresh is enough
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
