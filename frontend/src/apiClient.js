import { config } from "./config.js";
import { hospitals, initialState, products, today } from "./mockData.js";

const STORAGE_KEY = "petcarepick:mvp-state";

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);

  const seeded = structuredClone(initialState);
  seeded.users.push({ id: "demo-user", name: "보호자", email: "demo@petcarepick.kr" });
  seeded.session = { userId: "demo-user", name: "보호자", email: "demo@petcarepick.kr" };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

class MockApiClient {
  constructor() {
    this.state = loadState();
  }

  getSession() {
    return this.state.session;
  }

  signUp({ name, email, password }) {
    if (!name || name.length > 20) throw new Error("이름은 20자 이하로 입력해주세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("이메일 형식을 확인해주세요.");
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) throw new Error("비밀번호는 8자 이상 영문+숫자로 입력해주세요.");
    if (this.state.users.some((user) => user.email === email)) throw new Error("이미 가입된 이메일입니다.");

    const user = { id: uid("user"), name, email };
    this.state.users.push(user);
    this.state.session = { userId: user.id, name: user.name, email: user.email };
    saveState(this.state);
    return this.state.session;
  }

  signIn({ email }) {
    const user = this.state.users.find((item) => item.email === email) ?? this.state.users[0];
    this.state.session = { userId: user.id, name: user.name, email: user.email };
    saveState(this.state);
    return this.state.session;
  }

  signOut() {
    this.state.session = null;
    saveState(this.state);
  }

  deleteAccount() {
    const userId = this.state.session?.userId;
    if (!userId) return;
    const petIds = this.state.pets.filter((pet) => pet.ownerId === userId).map((pet) => pet.id);
    this.state.users = this.state.users.filter((user) => user.id !== userId);
    this.state.pets = this.state.pets.filter((pet) => pet.ownerId !== userId);
    this.state.records = this.state.records.filter((record) => !petIds.includes(record.petId));
    this.state.events = this.state.events.filter((event) => !petIds.includes(event.petId));
    this.state.session = null;
    saveState(this.state);
  }

  listPets() {
    const userId = this.state.session?.userId;
    return this.state.pets.filter((pet) => pet.ownerId === userId);
  }

  createPet(input) {
    const userId = this.state.session?.userId;
    if (!userId) throw new Error("다시 로그인해주세요.");
    if (this.listPets().length >= 10) throw new Error("반려동물은 최대 10마리까지 등록할 수 있어요.");
    const pet = { ...input, id: uid("pet"), ownerId: userId };
    this.state.pets.push(pet);
    saveState(this.state);
    return pet;
  }

  updatePet(petId, patch) {
    this.state.pets = this.state.pets.map((pet) => (pet.id === petId ? { ...pet, ...patch } : pet));
    saveState(this.state);
    return this.state.pets.find((pet) => pet.id === petId);
  }

  deletePet(petId) {
    this.state.pets = this.state.pets.filter((pet) => pet.id !== petId);
    this.state.records = this.state.records.filter((record) => record.petId !== petId);
    this.state.events = this.state.events.filter((event) => event.petId !== petId);
    saveState(this.state);
  }

  listRecords(petId) {
    return this.state.records.filter((record) => record.petId === petId);
  }

  createRecord(record) {
    const next = { ...record, id: uid("rec"), date: record.date || today() };
    this.state.records.push(next);
    saveState(this.state);
    return next;
  }

  completionForToday(petId) {
    const categories = new Set(
      this.state.records
        .filter((record) => record.petId === petId && record.date === today())
        .map((record) => record.category),
    );
    return categories.size;
  }

  listEvents(petId) {
    return this.state.events.filter((event) => event.petId === petId);
  }

  createEvent(event) {
    const next = { ...event, id: uid("evt"), done: false };
    this.state.events.push(next);
    saveState(this.state);
    return next;
  }

  listRecommendations(pet) {
    const allergies = new Set(pet?.allergies ?? []);
    const conditions = new Set(pet?.conditions ?? []);
    const filtered = products.filter((product) => !product.avoidAllergies.some((item) => allergies.has(item)));
    return filtered
      .map((product) => ({
        ...product,
        score: product.conditionFit.some((item) => conditions.has(item)) ? 2 : 1,
      }))
      .sort((a, b) => b.score - a.score);
  }

  findHospitals({ night = false, emergency = false, radiusKm = 2 } = {}) {
    return hospitals.filter((hospital) => {
      if (hospital.distanceKm > radiusKm) return false;
      if (night && !hospital.night) return false;
      if (emergency && !hospital.emergency) return false;
      return true;
    });
  }
}

export const api = new MockApiClient();
export const apiMode = config.apiMode;
