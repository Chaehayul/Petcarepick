import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, "../.env"));

const port = Number(process.env.PORT || 8787);
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:4173";

const server = createServer(async (request, response) => {
  setCors(response);
  if (request.method === "OPTIONS") return send(response, 204, null);

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return send(response, 200, { ok: true, service: "petcarepick-backend" });
    }
    if (request.method === "POST" && url.pathname === "/api/hospitals/nearby") {
      return send(response, 200, await findNearbyHospitals(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/ai/chat") {
      return send(response, 200, await createHealthChat(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/reports/health") {
      return send(response, 200, await createHealthReport(await readJson(request)));
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return send(response, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`Petcarepick backend: http://localhost:${port}`);
});

async function findNearbyHospitals({ latitude, longitude, radius = 5000 }) {
  requireValue(latitude, "latitude");
  requireValue(longitude, "longitude");
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return findOpenStreetMapHospitals(latitude, longitude, radius);
  const params = new URLSearchParams({
    query: "동물병원",
    x: String(longitude),
    y: String(latitude),
    radius: String(Math.min(20000, Math.max(100, Number(radius)))),
    sort: "distance",
    size: "15",
  });
  const result = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (!result.ok) {
    const error = await result.json().catch(() => ({}));
    console.warn("Kakao Local API unavailable:", result.status, error.message || error.errorType);
    return findOpenStreetMapHospitals(latitude, longitude, radius);
  }
  const payload = await result.json();
  return {
    provider: "kakao",
    hospitals: payload.documents.map((item) => ({
      id: item.id,
      name: item.place_name,
      address: item.road_address_name || item.address_name,
      phone: item.phone,
      lat: Number(item.y),
      lon: Number(item.x),
      distance: Number(item.distance || 0) / 1000,
      placeUrl: item.place_url,
    })),
  };
}

async function findOpenStreetMapHospitals(latitude, longitude, radius) {
  const safeRadius = Math.min(20000, Math.max(100, Number(radius) || 5000));
  const query = `[out:json][timeout:20];nwr(around:${safeRadius},${latitude},${longitude})["amenity"="veterinary"];out center tags;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ];
  let payload;
  for (const endpoint of endpoints) {
    try {
      const result = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Petcarepick/0.1",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(12000),
      });
      if (!result.ok) continue;
      payload = await result.json();
      break;
    } catch {
      // Try the next public Overpass instance.
    }
  }
  if (!payload) throw httpError(502, "주변 병원 검색 서비스가 응답하지 않아요.");
  const hospitals = payload.elements
    .map((item) => {
      const tags = item.tags || {};
      const lat = item.lat ?? item.center?.lat;
      const lon = item.lon ?? item.center?.lon;
      return {
        id: `${item.type}-${item.id}`,
        name: tags["name:ko"] || tags.name || tags["name:en"] || "",
        address: [
          tags["addr:city"] || tags["addr:district"],
          tags["addr:street"],
          tags["addr:housenumber"],
        ].filter(Boolean).join(" "),
        phone: tags.phone || tags["contact:phone"] || "",
        lat,
        lon,
        distance: distanceKm(latitude, longitude, lat, lon),
        placeUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
      };
    })
    .filter((item) => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
  return { provider: "openstreetmap", hospitals };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function createHealthChat({ message, pet, recentRecords = [], conversation = [] }) {
  requireValue(message, "message");
  requireValue(pet?.name, "pet");
  const emergency = emergencySignal(message);
  if (emergency) return { message: emergency, emergency: true, source: "safety-rule" };

  const prompt = [
    "You are Petcarepick AI Health Manager for companion animals.",
    "Do not diagnose, prescribe, or claim certainty. Explain observations and when veterinary care is appropriate.",
    "Answer in concise Korean. Base the answer only on the supplied profile and records.",
    `Pet profile: ${JSON.stringify(pet)}`,
    `Recent records: ${JSON.stringify(recentRecords.slice(-50))}`,
    `Conversation: ${JSON.stringify(conversation.slice(-8))}`,
    `User question: ${message}`,
  ].join("\n");
  const output = await openAIResponse(process.env.OPENAI_CHAT_MODEL || "gpt-5.4-mini", prompt);
  return { message: output, emergency: false, source: "openai" };
}

async function createHealthReport({ pet, records = [] }) {
  requireValue(pet?.name, "pet");
  const prompt = [
    "Create a companion-animal wellness report in Korean.",
    "This is not a diagnosis. Use only supplied data and explicitly state when evidence is insufficient.",
    "Return JSON with keys: summary, score, confidence, metrics, alerts, actions, vetQuestions.",
    "score must be 0-100. confidence must be low, medium, or high.",
    `Pet profile: ${JSON.stringify(pet)}`,
    `Records: ${JSON.stringify(records.slice(-450))}`,
  ].join("\n");
  const output = await openAIResponse(process.env.OPENAI_REPORT_MODEL || "gpt-5.5", prompt);
  try {
    return { report: JSON.parse(output), source: "openai" };
  } catch {
    return { report: { summary: output, confidence: "low" }, source: "openai" };
  }
}

async function openAIResponse(model, input) {
  const key = requireSecret("OPENAI_API_KEY");
  const result = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      store: process.env.OPENAI_STORE_RESPONSES === "true",
    }),
  });
  if (!result.ok) throw httpError(502, "AI 응답을 생성하지 못했어요.");
  const payload = await result.json();
  return payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text || "";
}

function emergencySignal(message) {
  const text = String(message).replace(/\s/g, "");
  const urgent = ["호흡곤란", "숨을못", "의식없", "경련", "발작", "피를토", "대량출혈", "독극물", "초콜릿먹", "포도먹"];
  if (!urgent.some((keyword) => text.includes(keyword))) return "";
  return "응급 가능성이 있어요. AI 답변을 기다리지 말고 가까운 24시간 동물병원에 즉시 연락하거나 방문해주세요.";
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", frontendOrigin);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function send(response, status, data) {
  response.statusCode = status;
  if (data === null) return response.end();
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw httpError(413, "Request body is too large");
  }
  return body ? JSON.parse(body) : {};
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function requireSecret(name) {
  const value = process.env[name];
  if (!value) throw httpError(503, `${name} 환경변수가 설정되지 않았어요.`);
  return value;
}

function requireValue(value, name) {
  if (value === undefined || value === null || value === "") throw httpError(400, `${name} 값이 필요해요.`);
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
