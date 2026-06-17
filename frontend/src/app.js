import { api, ApiError } from "./apiClient.js";

const STORE_KEY = "petcarepick:app:v2";
const SESSION_KEY = "petcarepick:session:v1";
const app = document.querySelector("#app");
const urlParams = new URLSearchParams(location.search);
const requestedSurface = urlParams.get("surface");
const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const surface = requestedSurface === "app" || requestedSurface === "web"
  ? requestedSurface
  : isInstalledApp ? "app" : "web";
let onboardingTimer = 0;

const tabs = [
  ["home", "홈", "home"],
  ["record", "기록", "edit"],
  ["recommend", "추천", "sparkles"],
  ["calendar", "캘린더", "calendar"],
  ["my", "마이", "user"],
];

const recordCategories = [
  ["meal", "식사", "급여량과 식욕을 기록해요"],
  ["activity", "활동", "산책과 놀이 시간을 기록해요"],
  ["stool", "배변", "횟수와 상태를 기록해요"],
  ["behavior", "행동", "특이 행동과 컨디션을 남겨요"],
  ["weight", "체중", "현재 체중을 기록해요"],
];

const catalog = [
  { id: "food-sensitive", type: "food", icon: "🥣", name: "센서티브 밸런스", ingredients: ["연어", "쌀", "프로바이오틱스"], excludes: ["닭고기"], conditions: ["피부염"], stages: ["adult", "senior"] },
  { id: "food-light", type: "food", icon: "🥕", name: "라이트 웨이트 케어", ingredients: ["흰살생선", "고구마", "L-카르니틴"], excludes: ["소고기"], conditions: ["비만"], stages: ["adult", "senior"] },
  { id: "food-growth", type: "food", icon: "🥩", name: "그로우 퍼피 밸런스", ingredients: ["양고기", "현미", "DHA"], excludes: [], conditions: [], stages: ["growth"] },
  { id: "supp-heart", type: "supplement", icon: "🫀", name: "타우린 하트 케어", ingredients: ["타우린", "코엔자임Q10"], excludes: [], conditions: ["심장 질환"], stages: ["adult", "senior"] },
  { id: "supp-skin", type: "supplement", icon: "💧", name: "오메가 피부 케어", ingredients: ["오메가3", "비오틴"], excludes: [], conditions: ["피부염"], stages: ["growth", "adult", "senior"] },
  { id: "supp-joint", type: "supplement", icon: "🦴", name: "조인트 모빌리티", ingredients: ["글루코사민", "MSM"], excludes: [], conditions: ["관절염"], stages: ["adult", "senior"] },
  { id: "snack-low", type: "snack", icon: "🍠", name: "고구마 저자극 바이트", ingredients: ["고구마", "완두"], excludes: ["닭고기", "유제품"], conditions: [], stages: ["growth", "adult", "senior"] },
];

const state = {
  data: loadData(),
  route: "intro",
  tab: "home",
  selectedPetId: "",
  editingPetId: "",
  recordDate: localDate(),
  recommendationMode: "food",
  hospitalStatus: "idle",
  hospitalError: "",
  nearbyHospitals: [],
  userLocation: null,
  hospitalProvider: "",
  showEventForm: false,
  editingEventId: "",
  calendarMonth: localDate().slice(0, 7),
  aiStatus: "unknown",
  aiError: "",
  chatSending: false,
  chatSessionId: "",
  bootstrapping: true,
  busy: false,
  globalError: "",
  reportStatus: "idle",
  reportData: null,
  reportError: "",
  onboardingStep: 0,
  authMode: "login",
  pendingUser: null,
  verificationCode: "",
  petFormStep: 0,
  petDraft: {
    type: "강아지",
    name: "",
    breed: "",
    age: "",
    weight: "",
    gender: "남아",
    neutered: "했어요",
    conditions: [],
    allergies: [],
    routines: [],
    reminders: { morning: true, evening: true, anomaly: true },
  },
  toast: "",
};

document.documentElement.dataset.surface = surface;
document.body.classList.add(`surface-${surface}`);
clearOldCaches();
initializeRoute();
render();
bootstrapApp();

window.addEventListener("popstate", (event) => {
  const next = event.state;
  if (next?.route) {
    state.route = next.route;
    state.tab = next.tab || state.tab;
    render();
  }
});

function emptyData() {
  return {
    user: null,
    pets: [],
    records: [],
    events: [],
    feedback: [],
    chats: [{ from: "ai", text: "안녕하세요. 반려동물 프로필과 기록을 바탕으로 건강 관리를 도와드릴게요." }],
  };
}

function loadData() {
  if (localStorage.getItem(SESSION_KEY) !== "demo") return emptyData();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return saved && typeof saved === "object" ? { ...emptyData(), ...saved } : emptyData();
  } catch {
    return emptyData();
  }
}

function saveData() {
  if (state.data.user?.demo) localStorage.setItem(STORE_KEY, JSON.stringify(state.data));
}

function setSession(value) {
  localStorage.setItem(SESSION_KEY, value);
}

function isLoggedOut() {
  return !api.hasSession() && localStorage.getItem(SESSION_KEY) !== "demo";
}

function entryRoute() {
  if (!state.data.user || isLoggedOut()) return "signup";
  return state.data.pets.length ? "app" : "pet-intro";
}

function clearOldCaches() {
  navigator.serviceWorker?.getRegistrations?.().then((items) => items.forEach((item) => item.unregister()));
  window.caches?.keys?.().then((keys) => keys.forEach((key) => window.caches.delete(key)));
}

function initializeRoute() {
  if (urlParams.get("onboarding") === "1") state.route = "intro";
  else if (api.hasSession()) state.route = "splash";
  else if (!state.data.user) state.route = "splash";
  else if (isLoggedOut()) state.route = "signup";
  else if (!state.data.pets.length) state.route = "pet-intro";
  else state.route = "app";
  history.replaceState({ route: state.route, tab: state.tab }, "", location.href);
}

async function bootstrapApp() {
  if (state.data.user?.demo) {
    state.bootstrapping = false;
    state.route = state.data.pets.length ? "app" : "pet-intro";
    render();
    return;
  }
  if (!api.hasSession()) {
    state.bootstrapping = false;
    state.route = "intro";
    render();
    return;
  }

  try {
    await hydrateServerData();
    state.route = state.data.pets.length ? "app" : "pet-intro";
  } catch (error) {
    api.clearSession();
    state.data = emptyData();
    state.globalError = friendlyError(error, "로그인 정보를 다시 확인해주세요.");
    state.route = "signup";
  } finally {
    state.bootstrapping = false;
    history.replaceState({ route: state.route, tab: state.tab }, "", location.href);
    render();
  }
}

async function hydrateServerData() {
  const [{ user }, { pets }] = await Promise.all([api.me(), api.listPets()]);
  const petData = await Promise.all(pets.map(async (pet) => {
    const [{ records }, { events }, { feedback }] = await Promise.all([
      api.listRecords(pet.id),
      api.listEvents(pet.id),
      api.listFeedback(pet.id),
    ]);
    return { pet, records, events, feedback };
  }));
  const sessions = await api.listChatSessions().catch(() => ({ sessions: [] }));
  const messages = sessions.sessions?.[0]?.messages || [];
  state.data = {
    ...emptyData(),
    user,
    pets,
    records: petData.flatMap((item) => item.records),
    events: petData.flatMap((item) => item.events),
    feedback: petData.flatMap((item) => item.feedback),
    chats: messages.length
      ? messages.map((message) => ({ from: message.role === "assistant" ? "ai" : "user", text: message.content }))
      : emptyData().chats,
  };
  state.chatSessionId = sessions.sessions?.[0]?.id || "";
  state.selectedPetId = pets.some((pet) => pet.id === state.selectedPetId) ? state.selectedPetId : pets[0]?.id || "";
}

function isDemoMode() {
  return state.data.user?.demo === true;
}

function friendlyError(error, fallback = "요청을 처리하지 못했어요.") {
  if (error instanceof ApiError) return error.message;
  return error?.message || fallback;
}

async function runBusy(task, successMessage = "") {
  if (state.busy) return null;
  state.busy = true;
  state.globalError = "";
  render();
  try {
    const result = await task();
    if (successMessage) showToast(successMessage);
    return result;
  } catch (error) {
    state.globalError = friendlyError(error);
    render();
    return null;
  } finally {
    state.busy = false;
    render();
  }
}

function navigate(route, options = {}) {
  state.route = route;
  const method = options.replace ? "replaceState" : "pushState";
  history[method]({ route, tab: state.tab }, "", location.href);
  render();
  if (route === "report") loadHealthReport();
}

