export const config = {
  appEnv: window.__PETCAREPICK_ENV__?.APP_ENV ?? "local",
  apiMode: window.__PETCAREPICK_ENV__?.APP_API_MODE ?? "mock",
  supabaseUrl: window.__PETCAREPICK_ENV__?.SUPABASE_URL ?? "",
  supabaseAnonKey: window.__PETCAREPICK_ENV__?.SUPABASE_ANON_KEY ?? "",
  kakaoMapJsKey: window.__PETCAREPICK_ENV__?.KAKAO_MAP_JS_KEY ?? "",
};
