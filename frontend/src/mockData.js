export const initialState = {
  session: null,
  users: [],
  pets: [
    {
      id: "pet-mongchi",
      ownerId: "demo-user",
      type: "dog",
      name: "몽치",
      breed: "말티즈",
      age: 4,
      weight: 4.2,
      sex: "female",
      neutered: true,
      conditions: ["심장 질환", "피부염"],
      allergies: ["닭고기"],
      medication: "심장 보조제",
      photo: "",
    },
    {
      id: "pet-nabi",
      ownerId: "demo-user",
      type: "cat",
      name: "나비",
      breed: "코리안 숏헤어",
      age: 2,
      weight: 3.7,
      sex: "male",
      neutered: true,
      conditions: [],
      allergies: ["유제품"],
      medication: "",
      photo: "",
    },
  ],
  records: [
    { id: "rec-1", petId: "pet-mongchi", date: today(), category: "meal", amount: 72, appetite: "좋음" },
    { id: "rec-2", petId: "pet-mongchi", date: today(), category: "walk", minutes: 35, intensity: "보통" },
    { id: "rec-3", petId: "pet-mongchi", date: today(), category: "poop", count: 2, shape: "정상" },
    { id: "rec-4", petId: "pet-mongchi", date: today(), category: "behavior", note: "활동량이 안정적이에요." },
    { id: "rec-5", petId: "pet-nabi", date: today(), category: "meal", amount: 54, appetite: "보통" },
    { id: "rec-6", petId: "pet-nabi", date: today(), category: "weight", weight: 3.7 },
  ],
  events: [
    {
      id: "evt-1",
      petId: "pet-mongchi",
      type: "예방접종",
      title: "광견병 접종",
      date: addDays(9),
      time: "10:30",
      hospital: "픽 동물메디컬센터",
      reminder: "1일 전",
      done: false,
    },
  ],
};

export const petTypes = [
  { id: "dog", label: "강아지", icon: "dog" },
  { id: "cat", label: "고양이", icon: "cat" },
  { id: "rabbit", label: "토끼", icon: "rabbit" },
  { id: "hamster", label: "햄스터", icon: "hamster" },
  { id: "other", label: "기타 동물", icon: "plus" },
];

export const products = [
  {
    id: "food-1",
    category: "사료",
    name: "센서티브 라이트 케어",
    ingredients: ["연어", "쌀", "프로바이오틱스"],
    avoidAllergies: ["닭고기", "소고기", "밀"],
    conditionFit: ["피부염"],
    reason: "닭고기 알레르기를 피하면서 피부 관리 성분을 우선했어요.",
    link: "#",
  },
  {
    id: "supp-1",
    category: "영양제",
    name: "하트 밸런스 오메가",
    ingredients: ["오메가3", "타우린", "코엔자임Q10"],
    avoidAllergies: [],
    conditionFit: ["심장 질환"],
    reason: "심장 관리 이력이 있어 순환 건강 보조 성분을 추천해요.",
    link: "#",
  },
  {
    id: "snack-1",
    category: "간식",
    name: "저알러지 고구마 바이트",
    ingredients: ["고구마", "완두 단백"],
    avoidAllergies: ["닭고기", "소고기", "유제품"],
    conditionFit: [],
    reason: "주요 동물성 알레르기 원료를 제외한 간식이에요.",
    link: "#",
  },
];

export const hospitals = [
  {
    id: "hos-1",
    name: "픽 동물메디컬센터",
    distanceKm: 0.8,
    phone: "02-123-4567",
    hours: "09:00-22:00",
    night: true,
    emergency: true,
    address: "서울시 강남구 테헤란로 100",
  },
  {
    id: "hos-2",
    name: "우리동네 동물병원",
    distanceKm: 1.6,
    phone: "02-555-0101",
    hours: "10:00-19:00",
    night: false,
    emergency: false,
    address: "서울시 강남구 선릉로 20",
  },
  {
    id: "hos-3",
    name: "24시 케어 동물의료원",
    distanceKm: 2.4,
    phone: "02-777-2424",
    hours: "24시간",
    night: true,
    emergency: true,
    address: "서울시 서초구 사평대로 51",
  },
];

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
