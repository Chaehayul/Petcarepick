const API_BASE_URL = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "http://localhost:8787/api"
  : "/api";

const TOKEN_KEY = "petcarepick:tokens:v1";
let refreshPromise = null;

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY)) || null;
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKEN_KEY);
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message || "요청을 처리하지 못했어요.",
      response.status,
      payload.error?.code || "API_ERROR",
      payload.error?.details,
    );
  }
  return payload;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = readTokens()?.refreshToken;
  if (!refreshToken) throw new ApiError("로그인이 필요해요.", 401, "UNAUTHORIZED");

  refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  })
    .then(parseResponse)
    .then((tokens) => {
      writeTokens(tokens);
      return tokens.accessToken;
    })
    .catch((error) => {
      writeTokens(null);
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

async function request(path, options = {}, retry = true) {
  const tokens = readTokens();
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (tokens?.accessToken) headers.set("Authorization", `Bearer ${tokens.accessToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (response.status === 401 && retry && tokens?.refreshToken) {
    const accessToken = await refreshAccessToken();
    headers.set("Authorization", `Bearer ${accessToken}`);
    return parseResponse(await fetch(`${API_BASE_URL}${path}`, { ...options, headers }));
  }
  return parseResponse(response);
}

function json(method, body) {
  return { method, body: JSON.stringify(body) };
}

export const api = {
  hasSession: () => Boolean(readTokens()?.refreshToken),
  clearSession: () => writeTokens(null),

  async signup(input) {
    const result = await request("/auth/signup", json("POST", input), false);
    writeTokens(result.tokens);
    return result.user;
  },

  async login(input) {
    const result = await request("/auth/login", json("POST", input), false);
    writeTokens(result.tokens);
    return result.user;
  },

  async logout() {
    const refreshToken = readTokens()?.refreshToken;
    try {
      if (refreshToken) await request("/auth/logout", json("POST", { refreshToken }), false);
    } finally {
      writeTokens(null);
    }
  },

  me: () => request("/users/me"),
  updateMe: (input) => request("/users/me", json("PATCH", input)),
  deleteMe: () => request("/users/me", { method: "DELETE" }),

  listPets: () => request("/pets"),
  createPet: (input) => request("/pets", json("POST", input)),
  updatePet: (petId, input) => request(`/pets/${petId}`, json("PATCH", input)),
  deletePet: (petId) => request(`/pets/${petId}`, { method: "DELETE" }),

  listRecords: (petId, from, to) => {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    return request(`/pets/${petId}/records${query.size ? `?${query}` : ""}`);
  },
  saveRecord: (petId, input) => request(`/pets/${petId}/records`, json("POST", input)),
  deleteRecord: (recordId) => request(`/records/${recordId}`, { method: "DELETE" }),

  listEvents: (petId) => request(`/pets/${petId}/events`),
  createEvent: (petId, input) => request(`/pets/${petId}/events`, json("POST", input)),
  updateEvent: (eventId, input) => request(`/events/${eventId}`, json("PATCH", input)),
  deleteEvent: (eventId) => request(`/events/${eventId}`, { method: "DELETE" }),

  listFeedback: (petId) => request(`/pets/${petId}/feedback`),
  saveFeedback: (petId, input) => request(`/pets/${petId}/feedback`, json("POST", input)),
  listChatSessions: () => request("/chat/sessions"),
  chat: (input) => request("/ai/chat", json("POST", input)),
  createHealthReport: (input) => request("/reports/health", json("POST", input)),
  listHealthReports: (petId) => request(`/pets/${petId}/reports`),
  health: () => request("/health"),
  hospitals: (input) => request("/hospitals/nearby", json("POST", input)),
};
