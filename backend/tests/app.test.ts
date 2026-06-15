import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { reportSchema } from "../src/validation.js";

const app = createApp();

describe("Petcarepick API", () => {
  it("returns service capabilities", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.service).toBe("petcarepick-backend");
    expect(response.body.capabilities).toHaveProperty("database");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("validates signup input before touching the database", async () => {
    const response = await request(app)
      .post("/api/auth/signup")
      .send({ name: "A", email: "not-an-email", password: "short" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication for private resources", async () => {
    const response = await request(app).get("/api/pets");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns a structured 404 response", async () => {
    const response = await request(app).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("accepts portfolio demo pet ids for health reports", () => {
    const input = reportSchema.parse({
      pet: { id: "demo-pet-1", name: "몽치" },
      records: [],
    });

    expect(input.pet.id).toBe("demo-pet-1");
  });
});
