import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - nutrition", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-17T12:00:00.000Z"));
    store = new RuntimeStore(":memory:");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates meals and computes daily macro summary", () => {
    store.createNutritionMeal({
      name: "Protein oats",
      mealType: "breakfast",
      consumedAt: "2026-02-17T07:15:00.000Z",
      calories: 520,
      proteinGrams: 32,
      carbsGrams: 68,
      fatGrams: 14
    });

    store.createNutritionMeal({
      name: "Chicken bowl",
      mealType: "lunch",
      consumedAt: "2026-02-17T11:45:00.000Z",
      calories: 710,
      proteinGrams: 54,
      carbsGrams: 76,
      fatGrams: 18
    });

    const summary = store.getNutritionDailySummary("2026-02-17");
    expect(summary.date).toBe("2026-02-17");
    expect(summary.mealsLogged).toBe(2);
    expect(summary.totals.calories).toBe(1230);
    expect(summary.totals.proteinGrams).toBe(86);
    expect(summary.totals.carbsGrams).toBe(144);
    expect(summary.totals.fatGrams).toBe(32);
    expect(summary.targetProfile).toBeNull();
    expect(summary.remainingToTarget).toBeNull();
  });

  it("filters meals by date and supports deletion", () => {
    const keep = store.createNutritionMeal({
      name: "Greek yogurt",
      mealType: "snack",
      consumedAt: "2026-02-17T16:00:00.000Z",
      calories: 190,
      proteinGrams: 20,
      carbsGrams: 12,
      fatGrams: 6
    });

    store.createNutritionMeal({
      name: "Dinner prep",
      mealType: "dinner",
      consumedAt: "2026-02-18T18:00:00.000Z",
      calories: 640,
      proteinGrams: 45,
      carbsGrams: 70,
      fatGrams: 16
    });

    const dayMeals = store.getNutritionMeals({ date: "2026-02-17" });
    expect(dayMeals).toHaveLength(1);
    expect(dayMeals[0]?.id).toBe(keep.id);

    expect(store.deleteNutritionMeal(keep.id)).toBe(true);
    expect(store.getNutritionMealById(keep.id)).toBeNull();
  });

  it("upserts meal plan blocks and includes them in daily summary", () => {
    const created = store.upsertNutritionMealPlanBlock({
      title: "Pre-workout snack",
      scheduledFor: "2026-02-17T06:30:00.000Z",
      targetCalories: 280,
      targetProteinGrams: 20
    });

    expect(created.id).toContain("meal-plan");
    expect(created.targetCalories).toBe(280);

    const updated = store.upsertNutritionMealPlanBlock({
      id: created.id,
      title: "Post-workout meal",
      scheduledFor: "2026-02-17T08:45:00.000Z",
      targetCalories: 620,
      targetProteinGrams: 42,
      targetCarbsGrams: 70,
      targetFatGrams: 14
    });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("Post-workout meal");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.targetCarbsGrams).toBe(70);

    const summary = store.getNutritionDailySummary("2026-02-17");
    expect(summary.mealPlanBlocks).toHaveLength(1);
    expect(summary.mealPlanBlocks[0]?.title).toBe("Post-workout meal");

    expect(store.deleteNutritionMealPlanBlock(created.id)).toBe(true);
    expect(store.getNutritionMealPlanBlockById(created.id)).toBeNull();
  });

  it("stores daily nutrition target profile and derives macro targets from settings", () => {
    const profile = store.upsertNutritionTargetProfile({
      date: "2026-02-17",
      weightKg: 73,
      maintenanceCalories: 2621,
      surplusCalories: 300
    });

    expect(profile.date).toBe("2026-02-17");
    expect(profile.weightKg).toBe(73);
    expect(profile.maintenanceCalories).toBe(2621);
    expect(profile.surplusCalories).toBe(300);
    expect(profile.targetCalories).toBe(2921);
    expect(profile.targetProteinGrams).toBeCloseTo(128.7, 1);
    expect(profile.targetFatGrams).toBeCloseTo(64.4, 1);
    expect(profile.targetCarbsGrams).toBeCloseTo(456.7, 1);

    const fetched = store.getNutritionTargetProfile("2026-02-17");
    expect(fetched).not.toBeNull();
    expect(fetched?.targetCalories).toBe(2921);
  });

  it("includes remaining-to-target deltas in daily summary and supports explicit target overrides", () => {
    store.upsertNutritionTargetProfile({
      date: "2026-02-17",
      weightKg: 73,
      maintenanceCalories: 2621,
      surplusCalories: 300,
      targetProteinGrams: 140
    });

    store.createNutritionMeal({
      name: "Breakfast",
      mealType: "breakfast",
      consumedAt: "2026-02-17T08:00:00.000Z",
      calories: 500,
      proteinGrams: 30,
      carbsGrams: 60,
      fatGrams: 10
    });

    const summary = store.getNutritionDailySummary("2026-02-17");
    expect(summary.targetProfile).not.toBeNull();
    expect(summary.targetProfile?.targetProteinGrams).toBe(140);
    expect(summary.remainingToTarget).not.toBeNull();
    expect(summary.remainingToTarget?.calories).toBeCloseTo(2421, 1);
    expect(summary.remainingToTarget?.proteinGrams).toBeCloseTo(110, 1);
    expect(summary.remainingToTarget?.carbsGrams).toBeCloseTo(396.7, 1);
    expect(summary.remainingToTarget?.fatGrams).toBeCloseTo(54.4, 1);
  });

  it("supports custom foods CRUD and query filtering", () => {
    const created = store.createNutritionCustomFood({
      name: "Jasmine rice",
      unitLabel: "100g",
      caloriesPerUnit: 130,
      proteinGramsPerUnit: 2.7,
      carbsGramsPerUnit: 28,
      fatGramsPerUnit: 0.3
    });

    expect(created.id).toContain("custom-food");
    expect(created.name).toBe("Jasmine rice");

    const fetched = store.getNutritionCustomFoodById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.unitLabel).toBe("100g");

    const filtered = store.getNutritionCustomFoods({ query: "rice", limit: 10 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(created.id);

    const updated = store.updateNutritionCustomFood(created.id, {
      caloriesPerUnit: 132
    });
    expect(updated).not.toBeNull();
    expect(updated?.caloriesPerUnit).toBe(132);

    expect(store.deleteNutritionCustomFood(created.id)).toBe(true);
    expect(store.getNutritionCustomFoodById(created.id)).toBeNull();
  });
});