function goBack(fallback = "app") {
  if (history.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

function setTab(tab) {
  state.tab = tab;
  state.route = "app";
  history.pushState({ route: "app", tab }, "", location.href);
  render();
}

function currentPet() {
  if (!state.selectedPetId && state.data.pets[0]) state.selectedPetId = state.data.pets[0].id;
  return state.data.pets.find((pet) => pet.id === state.selectedPetId) || state.data.pets[0] || null;
}

function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

function showToast(message) {
  state.toast = message;
  render();
  window.setTimeout(() => {
    state.toast = "";
    render();
  }, 1800);
}

function icon(name) {
  const paths = {
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    sparkles: '<path d="m12 3-1.3 3.7L7 8l3.7 1.3L12 13l1.3-3.7L17 8l-3.7-1.3Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8Z"/><path d="m19 13-.8 2.2L16 16l2.2.8L19 19l.8-2.2L22 16l-2.2-.8Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
    message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    location: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    paw: '<circle cx="5.5" cy="9.5" r="2.2"/><circle cx="10" cy="6" r="2.2"/><circle cx="14" cy="6" r="2.2"/><circle cx="18.5" cy="9.5" r="2.2"/><path d="M7.5 18.5c1-4 3-6 4.5-6s3.5 2 4.5 6c.4 1.7-.7 3-2.3 2.3-1.4-.6-3-.6-4.4 0-1.6.7-2.7-.6-2.3-2.3Z"/>',
    dog: '<path d="M5 10V7.5C5 5.6 6.6 4 8.5 4h7C17.4 4 19 5.6 19 7.5V10"/><path d="M7 10c-2 0-3 1.5-3 3.2V18c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.8c0-1.7-1-3.2-3-3.2"/><path d="M8 4 6 8M16 4l2 4"/><path d="M9 14h.01M15 14h.01"/><path d="M10 17c1 .7 3 .7 4 0"/>',
    cat: '<path d="M5 11 4 4l5 3h6l5-3-1 7"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M9 13h.01M15 13h.01"/><path d="M12 15v2"/><path d="M8 17h8"/><path d="M3 14h4M17 14h4"/>',
    bird: '<path d="M7 19c6 0 10-4 10-10V7l3-2-4-.5C14.5 2.5 12 2 10 3.5 7.5 5.4 7 8.6 9 11"/><path d="M9 11 4 16l5 1"/><path d="M13 7h.01"/>',
    rabbit: '<path d="M8 13c-2-4-2-9 0-10 2-1 3 3 3 7"/><path d="M16 13c2-4 2-9 0-10-2-1-3 3-3 7"/><path d="M6 15a6 6 0 0 0 12 0c0-3-2.7-5-6-5s-6 2-6 5Z"/><path d="M10 15h.01M14 15h.01"/><path d="M12 17v2"/>',
    hamster: '<circle cx="12" cy="13" r="6"/><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M10 13h.01M14 13h.01"/><path d="M11 16h2"/>',
    meal: '<path d="M4 3v8"/><path d="M8 3v8"/><path d="M4 7h4"/><path d="M6 11v10"/><path d="M15 3c3 2 4 5 3 9-.5 2-2 3-4 3v6"/>',
    activity: '<path d="M13 4a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z"/><path d="m8 22 2-7-3-2 2-5 4 2 3-2"/><path d="m15 22-3-6 2-4"/><path d="m17 13 3 2"/>',
    stool: '<path d="M7 6h10"/><path d="M8 6l1 14h6l1-14"/><path d="M10 10h4"/><path d="M10.5 14h3"/>',
    behavior: '<circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01"/><path d="M8.5 14.5c2 2 5 2 7 0"/>',
    weight: '<path d="M6 7h12l2 14H4L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M12 12v4"/><path d="m10 14 2-2 2 2"/>',
    food: '<path d="M4 12h16"/><path d="M6 12v3a6 6 0 0 0 12 0v-3"/><path d="M9 8c0-2 1-3 3-4 2 1 3 2 3 4"/><path d="M8 20h8"/>',
    supplement: '<path d="M10 21 3 14a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8 8 8 8"/>',
    snack: '<path d="M7 4h10l2 6-7 11L5 10Z"/><path d="M8 10h8"/><path d="m10 14 2 3 2-3"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.sparkles}</svg>`;
}

function iconBadge(name, className = "") {
  return `<span class="icon-badge ${className}">${icon(name)}</span>`;
}

function animalIcon(type) {
  return { 강아지: "dog", 고양이: "cat", 앵무새: "bird", 토끼: "rabbit", 햄스터: "hamster", 기타: "paw" }[type] || "paw";
}

function animalFace(type) {
  return { 강아지: "🐶", 고양이: "🐱", 앵무새: "🦜", 토끼: "🐰", 햄스터: "🐹", 기타: "🐾" }[type] || "🐾";
}

function recordIcon(category) {
  return { meal: "meal", activity: "activity", stool: "stool", behavior: "behavior", weight: "weight" }[category] || "check";
}

function productIcon(product) {
  return product.type === "supplement" ? "supplement" : product.type === "snack" ? "snack" : "food";
}

function render() {
  window.clearTimeout(onboardingTimer);
  if (surface === "web" && state.route === "platform") app.innerHTML = renderPlatform();
  else if (state.route === "splash") app.innerHTML = renderSplash();
  else if (state.route === "intro") app.innerHTML = renderIntro();
  else if (state.route === "signup") app.innerHTML = renderSignup();
  else if (state.route === "verify") app.innerHTML = renderVerify();
  else if (state.route === "pet-intro") app.innerHTML = renderPetIntro();
  else if (state.route === "pet-complete") app.innerHTML = renderPetComplete();
  else if (state.route === "pet-form") app.innerHTML = renderPetForm();
  else if (state.route === "pet-switch") app.innerHTML = renderPetSwitch();
  else if (state.route === "chat") app.innerHTML = renderChat();
  else if (state.route === "report") app.innerHTML = renderReport();
  else if (state.route === "anomaly") app.innerHTML = renderAnomaly();
  else if (state.route === "product") app.innerHTML = renderProduct();
  else app.innerHTML = renderApp();
  bindEvents();
  if (state.route === "chat" && state.aiStatus === "unknown") checkAiConnection();
  if (state.route === "intro") {
    addOnboardingSkip();
    simplifyOnboardingActions();
  }
  if (state.route === "signup") addPortfolioDemoEntry();
  if (state.route === "intro") {
    onboardingTimer = window.setTimeout(() => {
      if (state.route !== "intro") return;
      if (state.onboardingStep < 2) {
        state.onboardingStep += 1;
        render();
        return;
      }
      navigate(entryRoute(), { replace: true });
    }, 4000);
  }
  if (state.route === "splash") window.setTimeout(() => {
    if (state.route === "splash" && !state.bootstrapping) navigate(entryRoute(), { replace: true });
  }, 1200);
}

function appShell(content, { nav = true, compact = false } = {}) {
  return `
    <main class="app-stage">
      <section class="app-frame ${surface === "web" ? "desktop-frame" : ""}">
        <div class="app-scroll ${compact ? "compact" : ""}">${content}</div>
      </section>
      ${nav ? renderNav() : ""}
      ${nav ? `<button class="ai-fab" data-route="chat" aria-label="AI 헬스 매니저">${icon("message")}<span>AI</span></button>` : ""}
      ${state.busy ? '<div class="global-loading" role="status"><span class="loader"></span><p>데이터를 저장하고 있어요</p></div>' : ""}
      ${state.globalError ? `<div class="global-error" role="alert"><span>${escapeHtml(state.globalError)}</span><button data-dismiss-error aria-label="오류 닫기">${icon("close")}</button></div>` : ""}
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </main>
  `;
}

function renderNav() {
  return `<nav class="app-nav" aria-label="주요 메뉴">${tabs.map(([id, label, iconName]) => `
    <button class="${state.tab === id ? "active" : ""}" data-tab="${id}" aria-label="${label}">
      ${icon(iconName)}<span>${label}</span>
    </button>`).join("")}</nav>`;
}

function renderPlatform() {
  return `
    <main class="platform">
      <header><strong>펫케어픽</strong><nav><a href="#features">기능</a><a href="#nutrition">영양 추천</a><a href="?surface=app">앱 열기</a></nav></header>
      <section class="platform-hero">
        <div><span>PERSONALIZED PET HEALTH</span><h1>기록할수록 정교해지는 반려동물 영양 관리</h1><p>보호자가 입력한 프로필과 일상 기록을 기반으로 건강 지표, 맞춤 영양소, 사료·간식·영양제 조합을 한 곳에서 관리합니다.</p><a href="?surface=app">프로필 만들기</a></div>
        <aside><strong>실제 사용자 데이터로 작동</strong><p>프로필 등록 → 일상 기록 → 건강 리포트 → 추천 피드백이 하나의 데이터 흐름으로 연결됩니다.</p></aside>
      </section>
      <section class="platform-features" id="features">${["5개 건강 기록", "질환·알레르기 제외 추천", "다마리 독립 관리", "일정·건강 리포트"].map((title) => `<article><h2>${title}</h2><p>입력한 데이터가 저장되고 다음 화면에 즉시 반영됩니다.</p></article>`).join("")}</section>
    </main>`;
}

function renderSplash() {
  return appShell(`<section class="splash-screen"><div class="brand-symbol brand-pet">${animalEmoji("기타")}</div><h1>PetCarePick</h1><p>우리 아이 맞춤 건강관리</p><span></span></section>`, { nav: false, compact: true });
}

function renderIntro() {
  if (state.onboardingStep === 0) {
    return appShell(`<section class="intro onboarding-purple"><div class="onboarding-content"><div class="brand-symbol brand-pet">${state.data.pets[0] ? animalEmoji(state.data.pets[0].type) : animalEmoji("강아지")}</div><h1>획일화된 펫 정보는<br>그만.</h1><p>우리 아이의 나이, 체중, 질환에<br>맞춘 개인화 건강관리</p></div><div class="onboarding-actions"><div class="onboarding-dots"><i class="active"></i><i></i><i></i></div><button class="primary" data-onboarding-next>시작하기</button>${state.data.user ? '<button class="link" data-route="app">기존 데이터로 계속하기</button>' : '<button class="link" data-route="signup">이미 계정이 있나요? 로그인</button>'}</div></section>`, { nav: false, compact: true });
  }
  if (state.onboardingStep === 1) {
    return appShell(`<section class="intro onboarding-white"><div class="onboarding-content"><div class="brand-symbol">${icon("food")}</div><h1>딱 맞는 사료·운동을<br>추천해드려요</h1><p>질환·알레르기 성분 자동 제외<br>나이·체중 기반 맞춤 추천</p></div><div class="onboarding-actions"><div class="onboarding-dots"><i></i><i class="active"></i><i></i></div><button class="primary" data-onboarding-next>다음</button><button class="link" data-route="signup">건너뛰기</button></div></section>`, { nav: false, compact: true });
  }
  return appShell(`<section class="intro onboarding-white"><div class="onboarding-content"><div class="brand-symbol warning-symbol">${icon("alert")}</div><h1>이상 징후를 먼저<br>알려드려요</h1><p>식욕·체중·활동량 변화를 분석해<br>위험 신호를 조기에 감지</p></div><div class="onboarding-actions"><div class="onboarding-dots"><i></i><i></i><i class="active"></i></div><button class="primary" data-route="signup">시작하기</button><button class="link" data-route="signup">건너뛰기</button></div></section>`, { nav: false, compact: true });
}

function renderSignup() {
  const signup = state.authMode === "signup";
  return appShell(`<section class="page auth-page"><div class="auth-brand"><div class="brand-symbol">${icon("paw")}</div><h1>PetCarePick</h1><p>${signup ? "처음 만나 반가워요!" : "다시 오신 것을 환영해요!"}</p></div><div class="auth-tabs"><button class="${signup ? "" : "active"}" data-auth-mode="login">로그인</button><button class="${signup ? "active" : ""}" data-auth-mode="signup">회원가입</button></div>${signup ? `<form class="form" data-signup><label>이름<input name="name" autocomplete="name" required maxlength="20" placeholder="이름 입력"></label><label>이메일<input name="email" type="email" autocomplete="email" required placeholder="이메일 입력"></label><label>비밀번호<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="비밀번호 입력"></label><label>비밀번호 확인<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required placeholder="비밀번호 확인"></label><button class="primary">가입 완료</button></form>` : `<form class="form" data-login><label>별명 또는 이메일<input name="email" type="email" autocomplete="email" required placeholder="등록하신 이메일 입력"></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" required placeholder="비밀번호 입력"></label><button class="primary">로그인</button></form>`}</section>`, { nav: false });
}

function renderVerify() {
  return appShell(`<section class="verify-page"><div class="verify-icon">💌</div><h1>이메일을 확인해주세요</h1><p><strong>${escapeHtml(state.pendingUser?.email || "")}</strong> 으로<br>인증번호를 보냈어요</p>${location.hostname === "localhost" ? `<em>개발 인증번호: ${state.verificationCode}</em>` : ""}<form data-verify><div class="code-inputs">${[0,1,2,3].map((index) => `<input inputmode="numeric" maxlength="1" name="code${index}" required>`).join("")}</div><button class="primary">인증 완료</button></form><button class="link" data-resend-code>인증 메일 재발송</button></section>`, { nav: false });
}

function renderPetIntro() {
  const demoCopy = isDemoMode()
    ? '<p class="demo-mini-copy">포트폴리오 데모에서도 직접 등록 흐름을 체험할 수 있어요.</p>'
    : "";
  return appShell(`<section class="pet-intro refined-pet-intro ${demoCopy ? "has-demo-copy" : ""}">
    <div class="pet-intro-hero">${animalEmoji("기타")}</div>
    <span class="intro-kicker">PROFILE SETUP</span>
    <h1>첫 번째 가족을<br>등록해볼까요?</h1>
    <p class="intro-body">나이, 체중, 질환, 알레르기 정보가 맞춤 추천과 건강 리포트의 기준이 돼요.</p>
    ${demoCopy}
    <button class="primary" data-start-pet>반려동물 등록하기</button>
  </section>`, { nav: false });
}

function renderPetForm() {
  const editingPet = state.data.pets.find((item) => item.id === state.editingPetId);
  if (editingPet) {
    return appShell(`<section class="page"><header class="page-header"><button class="icon-button" data-back aria-label="뒤로">${icon("back")}</button><div><h1>프로필 수정</h1><p>추천과 리포트에 사용할 정보를 수정해주세요.</p></div></header><form class="form" data-pet-edit><label>이름<input name="name" value="${escapeHtml(editingPet.name)}" required maxlength="20"></label><label>동물 종류<select name="type">${["강아지", "고양이", "토끼", "햄스터", "기타"].map((type) => `<option ${editingPet.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label><label>품종<input name="breed" value="${escapeHtml(editingPet.breed)}" required></label><div class="two-columns"><label>나이<input name="age" type="number" min="0" max="30" value="${editingPet.age}" required></label><label>체중(kg)<input name="weight" type="number" min="0.1" max="100" step="0.1" value="${editingPet.weight}" required></label></div><label>질환 이력<input name="conditions" value="${escapeHtml((editingPet.conditions || []).join(", "))}"></label><label>알레르기<input name="allergies" value="${escapeHtml((editingPet.allergies || []).join(", "))}"></label><button class="primary">수정 완료</button><button class="danger-text" type="button" data-delete-pet>이 반려동물 삭제</button></form></section>`, { nav: false });
  }

  const draft = state.petDraft;
  const progress = Math.min(3, Math.max(1, state.petFormStep));
  if (state.petFormStep === 0) {
    const animals = [
      ["강아지", "산책·피부·체중 관리"],
      ["고양이", "음수량·비뇨기 관리"],
      ["앵무새", "활동·영양 균형"],
      ["햄스터", "소동물 식이 관리"],
      ["토끼", "치아·장 건강 관리"],
      ["기타", "직접 입력"],
    ];
    return appShell(`<section class="page pet-register">
      <header class="pet-register-hero">
        <div class="pet-intro-hero small">${animalEmoji(draft.type)}</div>
        <span>1 / 4</span>
        <h1>어떤 반려동물인가요?</h1>
        <p>종류에 따라 기록 항목과 추천 기준을 다르게 적용해요.</p>
      </header>
      <div class="animal-grid refined">
        ${animals.map(([type, note]) => `<button class="${draft.type === type ? "active" : ""}" data-pet-type="${type}">
          <span class="animal-face">${animalFace(type)}</span>
          <strong>${type}</strong>
          <small>${note}</small>
        </button>`).join("")}
      </div>
      <button class="primary" data-pet-next>다음으로</button>
    </section>`, { nav: false });
  }
  const titles = {
    1: ["기본 정보를 알려주세요", "나이와 체중은 급여량, 운동량, 성장 단계 계산에 사용돼요."],
    2: ["건강 정보를 확인할게요", "질환과 알레르기는 추천에서 제외·우선순위를 정하는 기준이에요."],
    3: ["기록 루틴을 정해볼까요?", "꾸준한 기록이 건강 리포트와 이상 징후 분석의 정확도를 높여요."],
  };
  const header = `<header class="registration-header refined">
    <button class="icon-button plain" type="button" data-pet-prev aria-label="이전 단계">${icon("back")}</button>
    <div>
      <span>${state.petFormStep + 1} / 4</span>
      <h1>${titles[state.petFormStep][0]}</h1>
      <p>${titles[state.petFormStep][1]}</p>
    </div>
    <div class="registration-progress"><span style="width:${(state.petFormStep + 1) / 4 * 100}%"></span></div>
  </header>`;
  if (state.petFormStep === 1) {
    return appShell(`<section class="page pet-register">${header}
      <form class="form pet-onboarding-form" data-pet-basic>
        <div class="pet-photo icon-photo">${animalEmoji(draft.type)}<small>프로필 사진은 나중에 추가</small></div>
        ${isDemoMode() ? '<button class="secondary compact-action" type="button" data-fill-demo-pet>예시 정보 채우기</button>' : ""}
        <label>이름 *<input name="name" value="${escapeHtml(draft.name)}" required placeholder="예: 몽치"></label>
        <div class="two-columns">
          <label>품종 *<input name="breed" value="${escapeHtml(draft.breed)}" required placeholder="예: 말티즈"></label>
          <label>나이 (살) *<input name="age" type="number" min="0" max="40" value="${draft.age}" required placeholder="4"></label>
        </div>
        <div class="two-columns">
          <label>체중 (kg) *<input name="weight" type="number" min=".1" max="150" step=".1" value="${draft.weight}" required placeholder="4.2"></label>
          <label>성별<select name="gender"><option ${draft.gender === "남아" ? "selected" : ""}>남아</option><option ${draft.gender === "여아" ? "selected" : ""}>여아</option></select></label>
        </div>
        <label>중성화 여부<select name="neutered"><option ${draft.neutered === "했어요" ? "selected" : ""}>했어요</option><option ${draft.neutered === "안 했어요" ? "selected" : ""}>안 했어요</option></select></label>
        <button class="primary">건강 정보로 이동</button>
      </form>
    </section>`, { nav: false });
  }
  if (state.petFormStep === 2) {
    return appShell(`<section class="page pet-register">${header}
      <form class="form pet-onboarding-form" data-pet-health>
        <div class="input-guide">
          <span>${icon("alert")}</span>
          <p>없으면 비워도 괜찮아요. 입력한 정보는 추천 필터와 리포트 문장에 반영돼요.</p>
        </div>
        <label>질병 / 질환 기록<input name="conditions" value="${escapeHtml(draft.conditions.join(", "))}" placeholder="예: 슬개골 탈구, 피부염"></label>
        <label>알레르기<input name="allergies" value="${escapeHtml(draft.allergies.join(", "))}" placeholder="예: 닭고기, 밀"></label>
        <label>오늘의 루틴<input name="routines" value="${escapeHtml(draft.routines.join(", "))}" placeholder="예: 아침 식사, 저녁 산책"></label>
        <p class="form-help">여러 항목은 쉼표로 구분해주세요.</p>
        <button class="primary">루틴 설정하기</button>
      </form>
    </section>`, { nav: false });
  }
  return appShell(`<section class="page pet-register">${header}
    <form class="routine-form refined" data-pet-routine>
      ${[
        ["morning", "아침 기록 알림", "오전 8:00", "meal"],
        ["evening", "저녁 기록 알림", "오후 8:00", "edit"],
        ["anomaly", "이상 징후 알림", "감지 즉시", "alert"],
      ].map(([id,label,time,iconName]) => `<label>
        ${iconBadge(iconName)}
        <span><strong>${label}</strong><small>${time}</small></span>
        <input type="checkbox" name="${id}" ${draft.reminders[id] ? "checked" : ""}>
      </label>`).join("")}
      <button class="primary">등록 완료</button>
      <button class="secondary" type="button" data-skip-routine>나중에 설정하기</button>
    </form>
  </section>`, { nav: false });
}

function renderPetComplete() {
  const pet = currentPet();
  return appShell(`<section class="completion-screen">
    ${iconBadge("check", "hero")}
    <h1>${escapeHtml(pet?.name || "반려동물")} 맞춤 추천<br>준비됐어요!</h1>
    <p>프로필을 기준으로 건강 요약, 추천, 기록 루틴을 바로 시작할 수 있어요.</p>
    <section>
      <span>이름</span><strong>${escapeHtml(pet?.name || "")}</strong>
      <span>종</span><strong>${escapeHtml(pet?.breed || pet?.type || "")} · ${pet?.age || 0}살 · ${pet?.weight || 0}kg</strong>
      <span>건강 상태</span><strong>${pet?.conditions?.length ? pet.conditions.join(", ") : "특이사항 없음"}</strong>
    </section>
    <button class="primary" data-route="app">홈으로 이동</button>
  </section>`, { nav: false, compact: true });
}

function renderApp() {
  if (!state.data.user) return renderSignup();
  if (!state.data.pets.length) return renderPetForm();
  const pet = currentPet();
  if (state.tab === "home") return renderHome(pet);
  if (state.tab === "record") return renderRecord(pet);
  if (state.tab === "recommend") return renderRecommend(pet);
  if (state.tab === "calendar") return renderCalendar(pet);
  return renderMy(pet);
}

function renderHome(pet) {
  const metrics = latestMetrics(pet);
  const done = completion(pet, localDate());
  const analysis = healthAnalysis(pet);
  return appShell(`<section class="page dashboard"><header class="dashboard-header"><div><h1>안녕하세요, ${escapeHtml(state.data.user.name)}님</h1><p>${escapeHtml(pet.name)}의 오늘을 확인해보세요</p></div><button class="avatar-button" data-route="pet-switch">${animalEmoji(pet.type)}</button></header><section class="pet-summary"><div><span>${animalEmoji(pet.type)}</span><div><h2>${escapeHtml(pet.name)}</h2><p>${escapeHtml(pet.breed)} · ${pet.age}살 · ${pet.weight}kg</p><em>${analysis.status}</em></div></div><button data-route="report">리포트 →</button></section>${analysis.alert ? `<button class="health-alert" data-route="anomaly"><span class="alert-dot"></span><span><strong>${analysis.alert.title}</strong><small>${analysis.alert.summary}</small></span>${icon("chevron")}</button>` : ""}<section class="section-title"><div><h2>오늘의 건강 요약</h2><p>${done}/5 기록 완료</p></div></section><section class="metric-grid"><article><strong>${metrics.appetite ?? "-"}${metrics.appetite === null ? "" : "%"}</strong><span>식사량</span><i style="--value:${metrics.appetite ?? 0}%"></i></article><article><strong>${metrics.activity ?? "-"}${metrics.activity === null ? "" : "분"}</strong><span>활동량</span><i style="--value:${Math.min(100, (metrics.activity ?? 0) * 2)}%"></i></article><article><strong>${metrics.weight ?? pet.weight}</strong><span>체중kg</span><i style="--value:${Math.min(100, ((metrics.weight ?? pet.weight) / Math.max(1, pet.weight)) * 65)}%"></i></article></section><button class="primary" data-tab="record">${icon("edit")} 오늘 기록하기</button><section class="section-title"><div><h2>${escapeHtml(pet.name)} 맞춤 영양 포인트</h2><p>${ageStage(pet.age)} · ${seasonLabel()}</p></div></section><div class="nutrition-list">${nutritionInsights(pet).map((item) => `<article>${iconBadge("supplement")}<div><strong>${item.name}</strong><p>${item.reason}</p></div></article>`).join("")}</div></section>`);
}

function renderRecord(pet) {
  const records = recordsForDate(pet.id, state.recordDate);
  const firstMissingIndex = recordCategories.findIndex(([id]) => !records.some((item) => item.category === id));
  const done = completion(pet, state.recordDate);
  return appShell(`<section class="page record-page"><header class="page-header row"><div><h1>기록</h1><p>${formatDate(state.recordDate)} · ${escapeHtml(pet.name)}</p></div><input class="date-picker" data-record-date type="date" value="${state.recordDate}"></header><section class="record-overview"><div><h2>오늘 기록 현황</h2><em>${done}/5 완료</em></div><div class="record-icons">${recordCategories.map(([id, label]) => `<span class="${records.some((item) => item.category === id) ? "done" : ""}"><b>${recordEmoji(id)}</b><small>${label}</small></span>`).join("")}</div></section><div class="completion-bar"><span style="width:${done * 20}%"></span></div><div class="record-categories">${recordCategories.map(([id, label, help], index) => renderRecordEditor(pet, id, label, help, records.find((item) => item.category === id), index === firstMissingIndex)).join("")}</div></section>`);
}

function renderRecordEditor(pet, id, label, help, record, shouldOpen) {
  const fields = {
    meal: `<label>식사량(%)<input name="value" type="number" min="0" max="100" value="${record?.value ?? ""}" required></label><label>식욕<select name="detail"><option>좋음</option><option ${record?.detail === "보통" ? "selected" : ""}>보통</option><option ${record?.detail === "나쁨" ? "selected" : ""}>나쁨</option></select></label>`,
    activity: `<label>활동 시간(분)<input name="value" type="number" min="0" value="${record?.value ?? ""}" required></label><label>강도<select name="detail"><option>낮음</option><option ${record?.detail === "보통" ? "selected" : ""}>보통</option><option ${record?.detail === "높음" ? "selected" : ""}>높음</option></select></label>`,
    stool: `<label>횟수<input name="value" type="number" min="0" value="${record?.value ?? ""}" required></label><label>상태<select name="detail"><option>정상</option><option ${record?.detail === "무름" ? "selected" : ""}>무름</option><option ${record?.detail === "딱딱함" ? "selected" : ""}>딱딱함</option><option ${record?.detail === "이상 있음" ? "selected" : ""}>이상 있음</option></select></label>`,
    behavior: `<label class="full">특이사항<textarea name="detail" maxlength="500" required>${escapeHtml(record?.detail || "")}</textarea></label><input name="value" type="hidden" value="1">`,
    weight: `<label class="full">체중(kg)<input name="value" type="number" min="0.1" max="100" step="0.1" value="${record?.value ?? pet.weight}" required></label><input name="detail" type="hidden" value="측정">`,
  };
  return `<details class="record-panel" ${shouldOpen ? "open" : ""}><summary><span class="record-status ${record ? "done" : ""}">${record ? icon("check") : icon("plus")}</span><div><strong>${label}</strong><small>${record ? recordSummary(id, record) : help}</small></div>${icon("chevron")}</summary><form data-record-form data-category="${id}">${fields[id]}<button class="primary">${record ? "수정 저장" : "기록 저장"}</button></form></details>`;
}

function renderRecommend(pet) {
  const products = recommendations(pet, state.recommendationMode);
  const categoryLabel = { food: "추천 사료", supplement: "추천 영양제", snack: "추천 간식", hospital: "주변 병원" }[state.recommendationMode];
  return appShell(`<section class="page recommend-page"><header class="page-header"><div><h1>맞춤 추천</h1><p>${escapeHtml(pet.name)} · ${pet.age}살 · ${pet.weight}kg 기준</p></div></header><div class="segmented">${[["food", "사료"], ["supplement", "영양제"], ["snack", "간식"], ["hospital", "병원"]].map(([id, label]) => `<button class="${state.recommendationMode === id ? "active" : ""}" data-mode="${id}">${label}</button>`).join("")}</div><h2 class="list-heading">${categoryLabel}</h2>${state.recommendationMode === "hospital" ? renderHospitals() : `<div class="product-list">${products.map((product, index) => renderProductCard(product, pet, index)).join("") || '<div class="empty-state"><strong>현재 조건에 맞는 제품이 없어요.</strong><p>알레르기 원료가 포함되지 않도록 제외한 결과예요.</p></div>'}</div>`}</section>`);
}

function renderProductCard(product, pet, index) {
  const feedback = latestFeedback(product.id, pet.id);
  return `<article class="product-card"><button class="product-main" data-product="${product.id}">${iconBadge(productIcon(product), "product-icon")}<div><div class="rank-row"><em>추천 ${index + 1}위</em><small>${product.matchScore}% 맞춤</small></div><h2>${product.name}</h2><p>${recommendationReason(product, pet)}</p><div class="tag-row">${product.ingredients.slice(0, 3).map((item) => `<em>${item}</em>`).join("")}</div></div><b>상세 →</b></button><div class="feedback-actions"><span>${feedback ? `최근 반응 · ${feedback.value}` : `${pet.name}가 먹어본 뒤 알려주세요`}</span><button data-feedback="${product.id}" data-value="잘 먹어요">잘 먹어요</button><button data-feedback="${product.id}" data-value="잘 안 먹어요">안 먹어요</button></div></article>`;
}

function renderCalendar(pet) {
  const events = state.data.events.filter((event) => event.petId === pet.id).sort((a, b) => a.date.localeCompare(b.date));
  const monthEvents = events.filter((event) => event.date.startsWith(state.calendarMonth));
  return appShell(`<section class="page calendar-page">
    <header class="page-header row"><div><h1>캘린더</h1><p>${escapeHtml(pet.name)}의 건강 일정</p></div><button class="text-action" data-toggle-event>${state.showEventForm ? "닫기" : "+ 일정 추가"}</button></header>
    ${renderMonthCalendar(events)}
    ${state.showEventForm ? renderEventForm(events.find((event) => event.id === state.editingEventId)) : ""}
    <section class="section-title"><div><h2>${Number(state.calendarMonth.slice(5))}월 전체 일정</h2><p>${monthEvents.length}개</p></div></section>
    <section class="timeline">${monthEvents.map((event) => `<article><i></i><time>${formatDate(event.date)}<small>${event.time || "시간 미정"}</small></time><div><em>${escapeHtml(event.type)}</em><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.memo || `${pet.name} 일정`)}</p></div><div class="event-actions"><button data-edit-event="${event.id}" aria-label="일정 수정">${icon("edit")}</button><button data-delete-event="${event.id}" aria-label="일정 삭제">${icon("trash")}</button></div></article>`).join("") || '<div class="empty-state"><strong>이 달에 등록된 일정이 없어요.</strong><p>예방접종이나 병원 일정을 추가해보세요.</p></div>'}</section>
  </section>`);
}

function renderEventForm(event) {
  const selected = (type) => event?.type === type ? "selected" : "";
  return `<form class="event-form" data-event-form>
    <div class="event-form-heading"><h2>${event ? "일정 수정" : "일정 등록"}</h2><button type="button" data-cancel-event aria-label="닫기">${icon("close")}</button></div>
    <label>일정 종류<select name="type">${["예방접종","건강검진","진료","복약","미용","기타"].map((type) => `<option ${selected(type)}>${type}</option>`).join("")}</select></label>
    <label>일정명<input name="title" required maxlength="50" value="${escapeHtml(event?.title || "")}" placeholder="예: 광견병 예방접종"></label>
    <label>날짜<input name="date" type="date" value="${event?.date || localDate()}" required></label>
    <label>시간<input name="time" type="time" value="${event?.time || "10:00"}"></label>
    <label class="full">메모<input name="memo" maxlength="120" value="${escapeHtml(event?.memo || "")}" placeholder="병원명이나 준비사항"></label>
    <button class="primary full">${event ? icon("check") : icon("plus")} ${event ? "변경사항 저장" : "일정 저장"}</button>
  </form>`;
}

function renderMy(pet) {
  const demo = state.data.user.demo === true;
  return appShell(`<section class="page my-page">
    <header class="page-header row"><div><h1>마이</h1><p>계정, 반려동물과 내 데이터를 관리해요.</p></div><button class="icon-button" data-route="chat" aria-label="AI 헬스 매니저">${icon("message")}</button></header>
    <section class="profile-card"><div class="user-avatar">${escapeHtml(state.data.user.name.slice(0, 1))}</div><div><h2>${escapeHtml(state.data.user.name)} ${demo ? '<em class="demo-badge">DEMO</em>' : ""}</h2><p>${escapeHtml(state.data.user.email)}</p></div>${demo ? "" : "<button data-edit-user>편집</button>"}</section>
    ${demo ? '<div class="demo-notice"><strong>포트폴리오 체험 모드</strong><p>현재 입력과 수정은 이 브라우저에만 저장되며 언제든 데모를 종료할 수 있어요.</p></div>' : ""}
    <section class="section-title"><div><h2>나의 반려동물</h2><p>${state.data.pets.length}/10마리</p></div><button data-new-pet>${icon("plus")} 추가</button></section>
    <div class="pet-list">${state.data.pets.map((item) => `<button class="${item.id === pet.id ? "active" : ""}" data-select-pet="${item.id}"><span>${animalEmoji(item.type)}</span><div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.breed)} · ${item.age}살 · ${item.weight}kg</p></div>${item.id === pet.id ? icon("check") : icon("chevron")}</button>`).join("")}</div>
    <h2 class="settings-heading">서비스</h2>
    <div class="settings-group">
      <button class="settings-row" data-edit-pet="${pet.id}"><span>${icon("edit")}</span><div><strong>선택한 프로필 수정</strong><p>질환, 알레르기, 체중 정보를 변경해요.</p></div>${icon("chevron")}</button>
      <button class="settings-row" data-route="chat"><span>${icon("message")}</span><div><strong>AI 헬스 매니저</strong><p>현재 프로필과 기록을 바탕으로 답변해요.</p></div>${icon("chevron")}</button>
      <button class="settings-row" data-replay-onboarding><span>${icon("replay")}</span><div><strong>서비스 소개 다시 보기</strong><p>온보딩 화면과 주요 기능 소개를 확인해요.</p></div>${icon("chevron")}</button>
    </div>
    <h2 class="settings-heading">내 데이터</h2>
    <div class="settings-group">
      <button class="settings-row" data-export-data><span>${icon("download")}</span><div><strong>내 데이터 내려받기</strong><p>프로필, 기록과 일정을 JSON 파일로 저장해요.</p></div>${icon("chevron")}</button>
      <button class="settings-row" data-logout><span>${icon("logout")}</span><div><strong>${demo ? "데모 종료" : "로그아웃"}</strong><p>${demo ? "샘플 데이터를 지우고 처음 화면으로 돌아가요." : "내 데이터는 보관하고 로그인 화면으로 돌아가요."}</p></div>${icon("chevron")}</button>
    </div>
    ${demo ? "" : '<section class="danger-zone"><strong>계정 및 데이터 삭제</strong><p>서버에 저장된 계정, 반려동물, 건강 기록과 일정을 영구적으로 삭제합니다.</p><button data-delete-account>계정과 데이터 삭제</button></section>'}
  </section>`);
}

function renderPetSwitch() {
  return appShell(`<section class="page"><header class="page-header row"><button class="icon-button" data-back>${icon("back")}</button><div><h1>반려동물 선택</h1><p>관리할 반려동물을 선택해주세요.</p></div><button class="icon-button" data-new-pet>${icon("plus")}</button></header><div class="pet-list large">${state.data.pets.map((pet) => `<button class="${pet.id === state.selectedPetId ? "active" : ""}" data-select-pet="${pet.id}"><span>${animalEmoji(pet.type)}</span><div><strong>${escapeHtml(pet.name)}</strong><p>${escapeHtml(pet.breed)} · 오늘 ${completion(pet, localDate())}/5 완료</p></div>${pet.id === state.selectedPetId ? icon("check") : icon("chevron")}</button>`).join("")}</div></section>`, { nav: false });
}

function renderChat() {
  const pet = currentPet();
  const prompts = pet ? [
    `${pet.name}의 오늘 식사량은 괜찮아?`,
    `${pet.name}에게 맞는 영양 성분 알려줘`,
    `최근 활동량을 분석해줘`,
    `병원에 가야 하는 신호가 뭐야?`,
  ] : ["반려동물 프로필은 어떻게 등록해?", "건강 기록은 어떻게 활용돼?"];
  const status = state.aiStatus === "connected"
    ? '<span class="ai-connection connected">OpenAI 연결됨</span>'
    : state.aiStatus === "unavailable"
      ? '<button class="ai-connection unavailable" data-check-ai>기본 분석 모드 · 다시 확인</button>'
      : '<button class="ai-connection checking" data-check-ai>AI 연결 확인 중</button>';
  return appShell(`<section class="chat-page"><header class="chat-header"><button class="icon-button plain" data-back aria-label="뒤로">${icon("back")}</button><div class="chat-ai-avatar">${icon("sparkles")}</div><div><h1>AI 헬스 매니저</h1><p><i></i>${pet ? `${escapeHtml(pet.name)} 프로필로 상담 중` : "프로필을 등록해주세요"}</p></div>${status}</header>${state.aiError ? `<div class="chat-system-notice">${escapeHtml(state.aiError)}</div>` : ""}${pet ? `<button class="chat-pet-context" data-route="pet-switch"><span>${animalEmoji(pet.type)}</span><div><strong>${escapeHtml(pet.name)}</strong><small>${escapeHtml(pet.breed)} · ${pet.age}살 · ${pet.weight}kg</small></div><em>변경</em></button>` : ""}<div class="chat-list"><section class="quick-prompts"><strong>무엇을 도와드릴까요?</strong><div>${prompts.map((prompt) => `<button data-chat-prompt="${escapeHtml(prompt)}" ${state.chatSending ? "disabled" : ""}>${escapeHtml(prompt)}</button>`).join("")}</div></section>${state.data.chats.map((message) => `<div class="chat-message ${message.from}"><span>${message.from === "ai" ? icon("sparkles") : escapeHtml(state.data.user?.name?.slice(0, 1) || "나")}</span><article><small>${message.from === "ai" ? "AI 헬스 매니저" : "보호자"}</small><p>${escapeHtml(message.text).replaceAll("\n", "<br>")}</p></article></div>`).join("")}</div><footer class="chat-composer"><p>AI 답변은 참고용이며 진단을 대신하지 않아요.</p><form class="chat-form" data-chat-form><textarea name="message" rows="1" maxlength="500" autocomplete="off" placeholder="건강·영양 고민을 물어보세요" ${state.chatSending ? "disabled" : ""}></textarea><button aria-label="전송" ${state.chatSending ? "disabled" : ""}>${state.chatSending ? '<span class="mini-loader"></span>' : icon("send")}</button></form></footer></section>`, { nav: false, compact: true });
}

function renderReport() {
  const pet = currentPet();
  const lastSeven = state.data.records.filter((record) => record.petId === pet.id && record.date >= offsetDate(-6));
  const metrics = latestMetrics(pet);
  const score = healthScore(pet);
  const analysis = healthAnalysis(pet);
  const rate = Math.min(100, Math.round(lastSeven.length / 35 * 100));
  const aiSummary = state.reportData?.summary || state.reportData?.report?.summary;
  const aiPanel = state.reportStatus === "loading"
    ? '<section class="report-ai loading"><span class="loader"></span><div><strong>AI가 최근 기록을 분석하고 있어요</strong><p>프로필과 건강 기록을 함께 확인하는 중입니다.</p></div></section>'
    : state.reportError
      ? `<section class="report-ai error"><div><strong>AI 리포트를 불러오지 못했어요</strong><p>${escapeHtml(state.reportError)}</p></div><button data-refresh-report>다시 시도</button></section>`
      : aiSummary
        ? `<section class="report-ai"><div><strong>AI 종합 분석</strong><p>${escapeHtml(aiSummary)}</p></div><button data-refresh-report>새로 분석</button></section>`
        : "";
  return appShell(`<section class="page report-page"><header class="page-header row"><button class="icon-button plain" data-back aria-label="홈으로">${icon("back")}</button><div><h1>건강 리포트</h1><p>최근 7일 · ${escapeHtml(pet.name)}</p></div></header>${aiPanel}<section class="score-card"><span>이번 주 건강 점수</span><strong>${score}</strong><small>/ 100점</small><p>${analysis.scoreMessage}</p></section><h2 class="list-heading">항목별 분석</h2><section class="report-grid"><article><span>식사량</span><strong>${metrics.appetite ?? "-"}${metrics.appetite === null ? "" : "%"}</strong><small>${analysis.appetiteLabel}</small></article><article><span>활동량</span><strong>${metrics.activity ?? "-"}${metrics.activity === null ? "" : "분"}</strong><small>${analysis.activityLabel}</small></article><article><span>현재 체중</span><strong>${metrics.weight ?? pet.weight}kg</strong><small>${analysis.weightLabel}</small></article><article><span>기록률</span><strong>${rate}%</strong><small>${lastSeven.length}/35개</small></article></section><h2 class="list-heading">이번 주 주의사항</h2><section class="report-notice ${analysis.alert ? "warning" : ""}"><strong>${analysis.alert?.title || `${pet.name}의 기록이 안정적이에요`}</strong><p>${analysis.alert?.detail || `${ageStage(pet.age)}와 현재 체중을 기준으로 식사·활동 기록을 꾸준히 유지해주세요.`}</p></section><section class="section-title"><div><h2>체중 추이</h2><p>최근 측정 기록</p></div></section><div class="weight-chart">${weightSeries(pet).map((item) => `<div><span style="height:${item.height}%"></span><small>${item.label}</small><em>${item.value}</em></div>`).join("") || '<div class="empty-state"><p>체중 기록을 남기면 개인별 추이를 볼 수 있어요.</p></div>'}</div></section>`, { nav: false });
}

async function loadHealthReport(force = false) {
  const pet = currentPet();
  if (!pet || state.reportStatus === "loading") return;
  state.reportStatus = "loading";
  state.reportError = "";
  render();
  try {
    if (!force && !isDemoMode()) {
      const saved = await api.listHealthReports(pet.id);
      if (saved.reports?.[0]) {
        state.reportData = saved.reports[0].report;
        state.reportStatus = "ready";
        render();
        return;
      }
    }
    const result = await api.createHealthReport({
      pet,
      records: state.data.records.filter((record) => record.petId === pet.id),
    });
    state.reportData = result.report;
    state.reportStatus = "ready";
  } catch (error) {
    state.reportStatus = "error";
    state.reportError = `${friendlyError(error)} 기본 지표 분석은 계속 확인할 수 있어요.`;
  }
  render();
}

function renderAnomaly() {
  const pet = currentPet();
  const analysis = healthAnalysis(pet);
  return appShell(`<section class="page"><header class="page-header row"><button class="icon-button plain" data-back>${icon("back")}</button><div><h1>이상 징후 상세</h1><p>${escapeHtml(pet.name)}의 최근 기록 분석</p></div></header><section class="anomaly-card">${icon("alert")}<div><strong>${analysis.alert?.title || "기록 확인 필요"}</strong><p>${analysis.alert?.detail || `${pet.name}의 최근 기록을 조금 더 쌓으면 변화 패턴을 자세히 분석할 수 있어요.`}</p></div></section><button class="primary" data-mode="hospital" data-tab="recommend">내 위치 주변 병원 찾기</button></section>`, { nav: false });
}

function renderProduct() {
  const product = catalog.find((item) => item.id === state.productId) || recommendations(currentPet(), state.recommendationMode)[0];
  const ranked = recommendations(currentPet(), product.type).find((item) => item.id === product.id);
  return appShell(`<section class="page"><header class="page-header row"><button class="icon-button plain" data-back>${icon("back")}</button><div><h1>추천 상세</h1><p>${escapeHtml(currentPet().name)}에게 추천하는 이유</p></div></header><section class="product-detail">${iconBadge(productIcon(product), "hero")}<small>${ranked?.matchScore || 60}% 개인 맞춤</small><h1>${product.name}</h1><p>${recommendationReason(product, currentPet())}</p><div class="tag-row">${product.ingredients.map((item) => `<em>${item}</em>`).join("")}</div></section><section class="section-title"><div><h2>주요 성분</h2><p>알레르기 제외 확인 완료</p></div></section><section class="ingredient-panel">${product.ingredients.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</section><section class="section-title"><div><h2>급여 후 반응</h2><p>다음 추천 순위에 반영돼요.</p></div></section><div class="detail-actions"><button data-feedback="${product.id}" data-value="잘 먹어요">잘 먹어요</button><button data-feedback="${product.id}" data-value="잘 안 먹어요">잘 안 먹어요</button></div></section>`, { nav: false });
}

function renderHospitals() {
  if (state.hospitalStatus === "idle") {
    return `<section class="location-panel">${icon("location")}<h2>내 주변 동물병원 찾기</h2><p>현재 위치를 기준으로 반경 5km의 실제 동물병원을 거리순으로 찾아요.</p><button class="primary" data-find-hospitals>위치 사용하기</button></section>`;
  }
  if (state.hospitalStatus === "loading") {
    return `<section class="location-panel loading"><span class="loader"></span><h2>주변 병원을 찾고 있어요</h2><p>위치와 병원 정보를 확인하는 중입니다.</p></section>`;
  }
  if (state.hospitalStatus === "error") {
    return `<section class="location-panel error">${icon("alert")}<h2>병원 정보를 불러오지 못했어요</h2><p>${escapeHtml(state.hospitalError)}</p><button class="primary" data-find-hospitals>다시 시도</button></section>`;
  }
  if (!state.nearbyHospitals.length) {
    return `<section class="location-panel">${icon("location")}<h2>반경 5km에 등록된 병원이 없어요</h2><p>검색 범위를 바꾸려면 잠시 후 다시 시도해주세요.</p><button class="primary" data-find-hospitals>다시 검색</button></section>`;
  }
  return `<div class="location-summary">${icon("location")}<span>현재 위치 기준 · 가까운 순</span><button data-find-hospitals>새로고침</button></div><div class="hospital-list">${state.nearbyHospitals.map((hospital) => `<article><div><small>${formatDistance(hospital.distance)}${hospital.hours ? ` · ${escapeHtml(hospital.hours)}` : ""}</small><h2>${escapeHtml(hospital.name)}</h2><p>${escapeHtml(hospital.address || "주소 정보 없음")}</p></div><div class="hospital-actions">${hospital.phone ? `<a href="tel:${encodeURIComponent(hospital.phone)}">전화</a>` : ""}<a href="${naverMapSearchUrl(hospital)}" target="_blank" rel="noopener">지도 보기</a></div></article>`).join("")}</div><p class="data-credit">병원 검색: OpenStreetMap · 지도 열기: 네이버 지도</p>`;
}

function bindEvents() {
  app.querySelectorAll("[data-route]").forEach((element) => element.addEventListener("click", () => navigate(element.dataset.route)));
  app.querySelectorAll("[data-back]").forEach((element) => element.addEventListener("click", () => goBack()));
  app.querySelector("[data-onboarding-next]")?.addEventListener("click", () => {
    state.onboardingStep = Math.min(2, state.onboardingStep + 1);
    render();
  });
  app.querySelectorAll("[data-onboarding-step]").forEach((element) => element.addEventListener("click", () => {
    state.onboardingStep = Number(element.dataset.onboardingStep);
    render();
  }));
  app.querySelectorAll("[data-auth-mode]").forEach((element) => element.addEventListener("click", () => {
    state.authMode = element.dataset.authMode;
    render();
  }));
  app.querySelectorAll("[data-tab]").forEach((element) => element.addEventListener("click", () => {
    if (element.dataset.mode) state.recommendationMode = element.dataset.mode;
    setTab(element.dataset.tab);
    if (element.dataset.mode === "hospital") loadNearbyHospitals();
  }));

  app.querySelector("[data-signup]")?.addEventListener("submit", submitSignup);
  app.querySelector("[data-login]")?.addEventListener("submit", submitLogin);
  app.querySelector("[data-verify]")?.addEventListener("submit", submitVerification);
  app.querySelector("[data-resend-code]")?.addEventListener("click", resendVerification);
  app.querySelector("[data-start-pet]")?.addEventListener("click", () => {
    state.petFormStep = 0;
    navigate("pet-form");
  });
  app.querySelectorAll("[data-pet-type]").forEach((element) => element.addEventListener("click", () => {
    state.petDraft.type = element.dataset.petType;
    render();
  }));
  app.querySelector("[data-pet-next]")?.addEventListener("click", () => {
    state.petFormStep = 1;
    render();
  });
  app.querySelector("[data-pet-prev]")?.addEventListener("click", () => {
    state.petFormStep = Math.max(0, state.petFormStep - 1);
    render();
  });
  app.querySelector("[data-fill-demo-pet]")?.addEventListener("click", fillDemoPetDraft);
  app.querySelector("[data-pet-basic]")?.addEventListener("submit", submitPetBasic);
  app.querySelector("[data-pet-health]")?.addEventListener("submit", submitPetHealth);
  app.querySelector("[data-pet-routine]")?.addEventListener("submit", submitPetRoutine);
  app.querySelector("[data-skip-routine]")?.addEventListener("click", () => saveNewPet());
  app.querySelector("[data-pet-edit]")?.addEventListener("submit", submitPet);
  app.querySelectorAll("[data-record-form]").forEach((form) => form.addEventListener("submit", submitRecord));
  app.querySelector("[data-event-form]")?.addEventListener("submit", submitEvent);
  app.querySelector("[data-chat-form]")?.addEventListener("submit", submitChat);
  app.querySelectorAll("[data-chat-prompt]").forEach((element) => element.addEventListener("click", () => sendChatText(element.dataset.chatPrompt)));
  app.querySelector("[data-check-ai]")?.addEventListener("click", checkAiConnection);
  app.querySelector("[data-refresh-report]")?.addEventListener("click", () => loadHealthReport(true));

  app.querySelector("[data-record-date]")?.addEventListener("change", (event) => {
    state.recordDate = event.target.value;
    render();
  });
  app.querySelector("[data-toggle-event]")?.addEventListener("click", () => {
    state.showEventForm = !state.showEventForm;
    state.editingEventId = "";
    render();
  });
  app.querySelector("[data-cancel-event]")?.addEventListener("click", closeEventForm);
  app.querySelectorAll("[data-calendar-shift]").forEach((element) => element.addEventListener("click", () => shiftCalendarMonth(Number(element.dataset.calendarShift))));
  app.querySelector("[data-calendar-today]")?.addEventListener("click", () => {
    state.calendarMonth = localDate().slice(0, 7);
    render();
  });
  app.querySelectorAll("[data-edit-event]").forEach((element) => element.addEventListener("click", () => {
    state.editingEventId = element.dataset.editEvent;
    state.showEventForm = true;
    render();
    app.querySelector(".event-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  app.querySelectorAll("[data-mode]").forEach((element) => element.addEventListener("click", () => {
    state.recommendationMode = element.dataset.mode;
    render();
    if (element.dataset.mode === "hospital" && state.hospitalStatus === "idle") loadNearbyHospitals();
  }));
  app.querySelectorAll("[data-product]").forEach((element) => element.addEventListener("click", () => {
    state.productId = element.dataset.product;
    navigate("product");
  }));
  app.querySelectorAll("[data-feedback]").forEach((element) => element.addEventListener("click", () => saveFeedback(element)));
  app.querySelectorAll("[data-find-hospitals]").forEach((element) => element.addEventListener("click", loadNearbyHospitals));
  app.querySelectorAll("[data-select-pet]").forEach((element) => element.addEventListener("click", () => {
    state.selectedPetId = element.dataset.selectPet;
    state.reportStatus = "idle";
    state.reportData = null;
    state.reportError = "";
    state.tab = "home";
    navigate("app");
  }));
  app.querySelectorAll("[data-new-pet]").forEach((element) => element.addEventListener("click", () => {
    state.editingPetId = "";
    navigate("pet-form");
  }));
  app.querySelectorAll("[data-edit-pet]").forEach((element) => element.addEventListener("click", () => {
    state.editingPetId = element.dataset.editPet;
    navigate("pet-form");
  }));
  app.querySelector("[data-delete-pet]")?.addEventListener("click", deletePet);
  app.querySelector("[data-edit-user]")?.addEventListener("click", editUser);
  app.querySelectorAll("[data-delete-event]").forEach((element) => element.addEventListener("click", () => deleteEvent(element.dataset.deleteEvent)));
  app.querySelector("[data-logout]")?.addEventListener("click", logout);
  app.querySelector("[data-replay-onboarding]")?.addEventListener("click", replayOnboarding);
  app.querySelector("[data-export-data]")?.addEventListener("click", exportUserData);
  app.querySelector("[data-delete-account]")?.addEventListener("click", deleteAllData);
  app.querySelector("[data-dismiss-error]")?.addEventListener("click", () => {
    state.globalError = "";
    render();
  });
}

function addPortfolioDemoEntry() {
  const authPage = app.querySelector(".auth-page");
  if (!authPage || authPage.querySelector("[data-demo-login]")) return;
  const demo = document.createElement("section");
  demo.className = "portfolio-demo";
  demo.innerHTML = `
    <span>PORTFOLIO DEMO</span>
    <div>
      <strong>가입 없이 주요 기능을 확인해보세요</strong>
      <p>반려동물 프로필, 건강 기록, 맞춤 추천과 리포트를 바로 체험할 수 있어요.</p>
    </div>
    <button type="button" data-demo-login>데모로 시작</button>
  `;
  authPage.append(demo);
  demo.querySelector("[data-demo-login]").addEventListener("click", startPortfolioDemo);
}

function addOnboardingSkip() {
  const intro = app.querySelector(".intro");
  if (!intro || intro.querySelector("[data-onboarding-skip]")) return;
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "onboarding-skip";
  skip.dataset.onboardingSkip = "";
  skip.textContent = entryRoute() === "app" ? "건너뛰고 홈으로" : "건너뛰기";
  skip.addEventListener("click", () => navigate(entryRoute()));
  intro.prepend(skip);
}

function simplifyOnboardingActions() {
  app.querySelectorAll(".onboarding-actions > .primary, .onboarding-actions > .link")
    .forEach((element) => element.remove());
}

function startPortfolioDemoWithSampleData() {
  const today = localDate();
  const day = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return localDate(date);
  };
  const petId = "portfolio-demo-pet";
  const record = (category, value, detail, date = today) => ({
    id: uid("demo-record"),
    petId,
    date,
    category,
    value,
    detail,
    updatedAt: new Date().toISOString(),
  });

  state.data = {
    ...emptyData(),
    user: { name: "포트폴리오 방문자", email: "demo@petcarepick.app", demo: true },
    pets: [{
      id: petId,
      name: "뭉치",
      type: "강아지",
      breed: "말티즈",
      age: 4,
      weight: 4.2,
      gender: "남아",
      neutered: "했어요",
      conditions: ["피부염"],
      allergies: ["닭고기"],
      routines: ["아침 식사", "저녁 산책"],
      reminders: { morning: true, evening: true, anomaly: true },
      demo: true,
    }],
    records: [
      record("meal", 82, "아침·저녁 식사", day(-2)),
      record("activity", 32, "산책", day(-2)),
      record("weight", 4.2, "", day(-2)),
      record("meal", 76, "평소보다 조금 적게 먹음", day(-1)),
      record("activity", 28, "산책", day(-1)),
      record("weight", 4.2, "", day(-1)),
      record("meal", 80, "아침 식사", today),
      record("activity", 30, "동네 산책", today),
      record("weight", 4.2, "", today),
    ],
    events: [{
      id: "portfolio-demo-event",
      petId,
      type: "건강검진",
      title: "정기 건강검진",
      date: day(7),
      time: "10:30",
      memo: "최근 건강 기록 상담",
    }],
    feedback: [],
    chats: [{ from: "ai", text: "안녕하세요! 뭉치의 프로필과 최근 건강 기록을 바탕으로 함께 살펴볼게요." }],
  };
  state.selectedPetId = petId;
  state.tab = "home";
  setSession("demo");
  saveData();
  navigate("app");
  showToast("포트폴리오 데모로 시작했어요.");
}

function startPortfolioDemo() {
  state.data = {
    ...emptyData(),
    user: { name: "포트폴리오 방문자", email: "demo@petcarepick.app", demo: true },
  };
  Object.assign(state.petDraft, {
    type: "강아지",
    name: "",
    breed: "",
    age: "",
    weight: "",
    gender: "남아",
    neutered: "했어요",
    conditions: [],
    allergies: [],
    routines: [],
    reminders: { morning: true, evening: true, anomaly: true },
  });
  state.selectedPetId = "";
  state.editingPetId = "";
  state.petFormStep = 0;
  state.onboardingStep = 0;
  state.tab = "home";
  setSession("demo");
  saveData();
  navigate("pet-intro");
  showToast("데모 계정으로 시작했어요. 반려동물을 직접 등록해보세요.");
}

async function loadNearbyHospitals() {
  if (!navigator.geolocation) {
    state.hospitalStatus = "error";
    state.hospitalError = "이 브라우저에서는 위치 기능을 지원하지 않아요.";
    render();
    return;
  }
  state.hospitalStatus = "loading";
  state.hospitalError = "";
  render();
  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;
    state.userLocation = { latitude, longitude };
    try {
      const backendResult = await api.hospitals({ latitude, longitude, radius: 5000 });
      state.nearbyHospitals = backendResult.hospitals || [];
      state.hospitalProvider = backendResult.provider || "kakao";
      state.hospitalStatus = "success";
      render();
      return;
    } catch {
      // Fall back to OpenStreetMap until backend keys are configured.
    }
    const query = `[out:json][timeout:20];nwr(around:5000,${latitude},${longitude})["amenity"="veterinary"];out center tags;`;
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: query }),
    });
    if (!response.ok) throw new Error("병원 검색 서버가 응답하지 않아요.");
    const result = await response.json();
    state.nearbyHospitals = result.elements
      .map((item) => normalizeHospital(item, latitude, longitude))
      .filter((item) => item.name)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20);
    state.hospitalProvider = "openstreetmap";
    state.hospitalStatus = "success";
    render();
  } catch (error) {
    state.hospitalStatus = "error";
    state.hospitalError = locationErrorMessage(error);
    render();
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 300000,
  }));
}

function normalizeHospital(item, latitude, longitude) {
  const tags = item.tags || {};
  const lat = item.lat ?? item.center?.lat;
  const lon = item.lon ?? item.center?.lon;
  const address = [
    tags["addr:city"] || tags["addr:district"],
    tags["addr:street"],
    tags["addr:housenumber"],
  ].filter(Boolean).join(" ");
  return {
    id: `${item.type}-${item.id}`,
    name: tags["name:ko"] || tags.name || tags["name:en"] || "",
    lat,
    lon,
    distance: distanceKm(latitude, longitude, lat, lon),
    address,
    phone: tags.phone || tags["contact:phone"] || "",
    hours: tags.opening_hours || "",
  };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRadians = (value) => value * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distance) {
  return distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`;
}

function locationErrorMessage(error) {
  if (error?.code === 1) return "위치 권한이 차단됐어요. 브라우저 설정에서 위치 권한을 허용해주세요.";
  if (error?.code === 2) return "현재 위치를 확인할 수 없어요. GPS나 네트워크 상태를 확인해주세요.";
  if (error?.code === 3) return "위치 확인 시간이 초과됐어요. 다시 시도해주세요.";
  return error?.message || "위치 기반 병원 검색 중 오류가 발생했어요.";
}

async function submitSignup(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (form.get("password") !== form.get("passwordConfirm")) return showToast("비밀번호가 일치하지 않아요.");
  const input = {
    name: String(form.get("name")).trim(),
    email: String(form.get("email")).trim(),
    password: String(form.get("password")),
  };
  const user = await runBusy(() => api.signup(input));
  if (!user) return;
  localStorage.removeItem(STORE_KEY);
  setSession("active");
  state.data = { ...emptyData(), user };
  navigate("pet-intro", { replace: true });
}

async function submitLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const user = await runBusy(() => api.login({
    email: String(form.get("email")).trim(),
    password: String(form.get("password")),
  }));
  if (!user) return;
  localStorage.removeItem(STORE_KEY);
  setSession("active");
  state.data = { ...emptyData(), user };
  await runBusy(hydrateServerData);
  navigate(state.data.pets.length ? "app" : "pet-intro", { replace: true });
}

function submitVerification(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const code = [0,1,2,3].map((index) => form.get(`code${index}`)).join("");
  if (code !== state.verificationCode) return showToast("인증번호를 다시 확인해주세요.");
  state.data.user = state.pendingUser;
  state.pendingUser = null;
  setSession("active");
  saveData();
  navigate("pet-intro");
}

function resendVerification() {
  state.verificationCode = String(Math.floor(1000 + Math.random() * 9000));
  showToast("새 인증번호를 만들었어요.");
}

async function submitPet(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const existing = state.data.pets.find((item) => item.id === state.editingPetId) || {};
  const input = {
    ...existing,
    name: String(form.get("name")).trim(),
    type: form.get("type"),
    breed: String(form.get("breed")).trim(),
    age: Number(form.get("age")),
    weight: Number(form.get("weight")),
    conditions: splitList(form.get("conditions")),
    allergies: splitList(form.get("allergies")),
  };
  let pet;
  if (isDemoMode()) {
    pet = { ...input, id: state.editingPetId || uid("pet") };
  } else {
    const result = await runBusy(() => state.editingPetId
      ? api.updatePet(state.editingPetId, input)
      : api.createPet(input));
    pet = result?.pet;
    if (!pet) return;
  }
  state.data.pets = state.editingPetId
    ? state.data.pets.map((item) => item.id === pet.id ? pet : item)
    : [...state.data.pets, pet];
  state.selectedPetId = pet.id;
  state.editingPetId = "";
  saveData();
  state.tab = "home";
  navigate("app");
}

function submitPetBasic(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  Object.assign(state.petDraft, {
    name: String(form.get("name")).trim(),
    breed: String(form.get("breed")).trim(),
    age: Number(form.get("age")),
    weight: Number(form.get("weight")),
    gender: form.get("gender"),
    neutered: form.get("neutered"),
  });
  state.petFormStep = 2;
  render();
}

function fillDemoPetDraft() {
  Object.assign(state.petDraft, {
    name: "몽치",
    type: state.petDraft.type || "강아지",
    breed: state.petDraft.type === "고양이" ? "코리안숏헤어" : "말티즈",
    age: 4,
    weight: 4.2,
    gender: "남아",
    neutered: "했어요",
    conditions: ["피부염"],
    allergies: ["닭고기"],
    routines: ["아침 식사", "저녁 산책"],
    reminders: { morning: true, evening: true, anomaly: true },
  });
  showToast("예시 정보를 채웠어요. 자유롭게 수정해도 돼요.");
  render();
}

function submitPetHealth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.petDraft.conditions = splitList(form.get("conditions"));
  state.petDraft.allergies = splitList(form.get("allergies"));
  state.petDraft.routines = splitList(form.get("routines"));
  state.petFormStep = 3;
  render();
}

async function submitPetRoutine(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.petDraft.reminders = {
    morning: form.get("morning") === "on",
    evening: form.get("evening") === "on",
    anomaly: form.get("anomaly") === "on",
  };
  await saveNewPet();
}

async function saveNewPet() {
  const draft = state.petDraft;
  const input = {
    name: draft.name,
    type: draft.type,
    breed: draft.breed,
    age: Number(draft.age),
    weight: Number(draft.weight),
    gender: draft.gender,
    neutered: draft.neutered,
    conditions: draft.conditions,
    allergies: draft.allergies,
    routines: draft.routines,
    reminders: draft.reminders,
  };
  let pet;
  if (isDemoMode()) {
    pet = { ...input, id: uid("pet") };
  } else {
    const result = await runBusy(() => api.createPet(input));
    pet = result?.pet;
    if (!pet) return;
  }
  state.data.pets.push(pet);
  state.selectedPetId = pet.id;
  state.petFormStep = 0;
  saveData();
  navigate("pet-complete");
}

async function submitRecord(event) {
  event.preventDefault();
  const pet = currentPet();
  const form = new FormData(event.currentTarget);
  const category = event.currentTarget.dataset.category;
  const input = {
    date: state.recordDate,
    category,
    value: Number(form.get("value")),
    detail: String(form.get("detail") || "").trim(),
  };
  let record;
  if (isDemoMode()) {
    record = { ...input, id: uid("record"), petId: pet.id, updatedAt: new Date().toISOString() };
  } else {
    const result = await runBusy(() => api.saveRecord(pet.id, input));
    record = result?.record;
    if (!record) return;
  }
  state.data.records = state.data.records.filter((item) => !(item.petId === pet.id && item.date === state.recordDate && item.category === category));
  state.data.records.push(record);
  if (category === "weight") pet.weight = record.value;
  saveData();
  showToast(`${recordCategories.find(([id]) => id === category)[1]} 기록이 저장됐어요.`);
}

async function submitEvent(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const wasEditing = Boolean(state.editingEventId);
  const input = {
    type: String(form.get("type")),
    title: String(form.get("title")).trim(),
    date: String(form.get("date")),
    time: String(form.get("time") || ""),
    memo: String(form.get("memo") || "").trim(),
  };
  let nextEvent;
  if (isDemoMode()) {
    nextEvent = {
      ...input,
      id: state.editingEventId || uid("event"),
      petId: currentPet().id,
      completed: false,
    };
  } else {
    const result = await runBusy(() => state.editingEventId
      ? api.updateEvent(state.editingEventId, input)
      : api.createEvent(currentPet().id, input));
    nextEvent = result?.event;
    if (!nextEvent) return;
  }
  state.data.events = state.editingEventId
    ? state.data.events.map((item) => item.id === state.editingEventId ? nextEvent : item)
    : [...state.data.events, nextEvent];
  saveData();
  state.showEventForm = false;
  state.editingEventId = "";
  showToast(wasEditing ? "일정이 수정됐어요." : "일정이 저장됐어요.");
}

function closeEventForm() {
  state.showEventForm = false;
  state.editingEventId = "";
  render();
}

async function submitChat(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const text = String(form.get("message") || "").trim();
  if (!text) return;
  await sendChatText(text);
}

async function sendChatText(text) {
  if (state.chatSending) return;
  state.chatSending = true;
  state.aiError = "";
  state.data.chats.push({ from: "user", text });
  saveData();
  render();
  scrollChatToBottom();
  try {
    const pet = currentPet();
    const result = await api.chat({
      message: text,
      pet,
      recentRecords: state.data.records.filter((record) => record.petId === pet?.id).slice(-50),
      conversation: state.data.chats.slice(-8),
      ...(state.chatSessionId ? { sessionId: state.chatSessionId } : {}),
    });
    state.data.chats.push({ from: "ai", text: result.message });
    state.chatSessionId = result.sessionId || state.chatSessionId;
    state.aiStatus = result.source === "openai" ? "connected" : "unavailable";
    state.aiError = result.warning
      ? `${result.warning} 기본 건강 분석으로 답변했고 대화 내역은 안전하게 저장했어요.`
      : "";
  } catch (error) {
    state.aiStatus = "unavailable";
    state.aiError = `${error.message} 기본 건강 분석으로 답변했어요.`;
    state.data.chats.push({ from: "ai", text: `[기본 분석]\n${chatReply(text, currentPet())}` });
  } finally {
    state.chatSending = false;
  }
  saveData();
  render();
  scrollChatToBottom();
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    const list = document.querySelector(".chat-list");
    if (list) list.scrollTop = list.scrollHeight;
  });
}

async function checkAiConnection() {
  state.aiStatus = "checking";
  state.aiError = "";
  render();
  try {
    const result = await api.health();
    state.aiStatus = result.capabilities?.ai ? "connected" : "unavailable";
    if (!result.capabilities?.ai) state.aiError = "OpenAI API 키가 서버에 설정되지 않아 기본 분석 모드로 동작해요.";
  } catch {
    state.aiStatus = "unavailable";
    state.aiError = "AI 서버 상태를 확인하지 못했어요. 기본 분석 모드로 계속 사용할 수 있어요.";
  }
  render();
}

async function saveFeedback(element) {
  const productId = element.dataset.feedback;
  const value = element.dataset.value;
  let feedback;
  if (isDemoMode()) {
    feedback = { id: uid("feedback"), petId: currentPet().id, productId, value, date: new Date().toISOString() };
  } else {
    const result = await runBusy(() => api.saveFeedback(currentPet().id, { productId, value }));
    feedback = result?.feedback;
    if (!feedback) return;
  }
  state.data.feedback.push(feedback);
  saveData();
  showToast(value === "잘 안 먹어요" ? "다음 추천에서 우선순위를 낮출게요." : "선호 제품으로 학습했어요.");
}

async function deletePet() {
  const pet = currentPet();
  if (!pet || !confirm(`${pet.name}의 프로필과 기록을 모두 삭제할까요?`)) return;
  if (!isDemoMode()) {
    const deleted = await runBusy(() => api.deletePet(pet.id));
    if (deleted === null && state.globalError) return;
  }
  state.data.pets = state.data.pets.filter((item) => item.id !== pet.id);
  state.data.records = state.data.records.filter((item) => item.petId !== pet.id);
  state.data.events = state.data.events.filter((item) => item.petId !== pet.id);
  state.data.feedback = state.data.feedback.filter((item) => item.petId !== pet.id);
  state.selectedPetId = state.data.pets[0]?.id || "";
  state.editingPetId = "";
  saveData();
  navigate(state.data.pets.length ? "app" : "pet-form");
}

async function deleteEvent(id) {
  if (!isDemoMode()) {
    const deleted = await runBusy(() => api.deleteEvent(id));
    if (deleted === null && state.globalError) return;
  }
  state.data.events = state.data.events.filter((event) => event.id !== id);
  saveData();
  showToast("일정이 삭제됐어요.");
}

function naverMapSearchUrl(hospital) {
  const query = [hospital.name, hospital.address].filter(Boolean).join(" ");
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

async function editUser() {
  const name = prompt("이름", state.data.user.name);
  if (name === null) return;
  const normalized = name.trim() || state.data.user.name;
  if (!isDemoMode()) {
    const result = await runBusy(() => api.updateMe({ name: normalized }));
    if (!result?.user) return;
    state.data.user = result.user;
  } else {
    state.data.user = { ...state.data.user, name: normalized };
  }
  saveData();
  showToast("계정 정보가 수정됐어요.");
}

async function logout() {
  if (state.data.user?.demo) {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(SESSION_KEY);
    state.data = emptyData();
    state.selectedPetId = "";
    state.tab = "home";
    state.onboardingStep = 0;
    navigate("intro", { replace: true });
    return;
  }
  await runBusy(() => api.logout());
  api.clearSession();
  state.data = emptyData();
  state.selectedPetId = "";
  setSession("logged-out");
  state.tab = "home";
  navigate("signup", { replace: true });
}

function replayOnboarding() {
  state.onboardingStep = 0;
  navigate("intro");
}

function exportUserData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    data: state.data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `petcarepick-${localDate()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("내 데이터 파일을 준비했어요.");
}

async function deleteAllData() {
  if (!confirm("계정, 반려동물, 건강 기록과 일정을 모두 삭제할까요? 이 작업은 되돌릴 수 없어요.")) return;
  if (!isDemoMode()) {
    const deleted = await runBusy(() => api.deleteMe());
    if (deleted === null && state.globalError) return;
    api.clearSession();
  }
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(SESSION_KEY);
  state.data = emptyData();
  state.selectedPetId = "";
  state.tab = "home";
  state.onboardingStep = 0;
  navigate("intro", { replace: true });
}

function recordsForDate(petId, date) {
  return state.data.records.filter((record) => record.petId === petId && record.date === date);
}

function completion(pet, date) {
  return new Set(recordsForDate(pet.id, date).map((record) => record.category)).size;
}

function latestRecord(pet, category) {
  return state.data.records.filter((record) => record.petId === pet.id && record.category === category).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function latestMetrics(pet) {
  return {
    appetite: latestRecord(pet, "meal")?.value ?? null,
    activity: latestRecord(pet, "activity")?.value ?? null,
    weight: latestRecord(pet, "weight")?.value ?? pet.weight,
  };
}

function recordSummary(category, record) {
  if (category === "meal") return `${record.value}% · ${record.detail}`;
  if (category === "activity") return `${record.value}분 · ${record.detail}`;
  if (category === "stool") return `${record.value}회 · ${record.detail}`;
  if (category === "behavior") return record.detail;
  return `${record.value}kg`;
}

function recommendations(pet, type) {
  const allergies = new Set(pet.allergies || []);
  const stage = ageStageId(pet.age);
  const metrics = latestMetrics(pet);
  return catalog
    .filter((product) => product.type === type)
    .filter((product) => product.stages.includes(stage))
    .filter((product) => !product.excludes.some((ingredient) => allergies.has(ingredient)))
    .map((product) => {
      const conditionMatches = product.conditions.filter((condition) => pet.conditions.includes(condition)).length;
      const preferred = latestFeedback(product.id, pet.id)?.value === "잘 먹어요";
      const lowActivityBoost = type === "food" && metrics.activity !== null && metrics.activity < 25 && product.id === "food-light";
      const score = 55 + conditionMatches * 25 + (preferred ? 12 : 0) + (lowActivityBoost ? 8 : 0) + (product.stages.includes(stage) ? 8 : 0);
      return { ...product, score, matchScore: Math.min(99, score) };
    })
    .filter((product) => latestFeedback(product.id, pet.id)?.value !== "잘 안 먹어요")
    .sort((a, b) => b.score - a.score);
}

function recommendationReason(product, pet) {
  const condition = product.conditions.find((item) => pet.conditions.includes(item));
  const metrics = latestMetrics(pet);
  if (condition) return `${pet.name}의 ${condition} 이력과 ${ageStage(pet.age)} 단계를 함께 반영했어요.`;
  if (product.type === "food" && metrics.activity !== null && metrics.activity < 25) return `최근 활동량 ${metrics.activity}분과 ${pet.weight}kg 체중을 고려한 조합이에요.`;
  if (product.type === "food") return `${pet.name}의 ${pet.weight}kg 체중과 ${ageStage(pet.age)} 영양 균형에 맞춰 골랐어요.`;
  if (product.type === "supplement") return `${seasonLabel()} 건강 관리에 보완하기 좋은 성분 조합이에요.`;
  return `${pet.name}의 ${pet.allergies.length ? pet.allergies.join(", ") : "등록된"} 알레르기 조건을 확인한 간식이에요.`;
}

function latestFeedback(productId, petId) {
  return state.data.feedback.filter((item) => item.productId === productId && item.petId === petId).at(-1);
}

function nutritionInsights(pet) {
  const result = [];
  if (pet.conditions.includes("심장 질환")) result.push({ icon: "🫀", name: "타우린", reason: "심장 건강 보조를 우선 고려해요." });
  if (pet.conditions.includes("피부염")) result.push({ icon: "💧", name: "오메가3", reason: "피부와 모질 관리에 도움을 줄 수 있어요." });
  if (pet.conditions.includes("관절염") || pet.age >= 7) result.push({ icon: "🦴", name: "글루코사민", reason: "관절 부담이 커지는 시기를 보완해요." });
  if (new Date().getMonth() >= 5 && new Date().getMonth() <= 7) result.push({ icon: "💦", name: "수분 보충", reason: "여름철 음수량과 수분 섭취를 챙겨주세요." });
  else result.push({ icon: "🌿", name: "프로바이오틱스", reason: "소화와 배변 컨디션을 꾸준히 관리해요." });
  return result.slice(0, 3);
}

function ageStageId(age) {
  if (age <= 1) return "growth";
  if (age >= 7) return "senior";
  return "adult";
}

function ageStage(age) {
  return ageStageId(age) === "growth" ? "성장기" : ageStageId(age) === "senior" ? "시니어" : "성견·성묘";
}

function seasonLabel() {
  const month = new Date().getMonth() + 1;
  if ([6, 7, 8].includes(month)) return "여름 수분 관리";
  if ([12, 1, 2].includes(month)) return "겨울 체중 관리";
  return "환절기 면역 관리";
}

function healthScore(pet) {
  const metrics = latestMetrics(pet);
  const completeness = Math.min(100, state.data.records.filter((record) => record.petId === pet.id && record.date >= offsetDate(-6)).length / 35 * 100);
  const appetite = metrics.appetite ?? 70;
  const activity = Math.min(100, (metrics.activity ?? 20) * 2);
  return Math.round(appetite * 0.4 + activity * 0.35 + completeness * 0.25);
}

function healthAnalysis(pet) {
  const metrics = latestMetrics(pet);
  const appetiteLow = metrics.appetite !== null && metrics.appetite < 60;
  const activityLow = metrics.activity !== null && metrics.activity < 20;
  const weightChange = latestWeightChange(pet);
  const alert = appetiteLow
    ? { title: "식욕 감소가 감지됐어요", summary: `최근 식사량이 ${metrics.appetite}%로 기록됐어요.`, detail: `${pet.name}의 최근 식사량이 권장 범위보다 낮아요. 하루 이상 이어지면 수의사 상담을 권장합니다.` }
    : activityLow
      ? { title: "활동량이 평소보다 낮아요", summary: `최근 활동 시간이 ${metrics.activity}분이에요.`, detail: `${ageStage(pet.age)} 기준 활동량이 낮게 기록됐어요. 컨디션을 확인하고 가벼운 활동부터 시작해주세요.` }
      : Math.abs(weightChange) >= 5
        ? { title: "체중 변화 확인이 필요해요", summary: `최근 체중이 ${Math.abs(weightChange).toFixed(1)}% 변했어요.`, detail: `짧은 기간의 체중 변화가 감지됐어요. 식사량과 활동 기록을 함께 확인해주세요.` }
        : null;
  const score = healthScore(pet);
  return {
    alert,
    status: alert ? "관찰 필요" : "건강함",
    scoreMessage: score >= 80 ? "최근 기록이 안정적으로 유지되고 있어요." : score >= 60 ? "조금만 더 꾸준히 기록하면 정확도가 높아져요." : "식사와 활동 기록을 우선 확인해주세요.",
    appetiteLabel: metrics.appetite === null ? "기록 필요" : metrics.appetite >= 80 ? "좋음" : metrics.appetite >= 60 ? "보통" : "주의",
    activityLabel: metrics.activity === null ? "기록 필요" : metrics.activity >= 30 ? "충분" : metrics.activity >= 20 ? "보통" : "부족",
    weightLabel: Math.abs(weightChange) < 3 ? "안정" : weightChange > 0 ? "증가" : "감소",
  };
}

function latestWeightChange(pet) {
  const records = state.data.records
    .filter((record) => record.petId === pet.id && record.category === "weight")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (records.length < 2) return 0;
  const previous = records.at(-2).value;
  return previous ? ((records.at(-1).value - previous) / previous) * 100 : 0;
}

function recordEmoji(category) {
  return icon(recordIcon(category));
}

function renderMonthCalendar(events) {
  const today = new Date();
  const [yearValue, monthValue] = state.calendarMonth.split("-").map(Number);
  const year = yearValue;
  const month = monthValue - 1;
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const eventCounts = events
    .filter((event) => event.date.startsWith(state.calendarMonth))
    .reduce((counts, event) => {
      const day = Number(event.date.slice(8));
      counts.set(day, (counts.get(day) || 0) + 1);
      return counts;
    }, new Map());
  const days = [
    ...Array.from({ length: firstDay }, () => "<span></span>"),
    ...Array.from({ length: lastDate }, (_, index) => {
      const day = index + 1;
      const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      const eventCount = eventCounts.get(day) || 0;
      return `<b class="${isToday ? "today" : ""} ${eventCount ? "has-event" : ""}">${day}${eventCount ? `<i aria-label="일정 ${eventCount}개"></i>` : ""}</b>`;
    }),
  ].join("");
  const currentMonth = state.calendarMonth === localDate().slice(0, 7);
  return `<section class="month-calendar"><header><button data-calendar-shift="-1" aria-label="이전 달">‹</button><h2>${year}년 ${month + 1}월</h2><button data-calendar-shift="1" aria-label="다음 달">›</button></header>${currentMonth ? "" : '<button class="calendar-today" data-calendar-today>이번 달로 돌아가기</button>'}<div class="weekdays">${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}</div><div class="calendar-days">${days}</div></section>`;
}

function shiftCalendarMonth(offset) {
  const [year, month] = state.calendarMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  state.calendarMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  state.showEventForm = false;
  state.editingEventId = "";
  render();
}

function weightSeries(pet) {
  const records = state.data.records.filter((record) => record.petId === pet.id && record.category === "weight").sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  if (!records.length) return [];
  const values = records.map((record) => record.value);
  const min = Math.min(...values) - 0.2;
  const max = Math.max(...values) + 0.2;
  return records.map((record) => ({ value: record.value, label: record.date.slice(5), height: 25 + ((record.value - min) / Math.max(0.1, max - min)) * 65 }));
}

function chatReply(text, pet) {
  if (!pet) return "먼저 반려동물 프로필을 등록해주세요.";
  if (text.includes("사료") || text.includes("영양")) return `${pet.name}의 ${pet.age}살, ${pet.weight}kg 프로필과 알레르기를 기준으로 추천 탭의 제품을 확인해보세요.`;
  if (text.includes("식욕")) return `최근 식사 기록이 60% 미만으로 하루 이상 이어지면 스트레스와 소화 상태를 확인하고 병원 상담을 권장해요.`;
  if (text.includes("산책") || text.includes("활동")) return `${ageStage(pet.age)} 기준으로 무리하지 않는 범위에서 하루 20~40분 활동을 권장해요.`;
  return `${pet.name}의 프로필과 최근 기록을 기준으로 답변하고 있어요. 구체적인 증상이나 영양 고민을 알려주세요.`;
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short" }).format(new Date(`${value}T00:00:00`));
}

function animalEmoji(type) {
  return `<span class="pet-emoji" aria-hidden="true">${animalFace(type)}</span>`;
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}
