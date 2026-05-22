// LinkedIn API client — token refresh + post publishing.
// Uses the modern /rest/posts endpoint (Posts API, versioned).
// Reference: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api

const API_VERSION = "202410";
const REST_BASE = "https://api.linkedin.com/rest";
const OAUTH_BASE = "https://www.linkedin.com/oauth/v2";

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
  token_type: string;
}

export async function refreshAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });

  const res = await fetch(`${OAUTH_BASE}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Refresh token failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForTokens(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
  });

  const res = await fetch(`${OAUTH_BASE}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Code exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function fetchUserUrn(accessToken: string): Promise<string> {
  // OpenID Connect userinfo endpoint returns "sub" = member ID.
  const res = await fetch(`${REST_BASE.replace("/rest", "/v2")}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`userinfo failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { sub: string };
  return `urn:li:person:${data.sub}`;
}

export interface CreatePostInput {
  accessToken: string;
  authorUrn: string;
  commentary: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
}

export async function createPost(input: CreatePostInput): Promise<{ id: string }> {
  const body = {
    author: input.authorUrn,
    commentary: input.commentary,
    visibility: input.visibility ?? "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  const res = await fetch(`${REST_BASE}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`createPost failed: ${res.status} ${await res.text()}`);
  }

  const postId = res.headers.get("x-restli-id") ?? "(unknown)";
  return { id: postId };
}
