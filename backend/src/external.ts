import { config } from "./config.js";
import { AppError } from "./errors.js";

type HospitalRequest = {
  latitude: number;
  longitude: number;
  radius?: number;
};

type PetProfile = {
  name: string;
  [key: string]: unknown;
};

export async function findNearbyHospitals({ latitude, longitude, radius = 5000 }: HospitalRequest) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new AppError(400, "위도와 경도를 확인해주세요.", "INVALID_LOCATION");
  }
  if (config.mapProvider !== "kakao" || !config.kakaoRestKey) {
    return findOpenStreetMapHospitals(latitude, longitude, radius);
  }

  const params = new URLSearchParams({
    query: "동물병원",
    x: String(longitude),
    y: String(latitude),
    radius: String(Math.min(20000, Math.max(100, Number(radius)))),
    sort: "distance",
    size: "15",
  });
  const result = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
    headers: { Authorization: `KakaoAK ${config.kakaoRestKey}` },
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) return findOpenStreetMapHospitals(latitude, longitude, radius);

  const payload = await result.json() as { documents: Array<Record<string, string>> };
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

async function findOpenStreetMapHospitals(latitude: number, longitude: number, radius: number) {
  const safeRadius = Math.min(20000, Math.max(100, Number(radius) || 5000));
  const query = `[out:json][timeout:20];nwr(around:${safeRadius},${latitude},${longitude})["amenity"="veterinary"];out center tags;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ];
  let payload: { elements: Array<Record<string, any>> } | undefined;

  for (const endpoint of endpoints) {
    try {
      const result = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Petcarepick/1.0",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(12000),
      });
      if (!result.ok) continue;
      payload = await result.json() as typeof payload;
      break;
    } catch {
      // Public Overpass instances can be temporarily unavailable.
    }
  }

  if (!payload) throw new AppError(502, "주변 병원 검색 서비스가 응답하지 않아요.", "HOSPITAL_PROVIDER_ERROR");
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

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function createHealthChat({
  message,
  pet,
  recentRecords = [],
  conversation = [],
}: {
  message: string;
  pet: PetProfile;
  recentRecords?: unknown[];
  conversation?: unknown[];
}) {
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
  const output = await openAIResponse(config.openAiChatModel, prompt);
  return { message: output, emergency: false, source: "openai" };
}

export async function createHealthReport({ pet, records = [] }: { pet: PetProfile; records?: unknown[] }) {
  const prompt = [
    "Create a companion-animal wellness report in Korean.",
    "This is not a diagnosis. Use only supplied data and explicitly state when evidence is insufficient.",
    "Return JSON with keys: summary, score, confidence, metrics, alerts, actions, vetQuestions.",
    "score must be 0-100. confidence must be low, medium, or high.",
    `Pet profile: ${JSON.stringify(pet)}`,
    `Records: ${JSON.stringify(records.slice(-450))}`,
  ].join("\n");
  const output = await openAIResponse(config.openAiReportModel, prompt);
  try {
    return { report: JSON.parse(output), source: "openai" };
  } catch {
    return { report: { summary: output, confidence: "low" }, source: "openai" };
  }
}

async function openAIResponse(model: string, input: string) {
  if (!config.openAiKey) {
    throw new AppError(503, "OPENAI_API_KEY 환경변수가 설정되지 않았어요.", "AI_NOT_CONFIGURED");
  }

  let result: Response;
  try {
    result = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input, store: config.openAiStoreResponses }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new AppError(
      504,
      error instanceof Error && error.name === "TimeoutError"
        ? "OpenAI 응답 시간이 초과됐어요."
        : "OpenAI 서버에 연결하지 못했어요.",
      "AI_CONNECTION_ERROR",
    );
  }

  if (!result.ok) {
    const error = await result.json().catch(() => ({})) as { error?: { message?: string } };
    console.error("OpenAI API error:", result.status, error.error?.message || "");
    if (result.status === 401) throw new AppError(502, "OpenAI API 키가 올바르지 않아요.", "AI_AUTH_ERROR");
    if (result.status === 429) throw new AppError(503, "OpenAI 사용 한도 또는 요청 한도를 확인해주세요.", "AI_QUOTA_ERROR");
    if (result.status === 404) throw new AppError(502, `OpenAI 모델 설정을 확인해주세요: ${model}`, "AI_MODEL_ERROR");
    throw new AppError(502, "OpenAI 응답을 생성하지 못했어요.", "AI_PROVIDER_ERROR");
  }

  const payload = await result.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  return payload.output_text
    || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text
    || "";
}

function emergencySignal(message: string) {
  const text = message.replace(/\s/g, "");
  const urgent = ["호흡곤란", "숨을못", "의식없", "경련", "발작", "피를토", "대량출혈", "독극물", "초콜릿먹", "포도먹"];
  if (!urgent.some((keyword) => text.includes(keyword))) return "";
  return "응급 가능성이 있어요. AI 답변을 기다리지 말고 가까운 24시간 동물병원에 즉시 연락하거나 방문해주세요.";
}
